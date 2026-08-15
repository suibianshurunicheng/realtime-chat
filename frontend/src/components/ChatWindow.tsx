import { useEffect, useLayoutEffect, useRef } from 'react';
import { useChatStore, otherUser } from '../store/chat.store';
import { usePresenceStore } from '../store/presence.store';
import { useAuthStore } from '../store/auth.store';
import { useTypingStore } from '../store/typing.store';
import { getMessages } from '../api/conversations.api';
import { sendSocketMessage, emitRead } from '../socket/socket';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { PresenceDot } from './PresenceDot';
import type { ConversationView } from '../types/chat';

export function ChatWindow({ conversation }: { conversation: ConversationView | null }) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const messages = useChatStore((s) => (conversation ? s.messagesByConv[conversation.id] : undefined));
  const loadingMessages = useChatStore((s) => s.loadingMessages);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const hasMore = useChatStore((s) => (conversation ? s.hasMoreByConv[conversation.id] : false));
  const error = useChatStore((s) => s.error);
  const setMessages = useChatStore((s) => s.setMessages);
  const prependMessages = useChatStore((s) => s.prependMessages);
  const markHasMore = useChatStore((s) => s.markHasMore);
  const clearUnread = useChatStore((s) => s.clearUnread);
  const setError = useChatStore((s) => s.setError);
  const presence = usePresenceStore((s) => s.presence);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prependRef = useRef(false);
  const prevHeight = useRef(0);
  const prevTop = useRef(0);

  const other = conversation ? otherUser(conversation, currentUserId) : null;

  // Who (if anyone) is currently typing in this conversation, per the realtime
  // typing store. `null` = nobody. We only surface it when it's the OTHER user.
  const typingUserId = useTypingStore((s) =>
    conversation ? (s.typingByConversation[conversation.id] ?? null) : null,
  );
  const isOtherTyping = !!typingUserId && !!other && typingUserId === other.id;

  // Initial / switched-conversation history load.
  useEffect(() => {
    if (!conversation) return;
    let cancelled = false;
    useChatStore.getState().setLoadingMessages(true);
    setError(null);
    clearUnread(conversation.id);
    getMessages(conversation.id, 50)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(conversation.id, msgs);
        markHasMore(conversation.id, msgs.length >= 50);
      })
      .catch(() => {
        if (!cancelled) setError('加载消息失败');
      })
      .finally(() => {
        if (!cancelled) useChatStore.getState().setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation?.id]);

  // Keep scroll stable: bottom on new messages, preserved on older prepend.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependRef.current) {
      prependRef.current = false;
      el.scrollTop = el.scrollHeight - prevHeight.current + prevTop.current;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !conversation) return;
    if (el.scrollTop < 40 && hasMore && !loadingOlder && !loadingMessages) {
      const list = useChatStore.getState().messagesByConv[conversation.id] ?? [];
      const oldest = list[0];
      if (!oldest) return;
      prependRef.current = true;
      prevHeight.current = el.scrollHeight;
      prevTop.current = el.scrollTop;
      useChatStore.getState().setLoadingOlder(true);
      getMessages(conversation.id, 50, oldest.id)
        .then((older) => {
          prependMessages(conversation.id, older);
          markHasMore(conversation.id, older.length >= 50);
        })
        .catch(() => setError('加载更早消息失败'))
        .finally(() => useChatStore.getState().setLoadingOlder(false));
    }
  };

  const onSend = (content: string) => {
    if (!conversation) return;
    setError(null);
    sendSocketMessage(conversation.id, content);
  };

  // Phase 3.4: mark the OTHER party's unread messages as read whenever we are
  // actively viewing this conversation and there's something unread from them.
  // Covers both "opened the chat" and "received a new message while open".
  // Idempotent — the server only touches rows with readAt IS NULL, so re-firing
  // (e.g. when a receipt updates our own messages) is a harmless no-op.
  useEffect(() => {
    if (!conversation) return;
    const list = messages ?? [];
    const hasUnreadFromOther = list.some(
      (m) => m.senderId !== currentUserId && !m.readAt,
    );
    if (!hasUnreadFromOther) return;
    const lastId = list[list.length - 1]?.id;
    if (lastId) emitRead(conversation.id, lastId);
  }, [messages, conversation?.id, currentUserId]);

  if (!conversation) {
    return <div className="chat-empty">选择一个会话开始聊天</div>;
  }

  const list = messages ?? [];

  return (
    <div className="chat-window">
      <div className="chat-header">
        <PresenceDot online={other ? presence[other.id] : false} />
        <span className="chat-title">{other?.nickname ?? '未知用户'}</span>
        {isOtherTyping && <span className="chat-typing">对方正在输入…</span>}
      </div>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {loadingMessages ? (
          <div className="chat-hint">加载中…</div>
        ) : list.length === 0 ? (
          <div className="chat-hint">暂无消息</div>
        ) : (
          <>
            {hasMore && <div className="chat-hint">{loadingOlder ? '加载更早消息…' : '向上滚动加载更早消息'}</div>}
            <MessageList messages={list} currentUserId={currentUserId} />
          </>
        )}
      </div>

      {error && <div className="chat-error">{error}</div>}
      <MessageInput conversationId={conversation.id} onSend={onSend} />
    </div>
  );
}
