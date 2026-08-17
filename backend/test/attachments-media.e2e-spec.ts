import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { createApp } from './setup-e2e';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { Attachment } from '../src/attachments/entities/attachment.entity';
import { ConfigService } from '@nestjs/config';

/**
 * Phase 4 end-to-end coverage: image / file messages.
 *
 * Exercises the three subsystems against a real MySQL/Redis stack:
 *  - UPLOAD   POST /api/attachments  (content-based magic-byte validation)
 *  - DOWNLOAD GET  /api/attachments/:id (auth + membership + recall gating)
 *  - MESSAGE  POST /api/conversations/:cid/messages (atomic attachment binding)
 *  - SOCKET   send_message -> message_created (both ends get attachments)
 *  - CLEANUP  orphan sweeper (expired unbound attachments)
 *
 * The matrix deliberately mirrors the Phase 4 spec §23.
 */

// ---- magic-byte file builders (server-truth content) ----
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP')]);
const GIF = Buffer.from('GIF89a');
const PDF = Buffer.from('%PDF-1.4');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Pad a magic prefix to `size` bytes of valid-looking content. */
function file(prefix: Buffer, size = 256): Buffer {
  return Buffer.concat([prefix, Buffer.alloc(Math.max(0, size - prefix.length), 0x20)]);
}

