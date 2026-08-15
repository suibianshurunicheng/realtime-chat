import { PresenceDot } from './PresenceDot';
import type { FriendRequestView } from '../types/chat';

function requestTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function FriendRequests({
  requests,
  loading,
  error,
  onAccept,
  onReject,
}: {
  requests: FriendRequestView[];
  loading: boolean;
  error: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (loading) return <div className="list-empty">加载申请中…</div>;
  if (error) return <div className="chat-error">{error}</div>;
  if (requests.length === 0) return <div className="list-empty">暂无好友申请</div>;

  return (
    <ul className="conv-list">
      {requests.map((r) => (
        <li key={r.id} className="conv-item" data-active="false">
          <PresenceDot online={false} />
          <div className="conv-main">
            <div className="conv-line">
              <span className="conv-name">{r.requester?.nickname ?? '未知用户'}</span>
              <span className="conv-time">{requestTime(r.createdAt)}</span>
            </div>
          </div>
          <div className="req-actions">
            <button className="req-btn req-btn-accept" onClick={() => onAccept(r.id)}>
              接受
            </button>
            <button className="req-btn req-btn-reject" onClick={() => onReject(r.id)}>
              拒绝
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
