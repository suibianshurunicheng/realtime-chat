import { useEffect, useState } from 'react';
import type { Message, AttachmentView } from '../types/chat';
import { fetchAttachmentBlob } from '../api/attachments.api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Renders one attachment: image -> lazy blob thumbnail; file -> download card. */
function AttachmentItem({
  att,
  onDownload,
}: {
  att: AttachmentView;
  onDownload: (a: AttachmentView) => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let active = true;
    fetchAttachmentBlob(att.id)
      .then((b) => {
        url = URL.createObjectURL(b);
        if (active) setBlobUrl(url);
      })
      .catch(() => active && setErr(true));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [att.id]);

  if (att.kind === 'image') {
    return (
      <button
        type="button"
        className="msg-image"
        data-error={err ? 'true' : 'false'}
        onClick={() => blobUrl && window.dispatchEvent(new CustomEvent('open-image-modal', { detail: blobUrl }))}
        title={att.fileName}
      >
        {err ? (
          <span className="img-error">图片加载失败</span>
        ) : blobUrl ? (
          <img src={blobUrl} alt={att.fileName} loading="lazy" />
        ) : (
          <span className="img-loading">加载中…</span>
        )}
      </button>
    );
  }

  // file
  return (
    <button type="button" className="msg-file-card" onClick={() => onDownload(att)} title={att.fileName}>
      <span className="file-icon" aria-hidden>
        📄
      </span>
      <span className="file-meta">
        <span className="file-name">{att.fileName}</span>
        <span className="file-size">{formatSize(att.fileSize)}</span>
      </span>
    </button>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MAX_CONTENT_LENGTH = 2000;

/**
 * Phase 3.5 rendering rules (all three states are mutually exclusive):
 *  - recalled (`recalledAt` set) -> render ONLY the "消息已撤回" placeholder. The
 *    original text is never rendered (the server already blanks `content`, this
 *    is the second line of defence) and no action bar is offered. Media attached
 *    to a recalled message is hidden entirely by this early return.
 *  - edited   (`editedAt` set)   -> render the latest `content` + an "已编辑" tag.
 *  - plain                       -> render `content`.
 *
 * Phase 4: a message may carry `attachments` (image thumbnails / file cards).
 * Images are loaded through the auth-gated blob fetch (never a raw <img src>,
 * which would skip the JWT header). Clicking an image opens a modal preview.
 *
 * The action bar (编辑 / 撤回) is shown for MY messages only. Nothing here
 * mutates state optimistically: `onRecall` / `onEdit` just emit, and the row
 * only changes once the server broadcast lands. While a request is in flight the
 * row's buttons are disabled (`busyId`) so a double click cannot send two.
 */
export function MessageList({
  messages,
  currentUserId,
  onRecall,
  onEdit,
  onDownloadAttachment,
}: {
  messages: Message[];
  currentUserId: string;
  onRecall?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onDownloadAttachment?: (att: AttachmentView) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalUrl, setModalUrl] = useState<string | null>(null);

  useEffect(() => {
    setBusyId(null);
  }, [messages]);

  useEffect(() => {
    if (!busyId) return;
    const t = window.setTimeout(() => setBusyId(null), 5000);
    return () => window.clearTimeout(t);
  }, [busyId]);

  // Image modal: opened by AttachmentItem, closed on backdrop click / Esc.
  useEffect(() => {
    const open = (e: Event) => setModalUrl((e as CustomEvent<string>).detail);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setModalUrl(null);
    window.addEventListener('open-image-modal', open as EventListener);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('open-image-modal', open as EventListener);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const startEdit = (m: Message) => {
    setEditingId(m.id);
    setDraft(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const submitEdit = (m: Message) => {
    const next = draft.trim();
    if (!next || next.length > MAX_CONTENT_LENGTH || next === m.content) {
      cancelEdit();
      return;
    }
    setBusyId(m.id);
    cancelEdit();
    onEdit?.(m.id, next);
  };

  const submitRecall = (m: Message) => {
    if (!window.confirm('撤回后对方将无法看到这条消息，确定撤回？')) return;
    setBusyId(m.id);
    onRecall?.(m.id);
  };

  return (
    <div className="msg-list">
      {messages.map((m) => {
        const mine = m.senderId === currentUserId;
        const recalled = m.recalledAt != null;
        const editing = editingId === m.id;
        const busy = busyId === m.id;
        const canAct = mine && !recalled && (!!onRecall || !!onEdit);
        const attachments = m.attachments ?? [];

        return (
          <div key={m.id} className="msg-row" data-mine={mine ? 'true' : 'false'}>
            <div className="msg-bubble" data-recalled={recalled ? 'true' : 'false'}>
              {recalled ? (
                <div className="msg-recalled">消息已撤回</div>
              ) : editing ? (
                <div className="msg-edit">
                  <textarea
                    className="msg-edit-input"
                    value={draft}
                    maxLength={MAX_CONTENT_LENGTH}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') cancelEdit();
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitEdit(m);
                      }
                    }}
                  />
                  <div className="msg-edit-actions">
                    <button type="button" onClick={() => submitEdit(m)} disabled={!draft.trim()}>
                      保存
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {attachments.length > 0 && (
                    <div className="msg-attachments">
                      {attachments.map((a) => (
                        <AttachmentItem
                          key={a.id}
                          att={a}
                          onDownload={(att) => onDownloadAttachment?.(att)}
                        />
                      ))}
                    </div>
                  )}
                  {m.content && <div className="msg-content">{m.content}</div>}
                </>
              )}

              <div className="msg-meta">
                <span className="msg-time">{formatTime(m.createdAt)}</span>
                {!recalled && m.editedAt && <span className="msg-edited">已编辑</span>}
                {mine && !recalled && m.readAt && <span className="msg-read">已读</span>}
              </div>

              {canAct && !editing && (
                <div className="msg-actions">
                  {onEdit && (
                    <button type="button" disabled={busy} onClick={() => startEdit(m)}>
                      编辑
                    </button>
                  )}
                  {onRecall && (
                    <button type="button" disabled={busy} onClick={() => submitRecall(m)}>
                      撤回
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {modalUrl && (
        <div className="img-modal" onClick={() => setModalUrl(null)}>
          <img src={modalUrl} alt="preview" />
        </div>
      )}
    </div>
  );
}
