import { useState } from 'react';
import { usePresenceStore } from '../store/presence.store';
import { PresenceDot } from './PresenceDot';
import { searchUsers } from '../api/friends.api';
import type { User } from '../types/user';

export function FriendPicker({
  friends,
  loading,
  onPick,
  onAddFriend,
}: {
  friends: User[];
  loading: boolean;
  onPick: (userId: string) => void;
  onAddFriend: (userId: string) => Promise<void>;
}) {
  const presence = usePresenceStore((s) => s.presence);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchUsers(q.trim()));
    } finally {
      setSearching(false);
    }
  };

  const list = results ?? friends;
  const friendIds = new Set(friends.map((f) => f.id));

  const handleAdd = async (userId: string) => {
    try {
      await onAddFriend(userId);
      setSentIds((s) => new Set(s).add(userId));
    } catch (e) {
      // 409 已好友 / 已存在待处理申请 -> 视为已发送，避免重复点击
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) setSentIds((s) => new Set(s).add(userId));
    }
  };

  return (
    <div className="friend-picker">
      <input
        className="friend-search"
        placeholder="搜索用户…"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
      />
      {loading && !results ? (
        <div className="list-empty">加载好友中…</div>
      ) : list.length === 0 ? (
        <div className="list-empty">{results ? '无匹配用户' : '暂无好友'}</div>
      ) : (
        <ul className="conv-list">
          {list.map((u) => {
            const isFriend = friendIds.has(u.id);
            const sent = sentIds.has(u.id);
            return (
              <li key={u.id} className="conv-item" data-active="false">
                <PresenceDot online={presence[u.id]} />
                <div className="conv-main">
                  <div className="conv-line">
                    <span className="conv-name">{u.nickname}</span>
                  </div>
                </div>
                {isFriend ? (
                  <button
                    className="friend-pick-btn"
                    disabled={searching}
                    onClick={() => onPick(u.id)}
                  >
                    发消息
                  </button>
                ) : (
                  <button
                    className="friend-pick-btn"
                    data-sent={sent ? 'true' : 'false'}
                    disabled={searching || sent}
                    onClick={() => handleAdd(u.id)}
                  >
                    {sent ? '已发送' : '添加好友'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
