import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatSocket } from '../hooks/useChatSocket';
import { useConversationPreview } from '../hooks/useConversationPreview';
import { useAuthStore } from '../store/auth.store';
import { useChatStore } from '../store/chat.store';
import { usePresenceStore } from '../store/presence.store';
import { useTypingStore } from '../store/typing.store';
import { listConversations, createDirectConversation } from '../api/conversations.api';
import {
  listFriends,
  getFriendsPresence,
  listReceivedRequests,
  acceptRequest,
  rejectRequest,
  sendFriendRequest,
} from '../api/friends.api';
import { logout as logoutApi } from '../api/auth.api';
import { fetchMe } from '../api/auth.api';
import { disconnectSocket } from '../socket/socket';
import { ConversationList } from './ConversationList';
import { FriendPicker } from './FriendPicker';
import { FriendRequests } from './FriendRequests';
import { ChatWindow } from './ChatWindow';
import { ConnectionBadge } from './ConnectionBadge';
import type { User } from '../types/user';
import type { FriendRequestView } from '../types/chat';

type Tab = 'conversations' | 'friends' | 'requests';

export function ChatApp() {
  useChatSocket();
  const conversations = useChatStore((s) => s.conversations);
  useConversationPreview(conversations);
  const navigate = useNavigate();

  const me = useAuthStore((s) => s.user);
  const logoutStore = useAuthStore((s) => s.logout);
  const setUser = useAuthStore((s) => s.setUser);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setConversations = useChatStore((s) => s.setConversations);
  const setActive = useChatStore((s) => s.setActive);
  const clearChat = useChatStore((s) => s.clearAll);
  const clearPresence = usePresenceStore((s) => s.clearAll);
  const clearTyping = useTypingStore((s) => s.clearAll);
  const applySnapshot = usePresenceStore((s) => s.applySnapshot);

  const [tab, setTab] = useState<Tab>('conversations');
  const [friends, setFriends] = useState<User[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [requests, setRequests] = useState<FriendRequestView[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [errorRequests, setErrorRequests] = useState<string | null>(null);

  // Restore the user object if only the token was persisted.
  useEffect(() => {
    if (me) return;
    fetchMe()
      .then(setUser)
      .catch(() => {
        logoutStore();
        navigate('/login', { replace: true });
      });
  }, [me]);

  const refreshRequests = () => {
    setLoadingRequests(true);
    setErrorRequests(null);
    listReceivedRequests()
      .then(setRequests)
      .catch(() => setErrorRequests('加载好友申请失败'))
      .finally(() => setLoadingRequests(false));
  };

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch(() => setConversations([]));
    setLoadingFriends(true);
    listFriends()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setLoadingFriends(false));
    getFriendsPresence()
      .then((list) => applySnapshot(list))
      .catch(() => {});
    setLoadingRequests(true);
    listReceivedRequests()
      .then(setRequests)
      .catch(() => setErrorRequests('加载好友申请失败'))
      .finally(() => setLoadingRequests(false));
  }, []);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  const onPickFriend = async (userId: string) => {
    try {
      const conv = await createDirectConversation(userId);
      setConversations(
        conversations.some((c) => c.id === conv.id) ? conversations : [conv, ...conversations],
      );
      setActive(conv.id);
      setTab('conversations');
    } catch {
      // 403 非好友 / 404 用户不存在 / 401 -> 交给现有刷新流程；此处静默
    }
  };

  const onAddFriend = async (userId: string) => {
    await sendFriendRequest(userId);
  };

  const onAcceptRequest = async (id: string) => {
    try {
      await acceptRequest(id);
      refreshRequests();
      listFriends()
        .then(setFriends)
        .catch(() => {});
    } catch {
      /* ignore failures; list stays as-is */
    }
  };

  const onRejectRequest = async (id: string) => {
    try {
      await rejectRequest(id);
      refreshRequests();
    } catch {
      /* ignore failures; list stays as-is */
    }
  };

  const onLogout = async () => {
    try {
      await logoutApi();
    } catch {
      /* ignore network errors on logout */
    }
    disconnectSocket();
    clearChat();
    clearPresence();
    clearTyping();
    logoutStore();
    navigate('/login', { replace: true });
  };

  return (
    <div className="chat-app">
      <header className="chat-topbar">
        <span className="chat-logo">实时聊天</span>
        <span className="chat-me">{me?.nickname}</span>
        <ConnectionBadge />
        <button className="chat-logout" onClick={onLogout}>
          退出
        </button>
      </header>

      <div className="chat-body">
        <aside className="chat-sidebar">
          <div className="sidebar-tabs">
            <button data-active={tab === 'conversations' ? 'true' : 'false'} onClick={() => setTab('conversations')}>
              会话
            </button>
            <button data-active={tab === 'friends' ? 'true' : 'false'} onClick={() => setTab('friends')}>
              好友
            </button>
            <button data-active={tab === 'requests' ? 'true' : 'false'} onClick={() => setTab('requests')}>
              申请
            </button>
          </div>
          <div className="sidebar-content">
            {tab === 'conversations' ? (
              <ConversationList onSelect={setActive} />
            ) : tab === 'friends' ? (
              <FriendPicker friends={friends} loading={loadingFriends} onPick={onPickFriend} onAddFriend={onAddFriend} />
            ) : (
              <FriendRequests
                requests={requests}
                loading={loadingRequests}
                error={errorRequests}
                onAccept={onAcceptRequest}
                onReject={onRejectRequest}
              />
            )}
          </div>
        </aside>

        <section className="chat-main">
          <ChatWindow conversation={activeConv} />
        </section>
      </div>
    </div>
  );
}
