import { useMemo } from 'react';
import { useChatStore, otherUser, selectSortedConversations } from '../store/chat.store';
import { usePresenceStore } from '../store/presence.store';
import { useAuthStore } from '../store/auth.store';
import { PresenceDot } from './PresenceDot';
import type { ConversationView } from '../types/chat';

function previewTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ConversationList({ onSelect }: { onSelect: (id: string) => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const lastMessageByConv = useChatStore((s) => s.lastMessageByConv);
  const activeId = useChatStore((s) => s.activeConversationId);
  const unread = useChatStore((s) => s.unreadByConv);
  const presence = usePresenceStore((s) => s.presence);
  const meId = useAuthStore((s) => s.user?.id ?? '');

  const sorted = useMemo(
    () => selectSortedConversations(conversations, lastMessageByConv),
    [conversations, lastMessageByConv],
  );

  if (conversations.length === 0) {
    return <div className="list-empty">暂无会话</div>;
  }

  return (
    <ul className="conv-list">
      {sorted.map((conv: ConversationView) => {
        const other = otherUser(conv, meId);
        const count = unread[conv.id] ?? 0;
        const last = lastMessageByConv[conv.id];
        return (
          <li
            key={conv.id}
            className="conv-item"
            data-active={conv.id === activeId ? 'true' : 'false'}
            onClick={() => onSelect(conv.id)}
          >
            <PresenceDot online={other ? presence[other.id] : false} />
            <div className="conv-main">
              <div className="conv-line">
                <span className="conv-name">{other?.nickname ?? '未知用户'}</span>
                <span className="conv-time">{previewTime(last?.createdAt)}</span>
              </div>
              {/* Phase 3.5: the preview reads from the same `lastMessageByConv`
                  entry the store patches on recall/edit, so the list can never
                  keep showing text that was recalled in the open thread. */}
              <div
                className="conv-preview"
                data-recalled={last?.recalledAt ? 'true' : 'false'}
                data-attachment={last?.attachments && last.attachments.length > 0 ? 'true' : 'false'}
              >
                {!last
                  ? '暂无消息'
                  : last.recalledAt
                    ? '消息已撤回'
                    : last.attachments && last.attachments.length > 0
                      ? last.attachments.some((a) => a.kind === 'image')
                        ? '[图片]'
                        : '[文件]'
                      : last.content}
              </div>
            </div>
            {count > 0 && <span className="unread-badge">{count > 99 ? '99+' : count}</span>}
          </li>
        );
      })}
    </ul>
  );
}
