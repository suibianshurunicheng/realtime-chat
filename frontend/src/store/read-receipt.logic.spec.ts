import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';
import type { Message } from '../types/chat';

const me = '1';
const other = '2';

const build = (): Message[] => [
  { id: '10', conversationId: 'c1', senderId: other, type: 'text', content: 'a', createdAt: '', readAt: null },
  { id: '11', conversationId: 'c1', senderId: me, type: 'text', content: 'b', createdAt: '', readAt: null },
  { id: '12', conversationId: 'c1', senderId: other, type: 'text', content: 'c', createdAt: '', readAt: null },
  { id: '13', conversationId: 'c1', senderId: me, type: 'text', content: 'd', createdAt: '', readAt: null },
];

describe('chat store applyReadReceipt (Phase 3.4)', () => {
  beforeEach(() => useChatStore.getState().clearAll());

  it('marks the OTHER party’s messages (up to upToMessageId) as read, leaves our own untouched', () => {
    useChatStore.getState().setMessages('c1', build());
    useChatStore.getState().applyReadReceipt({
      conversationId: 'c1',
      readerId: me, // "me" read them -> the other party's messages (senderId=other) get readAt
      upToMessageId: '12',
      readAt: '2026-08-15T00:00:00.000Z',
    });
    const msgs = useChatStore.getState().messagesByConv['c1']!;
    // id10 (other, <=12) read
    expect(msgs.find((m) => m.id === '10')!.readAt).toBe('2026-08-15T00:00:00.000Z');
    // id12 (other, <=12) read
    expect(msgs.find((m) => m.id === '12')!.readAt).toBe('2026-08-15T00:00:00.000Z');
    // id11 / id13 are ours (senderId=me) -> never marked by us
    expect(msgs.find((m) => m.id === '11')!.readAt).toBeNull();
    expect(msgs.find((m) => m.id === '13')!.readAt).toBeNull();
  });

  it('with upToMessageId=null marks ALL of the other party’s unread messages', () => {
    useChatStore.getState().setMessages('c1', build());
    useChatStore.getState().applyReadReceipt({
      conversationId: 'c1',
      readerId: me,
      upToMessageId: null,
      readAt: '2026-08-15T00:00:00.000Z',
    });
    const msgs = useChatStore.getState().messagesByConv['c1']!;
    expect(msgs.find((m) => m.id === '10')!.readAt).not.toBeNull();
    expect(msgs.find((m) => m.id === '12')!.readAt).not.toBeNull();
    expect(msgs.find((m) => m.id === '11')!.readAt).toBeNull();
  });

  it('marks the LOCAL user’s own messages when the remote user is the reader; never the reader’s own', () => {
    // When the remote user (readerId=other) reads, the receipt applies to OUR
    // messages (senderId=me) on this client. The reader's own messages
    // (senderId=other) must never be marked — direction is enforced.
    useChatStore.getState().setMessages('c1', build());
    useChatStore.getState().applyReadReceipt({
      conversationId: 'c1',
      readerId: other,
      upToMessageId: null,
      readAt: '2026-08-15T00:00:00.000Z',
    });
    const msgs = useChatStore.getState().messagesByConv['c1']!;
    // our messages (senderId=me) are now read by the other user
    expect(msgs.find((m) => m.id === '11')!.readAt).not.toBeNull();
    expect(msgs.find((m) => m.id === '13')!.readAt).not.toBeNull();
    // the reader's own messages (senderId would be `other`) are never marked
    expect(msgs.find((m) => m.id === '10')!.readAt).toBeNull();
    expect(msgs.find((m) => m.id === '12')!.readAt).toBeNull();
  });

  it('is idempotent: already-read messages are not overwritten', () => {
    const list = build();
    list[0].readAt = '2026-08-14T00:00:00.000Z'; // id10 already read earlier
    useChatStore.getState().setMessages('c1', list);
    useChatStore.getState().applyReadReceipt({
      conversationId: 'c1',
      readerId: me,
      upToMessageId: null,
      readAt: '2026-08-15T00:00:00.000Z',
    });
    const msgs = useChatStore.getState().messagesByConv['c1']!;
    // id10 keeps its earlier readAt; only id12 (other, previously unread) is updated
    expect(msgs.find((m) => m.id === '10')!.readAt).toBe('2026-08-14T00:00:00.000Z');
    expect(msgs.find((m) => m.id === '12')!.readAt).toBe('2026-08-15T00:00:00.000Z');
  });

  it('compares ids numerically (BigInt), not as strings', () => {
    // "9" < "10" lexicographically but 9 < 10 numerically. upTo="10" must include id10.
    const list: Message[] = [
      { id: '9', conversationId: 'c1', senderId: other, type: 'text', content: 'x', createdAt: '', readAt: null },
      { id: '10', conversationId: 'c1', senderId: other, type: 'text', content: 'y', createdAt: '', readAt: null },
    ];
    useChatStore.getState().setMessages('c1', list);
    useChatStore.getState().applyReadReceipt({
      conversationId: 'c1',
      readerId: me,
      upToMessageId: '10',
      readAt: '2026-08-15T00:00:00.000Z',
    });
    const msgs = useChatStore.getState().messagesByConv['c1']!;
    expect(msgs.find((m) => m.id === '9')!.readAt).not.toBeNull();
    expect(msgs.find((m) => m.id === '10')!.readAt).not.toBeNull();
  });

  it('no-op on an unknown / empty conversation', () => {
    const before = useChatStore.getState().messagesByConv;
    useChatStore.getState().applyReadReceipt({
      conversationId: 'nope',
      readerId: me,
      upToMessageId: null,
      readAt: '2026-08-15T00:00:00.000Z',
    });
    expect(useChatStore.getState().messagesByConv).toBe(before);
  });
});
