import { useEffect, useState } from 'react';
import type { Message } from '../types/chat';

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
 *    is the second line of defence) and no action bar is offered.
 *  - edited   (`editedAt` set)   -> render the latest `content` + an "已编辑" tag.
 *  - plain                       -> render `content`.
 *
 * The action bar (编辑 / 撤回) is shown for MY messages only. It appears on hover
 * on desktop and is permanently visible on touch devices (see `.msg-actions` in
 * index.css) — no long-press handling needed.
 *
 * Nothing here mutates state optimistically: `onRecall` / `onEdit` just emit, and
 * the row only changes once the server broadcast lands. While a request is in
 * flight the row's buttons are disabled (`busyId`) so a double click cannot send
 * two recalls / edits.
 */
export function MessageList({
  messages,
  currentUserId,
  onRecall,
  onEdit,
}: {
  messages: Message[];
  currentUserId: string;
  onRecall?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // The server result (any patch to this conversation replaces the array) is what
  // releases the row.
  useEffect(() => {
    setBusyId(null);
  }, [messages]);

  // Safety net: an error (message_error) never touches `messages`, so release the
  // row after a short delay instead of leaving it disabled forever.
  useEffect(() => {
    if (!busyId) return;
    const t = window.setTimeout(() => setBusyId(null), 5000);
    return () => window.clearTimeout(t);
  }, [busyId]);

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
                <div className="msg-content">{m.content}</div>
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
    </div>
  );
}
