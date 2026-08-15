export function PresenceDot({ online }: { online?: boolean }) {
  return (
    <span
      className="presence-dot"
      data-online={online ? 'true' : 'false'}
      title={online ? '在线' : '离线'}
      aria-label={online ? '在线' : '离线'}
    />
  );
}
