import { usePresenceStore } from '../store/presence.store';

const LABEL: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '连接已断开',
};

export function ConnectionBadge() {
  const connection = usePresenceStore((s) => s.connection);
  return (
    <span className="conn-badge" data-status={connection} title={LABEL[connection] ?? connection}>
      {LABEL[connection] ?? connection}
    </span>
  );
}