describe('AttachmentsMedia (e2e)', () => {
  let app: INestApplication;
  let baseURL: string;
  let ds: DataSource;
  let attachmentsSvc: AttachmentsService;
  let localDir: string;

  const unique = () =>
    `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function register(nickname = 'Nick') {
    const username = unique();
    const res = await request(baseURL)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname });
    return {
      username,
      accessToken: res.body.data.accessToken as string,
      id: res.body.data.user.id as string,
    };
  }

  async function befriend(a: { accessToken: string }, b: { accessToken: string; id: string }) {
    const sent = await request(baseURL)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    await request(baseURL)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);
  }

  async function friends() {
    const a = await register('A');
    const b = await register('B');
    await befriend(a, b);
    return { a, b };
  }

  async function conversation(a: { accessToken: string }, b: { id: string }): Promise<string> {
    const res = await request(baseURL)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    return res.body.data.id as string;
  }

  /** Upload one file staged against `cid`. Returns the raw supertest response. */
  function upload(who: { accessToken: string }, cid: string, buf: Buffer, filename: string) {
    return request(baseURL)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${who.accessToken}`)
      .field('conversationId', cid)
      .attach('file', buf, filename);
  }

  /** Send a message (REST). `body` = {type, content, attachmentIds}. */
  function sendMsg(
    who: { accessToken: string },
    cid: string,
    body: Record<string, unknown>,
  ) {
    return request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${who.accessToken}`)
      .send(body);
  }

  function downloadRaw(who: { accessToken: string } | null, id: string) {
    const r = request(baseURL).get(`/api/attachments/${id}`);
    if (who) r.set('Authorization', `Bearer ${who.accessToken}`);
    // Native binary handling: responseType('blob') + buffer(true) makes superagent
    // buffer the body into res.body as a Buffer (no custom parser that could
    // double-consume the stream). .ok(() => true) stops 4xx from throwing so the
    // caller still receives status/headers for the 401/403/410 assertions.
    return r
      .responseType('blob')
      .buffer(true)
      .ok(() => true)
      .then((res) => ({
        status: res.status,
        body: res.body as Buffer,
        headers: res.headers as Record<string, string>,
      }));
  }

  async function history(who: { accessToken: string }, cid: string) {
    const res = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${who.accessToken}`);
    return res.body.data as Array<{
      id: string;
      type: string;
      content: string;
      recalledAt: string | null;
      attachments: Array<{ id: string; kind: string; fileName: string; url: string }>;
    }>;
  }

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseURL, {
        path: '/ws',
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  function once(socket: Socket, event: string, timeout = 3000): Promise<any> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      socket.once(event, (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  const onceCreated = (s: Socket, t = 3000) => once(s, 'message_created', t);
  const onceError = (s: Socket, t = 2500) => once(s, 'message_error', t);
  const onceRecalled = (s: Socket, t = 3000) => once(s, 'message_recalled', t);

  beforeAll(async () => {
    process.env.DB_DATABASE = process.env.DB_DATABASE ?? 'realtime_chat_test';
    process.env.REDIS_DB = process.env.REDIS_DB ?? '1';
    process.env.NODE_ENV = 'test';
    app = await createApp();
    ds = app.get(DataSource);
    attachmentsSvc = app.get(AttachmentsService);
    // Read the same localDir the LocalStorageService was constructed with. The
    // non-generic ConfigService import resolves its `.get` overload to `never`
    // for dotted keys, so we cast at the call site (the key is always present
    // at runtime via configuration.ts's `storage.localDir` default).
    localDir = (app.get(ConfigService) as { get: (k: string) => unknown }).get(
      'storage.localDir',
    ) as string;
    await app.listen(0);
    const addr = app.getHttpServer().address();
    const port = typeof addr === 'string' ? addr : (addr as { port: number }).port;
    baseURL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  /* ================================================================== *
   * UPLOAD — acceptance matrix
   * ================================================================== */
  describe('upload', () => {
    it('rejects an unauthenticated upload (401)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await request(baseURL)
        .post('/api/attachments')
        .field('conversationId', cid)
        .attach('file', file(PNG), 'photo.png');
      expect(res.status).toBe(401);
    });

    it('accepts every whitelisted image + document type', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);

      const cases: Array<{ name: string; buf: Buffer; kind: string; mime: string }> = [
        { name: 'p.jpg', buf: file(JPG), kind: 'image', mime: 'image/jpeg' },
        { name: 'p.png', buf: file(PNG), kind: 'image', mime: 'image/png' },
        { name: 'p.webp', buf: file(WEBP), kind: 'image', mime: 'image/webp' },
        { name: 'p.gif', buf: file(GIF), kind: 'image', mime: 'image/gif' },
        { name: 'd.pdf', buf: file(PDF), kind: 'file', mime: 'application/pdf' },
        { name: 'd.docx', buf: file(ZIP), kind: 'file', mime: 'application/zip' },
        { name: 'd.xlsx', buf: file(ZIP), kind: 'file', mime: 'application/zip' },
        { name: 'legacy.doc', buf: file(OLE2), kind: 'file', mime: 'application/x-ole-storage' },
        { name: 'legacy.xls', buf: file(OLE2), kind: 'file', mime: 'application/x-ole-storage' },
        { name: 'a.zip', buf: file(ZIP), kind: 'file', mime: 'application/zip' },
      ];

      for (const c of cases) {
        const res = await upload(a, cid, c.buf, c.name);
        expect(res.status).toBe(201);
        expect(res.body.data.kind).toBe(c.kind);
        expect(res.body.data.mimeType).toBe(c.mime);
        expect(res.body.data.url).toBe(`/api/attachments/${res.body.data.id}`);
        expect(res.body.data.fileName).toBe(c.name);
        // the upload is unbound until a message is sent
        expect(res.body.data.messageId ?? null).toBeNull();
      }
    });

    it('sanitizes a path-traversal filename to its basename', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await upload(a, cid, file(PNG), 'sub/../evil.png');
      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toBe('evil.png');
    });

    it('rejects SVG (extension not whitelisted)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await upload(a, cid, Buffer.from('<svg></svg>'), 'evil.svg');
      expect(res.status).toBe(415);
    });

    it('rejects a .png whose bytes are actually a PDF (magic mismatch)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await upload(a, cid, file(PDF), 'fake.png');
      expect(res.status).toBe(415);
    });

    it('rejects a .jpg whose bytes are actually a GIF (magic mismatch)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await upload(a, cid, file(GIF), 'fake.jpg');
      expect(res.status).toBe(415);
    });

    it('rejects a .exe padded with PNG bytes (extension not whitelisted)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await upload(a, cid, file(PNG), 'malware.exe');
      expect(res.status).toBe(415);
    });

    it('rejects a file larger than the configured 20 MB cap', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      // 20MB + 1KB: passes multer's 21MB stream limit, caught by the service cap.
      const big = Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024 + 1024 - PNG.length, 0x20)]);
      const res = await upload(a, cid, big, 'huge.png');
      expect(res.status).toBe(413);
    });

    it('rejects an upload to a conversation the user is not in (403)', async () => {
      const a = await register('A');
      const b = await register('B');
      const c = await register('C');
      await befriend(b, c);
      const cidBC = await conversation(b, c);
      const res = await upload(a, cidBC, file(PNG), 'x.png');
      expect(res.status).toBe(403);
    });
  });

  /* ================================================================== *
   * DOWNLOAD — auth / membership / recall gating
   * ================================================================== */
  describe('download', () => {
    it('rejects an unauthenticated download (401)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const res = await downloadRaw(null, up.body.data.id);
      expect(res.status).toBe(401);
    });

    it('rejects a non-member download (403)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const c = await register('C');
      const up = await upload(a, cid, file(PNG), 'p.png');
      const res = await downloadRaw(c, up.body.data.id);
      expect(res.status).toBe(403);
    });

    it('serves the raw bytes to a member (inline for images)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const buf = file(PNG);
      const up = await upload(a, cid, buf, 'p.png');
      const res = await downloadRaw(a, up.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.equals(buf)).toBe(true);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toContain('inline');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('serves a document as an attachment (download disposition)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const buf = file(PDF);
      const up = await upload(a, cid, buf, 'd.pdf');
      const res = await downloadRaw(a, up.body.data.id);
      expect(res.status).toBe(200);
      expect(res.body.equals(buf)).toBe(true);
      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('recalled media download returns 410 Gone (never served)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const send = await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(send.status).toBe(201);

      const sa = await connect(a.accessToken);
      await sleep(150);
      const done = onceRecalled(sa);
      sa.emit('recall_message', { conversationId: cid, messageId: send.body.data.id });
      expect(await done).not.toBeNull();
      sa.close();

      const res = await downloadRaw(a, up.body.data.id);
      expect(res.status).toBe(410);
    });

    it('blocks path-traversal / arbitrary ids (no file contents leak)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      // a storageKey is opaque; a traversal-looking id can never resolve to a file
      const res = await downloadRaw(a, '../etc/passwd');
      expect(res.status).toBe(404);
      expect(String(res.body).includes('root:')).toBe(false);
    });
  });

  /* ================================================================== *
   * MESSAGE — atomic attachment binding
   * ================================================================== */
  describe('message with attachments', () => {
    it('sends a plain text message (no attachments)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const res = await sendMsg(a, cid, { type: 'text', content: 'hi' });
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('text');
      expect(res.body.data.attachments).toEqual([]);
    });

    it('rejects a text message that carries attachmentIds (400)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const res = await sendMsg(a, cid, { type: 'text', content: 'hi', attachmentIds: [up.body.data.id] });
      expect(res.status).toBe(400);
    });

    it('sends an image message bound to one attachment', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const res = await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('image');
      expect(res.body.data.attachments).toHaveLength(1);
      expect(res.body.data.attachments[0].id).toBe(up.body.data.id);
      expect(res.body.data.attachments[0].url).toBe(`/api/attachments/${up.body.data.id}`);
    });

    it('sends a file message bound to one attachment', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PDF), 'd.pdf');
      const res = await sendMsg(a, cid, { type: 'file', attachmentIds: [up.body.data.id] });
      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('file');
      expect(res.body.data.attachments[0].kind).toBe('file');
    });

    it('sends a multi-image message', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const u1 = await upload(a, cid, file(PNG), '1.png');
      const u2 = await upload(a, cid, file(JPG), '2.jpg');
      const res = await sendMsg(a, cid, {
        type: 'image',
        attachmentIds: [u1.body.data.id, u2.body.data.id],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.attachments).toHaveLength(2);
    });

    it('sends a caption alongside the media', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const res = await sendMsg(a, cid, {
        type: 'image',
        content: '看这张图',
        attachmentIds: [up.body.data.id],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe('看这张图');
    });

    it('rejects referencing another user’s attachment (403)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      // B uploads; A (a member) tries to use B's attachment id.
      const bUp = await upload(b, cid, file(PNG), 'b.png');
      const res = await sendMsg(a, cid, { type: 'image', attachmentIds: [bUp.body.data.id] });
      expect(res.status).toBe(403);
    });

    it('rejects reusing an already-bound attachment (409)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const first = await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(first.status).toBe(201);
      const second = await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(second.status).toBe(409);
    });

    it('rejects an attachment belonging to a different conversation (400)', async () => {
      const a = await register('A');
      const b = await register('B');
      const c = await register('C');
      await befriend(a, b);
      await befriend(a, c);
      const cidAB = await conversation(a, b);
      const cidAC = await conversation(a, c);
      const up = await upload(a, cidAB, file(PNG), 'p.png');
      const res = await sendMsg(a, cidAC, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(res.status).toBe(400);
    });

    it('under concurrency only one sendMessage wins the bind (200 vs 409)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const id = up.body.data.id;
      const [r1, r2] = await Promise.all([
        sendMsg(a, cid, { type: 'image', attachmentIds: [id] }),
        sendMsg(a, cid, { type: 'image', attachmentIds: [id] }),
      ]);
      const ok = [r1, r2].filter((r) => r.status === 200 || r.status === 201).length;
      const conflict = [r1, r2].filter((r) => r.status === 409).length;
      expect(ok).toBe(1);
      expect(conflict).toBe(1);
      // exactly one message owns the attachment; no dangling empty message
      const rows = await history(a, cid);
      const bound = rows.filter((m) => (m.attachments ?? []).some((x) => x.id === id));
      expect(bound).toHaveLength(1);
    });
  });

  /* ================================================================== *
   * REALTIME / HISTORY
   * ================================================================== */
  describe('realtime + history', () => {
    it('socket message_created carries the attachment on both ends', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');

      const sa = await connect(a.accessToken);
      const sb = await connect(b.accessToken);
      await sleep(150);

      const onA = onceCreated(sa);
      const onB = onceCreated(sb);
      sa.emit('send_message', { conversationId: cid, type: 'image', attachmentIds: [up.body.data.id] });
      const [pa, pb] = await Promise.all([onA, onB]);

      expect(pa).not.toBeNull();
      expect(pb).not.toBeNull();
      for (const p of [pa, pb]) {
        expect(p.type).toBe('image');
        expect(p.attachments).toHaveLength(1);
        expect(p.attachments[0].id).toBe(up.body.data.id);
      }
      sa.close();
      sb.close();
    });

    it('REST history returns the message with its attachment', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      const rows = await history(a, cid);
      const m = rows.find((x) => (x.attachments ?? []).some((at) => at.id === up.body.data.id));
      expect(m).toBeDefined();
      expect(m!.attachments[0].url).toBe(`/api/attachments/${up.body.data.id}`);
    });

    it('a late (reconnecting) client reloads the attachment from history', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      // simulate a fresh socket loading history after (re)connect
      const fresh = await connect(b.accessToken);
      await sleep(150);
      fresh.close();
      const rows = await history(b, cid);
      const m = rows.find((x) => (x.attachments ?? []).some((at) => at.id === up.body.data.id));
      expect(m).toBeDefined();
    });

    it('a recalled message still shows recalledAt, but its media is blocked', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const up = await upload(a, cid, file(PNG), 'p.png');
      const send = await sendMsg(a, cid, { type: 'image', attachmentIds: [up.body.data.id] });
      expect(send.status).toBe(201);

      const sa = await connect(a.accessToken);
      await sleep(150);
      const done = onceRecalled(sa);
      sa.emit('recall_message', { conversationId: cid, messageId: send.body.data.id });
      expect(await done).not.toBeNull();
      sa.close();

      const rows = await history(a, cid);
      const m = rows.find((x) => x.id === send.body.data.id)!;
      expect(m.recalledAt).toBeTruthy();
      const dl = await downloadRaw(a, up.body.data.id);
      expect(dl.status).toBe(410);
    });
  });

  /* ================================================================== *
   * CLEANUP — orphan sweeper
   * ================================================================== */
  describe('orphan sweeper', () => {
    it('deletes expired unbound attachments (physical file + row)', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const buf = file(PNG);
      const up = await upload(a, cid, buf, 'orphan.png');
      const attId = up.body.data.id;
      const att = await ds.getRepository(Attachment).findOne({ where: { id: attId } });
      // force it to look expired (raw SQL must use the real column name)
      await ds.query('UPDATE attachments SET expires_at = ? WHERE id = ?', [
        new Date(Date.now() - 1000),
        attId,
      ]);

      const removed = await attachmentsSvc.sweepOrphans();
      expect(removed).toBeGreaterThanOrEqual(1);
      // physical file gone
      expect(fs.existsSync(path.join(localDir, att!.storageKey))).toBe(false);
      // row gone
      expect(await ds.getRepository(Attachment).findOne({ where: { id: attId } })).toBeNull();
    });

    it('tolerates a missing physical file and is idempotent on re-run', async () => {
      const { a, b } = await friends();
      const cid = await conversation(a, b);
      const repo = ds.getRepository(Attachment);
      const fake = repo.create({
        conversationId: cid,
        senderId: a.id,
        kind: 'image',
        fileName: 'gone.png',
        storageKey: 'definitely-missing-key-xyz',
        mimeType: 'image/png',
        fileSize: 10,
        messageId: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      const saved = await repo.save(fake);

      const r1 = await attachmentsSvc.sweepOrphans();
      expect(r1).toBe(1); // row removed despite the unlink failing
      expect(await repo.findOne({ where: { id: saved.id } })).toBeNull();

      const r2 = await attachmentsSvc.sweepOrphans();
      expect(r2).toBe(0); // nothing left to sweep
    });
  });
});
