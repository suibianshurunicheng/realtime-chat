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

export function MessageList({ messages, currentUserId }: { messages: Message[]; currentUserId: string }) {
  return (
    <div className="msg-list">
      {messages.map((m) => {
        const mine = m.senderId === currentUserId;
        return (
          <div key={m.id} className="msg-row" data-mine={mine ? 'true' : 'false'}>
            <div className="msg-bubble">
              <div className="msg-content">{m.content}</div>
              <div className="msg-time">{formatTime(m.createdAt)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
