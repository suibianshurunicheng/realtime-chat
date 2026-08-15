import { create } from 'zustand';
import type { ConversationView, Message } from '../types/chat';

interface ChatState {
  conversations: ConversationView[];
  activeConversationId: string | null;
  /** conversationId -> messages (oldest first). */
  messagesByConv: Record<string, Message[]>;
  /** conversationId -> last message preview (single source for the conversation list). */
  lastMessageByConv: Record<string, Message | null>;
  unreadByConv: Record<string, number>;
  hasMoreByConv: Record<string, boolean>;
  loadingConversations: boolean;
  loadingMessages: boolean;
  loadingOlder: boolean;
  error: string | null;

  setConversations: (list: ConversationView[]) => void;
  setActive: (id: string | null) => void;
  setMessages: (convId: string, msgs: Message[]) => void;
  setLastMessage: (convId: string, message: Message | null) => void;
  prependMessages: (convId: string, older: Message[]) => void;
  appendMessage: (msg: Message) => void;
  markHasMore: (convId: string, hasMore: boolean) => void;
  setLoadingConversations: (v: boolean) => void;
  setLoadingMessages: (v: boolean) => void;
  setLoadingOlder: (v: boolean) => void;
  setError: (msg: string | null) => void;
  clearUnread: (convId: string) => void;
  /** Wipe all chat state (used on logout). */
  clearAll: () => void;
}

const empty = {
  conversations: [] as ConversationView[],
  activeConversationId: null,
  messagesByConv: {} as Record<string, Message[]>,
  lastMessageByConv: {} as Record<string, Message | null>,
  unreadByConv: {} as Record<string, number>,
  hasMoreByConv: {} as Record<string, boolean>,
  loadingConversations: false,
  loadingMessages: false,
  loadingOlder: false,
  error: null,
};

export const useChatStore = create<ChatState>((set) => ({
  ...empty,

  setConversations: (list) => set({ conversations: list }),

  setActive: (id) =>
    set((s) => {
      const unread = { ...s.unreadByConv };
      if (id) delete unread[id];
      return { activeConversationId: id, unreadByConv: unread };
    }),

  setMessages: (convId, msgs) =>
    set((s) => {
      const last = msgs.length ? msgs[msgs.length - 1] : (s.lastMessageByConv[convId] ?? null);
      return {
        messagesByConv: { ...s.messagesByConv, [convId]: msgs },
        hasMoreByConv: { ...s.hasMoreByConv, [convId]: msgs.length >= 50 },
        lastMessageByConv: { ...s.lastMessageByConv, [convId]: last },
      };
    }),

  setLastMessage: (convId, message) =>
    set((s) => ({ lastMessageByConv: { ...s.lastMessageByConv, [convId]: message } })),

  prependMessages: (convId, older) =>
    set((s) => {
      const existing = s.messagesByConv[convId] ?? [];
      // Drop any overlaps to stay idempotent.
      const seen = new Set(existing.map((m) => m.id));
      const merged = [...older.filter((m) => !seen.has(m.id)), ...existing];
      return { messagesByConv: { ...s.messagesByConv, [convId]: merged } };
    }),

  appendMessage: (msg) =>
    set((s) => {
      const list = s.messagesByConv[msg.conversationId] ?? [];
      if (list.some((m) => m.id === msg.id)) return s; // dedup (self-send echo)
      const messagesByConv = { ...s.messagesByConv, [msg.conversationId]: [...list, msg] };
      const unreadByConv = { ...s.unreadByConv };
      if (s.activeConversationId !== msg.conversationId) {
        unreadByConv[msg.conversationId] = (unreadByConv[msg.conversationId] ?? 0) + 1;
      }
      return {
        messagesByConv,
        unreadByConv,
        lastMessageByConv: { ...s.lastMessageByConv, [msg.conversationId]: msg },
      };
    }),

  markHasMore: (convId, hasMore) =>
    set((s) => ({ hasMoreByConv: { ...s.hasMoreByConv, [convId]: hasMore } })),

  setLoadingConversations: (v) => set({ loadingConversations: v }),
  setLoadingMessages: (v) => set({ loadingMessages: v }),
  setLoadingOlder: (v) => set({ loadingOlder: v }),
  setError: (msg) => set({ error: msg }),

  clearUnread: (convId) =>
    set((s) => {
      const unread = { ...s.unreadByConv };
      delete unread[convId];
      return { unreadByConv: unread };
    }),

  clearAll: () => set({ ...empty }),
}));

/** Helper: the "other" user in a 1:1 conversation (not me). */
export function otherUser(conv: ConversationView, myId: string) {
  return conv.members.find((m) => m.id !== myId) ?? null;
}

/** Pure selector: sort conversations by most-recent activity (descending).
 *  Does NOT mutate the input array — callers use it inside useMemo. */
export function selectSortedConversations(
  conversations: ConversationView[],
  lastMessageByConv: Record<string, Message | null>,
): ConversationView[] {
  const ts = (c: ConversationView): number => {
    const ref = lastMessageByConv[c.id]?.createdAt ?? c.updatedAt ?? c.createdAt;
    const t = Date.parse(ref);
    return Number.isNaN(t) ? 0 : t;
  };
  return [...conversations].sort((a, b) => ts(b) - ts(a));
}
