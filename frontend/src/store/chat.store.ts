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
  /** Phase 3.4: apply a read receipt (sender-view "已读"). */
  applyReadReceipt: (p: {
    conversationId: string;
    readerId: string;
    upToMessageId: string | null;
    readAt: string;
  }) => void;
  /** Phase 3.5: a message was recalled (server event `message_recalled`). */
  applyMessageRecalled: (p: {
    conversationId: string;
    messageId: string;
    recalledAt: string;
  }) => void;
  /** Phase 3.5: a message was edited in place (server event `message_edited`). */
  applyMessageEdited: (p: {
    conversationId: string;
    messageId: string;
    content: string;
    editedAt: string;
  }) => void;
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

  applyReadReceipt: ({ conversationId, readerId, upToMessageId, readAt }) =>
    set((s) => {
      const list = s.messagesByConv[conversationId];
      if (!list || list.length === 0) return s;
      // bigint ids compared numerically (never as strings). null upTo = all unread.
      const upTo = upToMessageId != null ? BigInt(upToMessageId) : null;
      let changed = false;
      const next = list.map((m) => {
        if (m.readAt) return m; // already read — skip (idempotent)
        if (m.senderId === readerId) return m; // reader's own message is never "read by them"
        if (upTo != null && BigInt(m.id) > upTo) return m; // beyond the receipt
        changed = true;
        return { ...m, readAt };
      });
      if (!changed) return s;
      return { messagesByConv: { ...s.messagesByConv, [conversationId]: next } };
    }),

  /**
   * Phase 3.5 recall. Patches the message in place (by id) and keeps the
   * conversation-list preview in sync, so the list and the thread can never
   * disagree about what was recalled.
   *
   * Rules: the body is blanked locally too (defence in depth — the server
   * already redacts it, the UI renders a placeholder off `recalledAt`); an
   * unknown id is a silent no-op (never inserts a stub row); re-applying the
   * same recall changes nothing; `unreadByConv` is deliberately untouched — a
   * recall is not a new message and must not shift unread counters.
   */
  applyMessageRecalled: ({ conversationId, messageId, recalledAt }) =>
    set((s) => {
      const patch = (m: Message): Message =>
        m.recalledAt ? m : { ...m, recalledAt, content: '' };

      const list = s.messagesByConv[conversationId];
      let nextList = list;
      if (list) {
        const idx = list.findIndex((m) => m.id === messageId);
        if (idx >= 0 && !list[idx].recalledAt) {
          nextList = [...list];
          nextList[idx] = patch(list[idx]);
        }
      }

      const last = s.lastMessageByConv[conversationId];
      const nextLast =
        last && last.id === messageId && !last.recalledAt ? patch(last) : last;

      if (nextList === list && nextLast === last) return s; // unknown id / already applied
      return {
        messagesByConv: nextList === list ? s.messagesByConv : { ...s.messagesByConv, [conversationId]: nextList! },
        lastMessageByConv:
          nextLast === last ? s.lastMessageByConv : { ...s.lastMessageByConv, [conversationId]: nextLast },
      };
    }),

  /**
   * Phase 3.5 edit. Overwrites `content` and stamps `editedAt` on the existing
   * row (and on the preview when it is the same message). A recalled message is
   * never re-shown: if the local copy is already recalled the edit is ignored
   * (the server rejects it too, this only guards a reordered delivery).
   * Unknown id = no-op; `unreadByConv` and `readAt` are untouched.
   */
  applyMessageEdited: ({ conversationId, messageId, content, editedAt }) =>
    set((s) => {
      const patch = (m: Message): Message =>
        m.recalledAt || (m.content === content && m.editedAt === editedAt)
          ? m
          : { ...m, content, editedAt };

      const list = s.messagesByConv[conversationId];
      let nextList = list;
      if (list) {
        const idx = list.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          const patched = patch(list[idx]);
          if (patched !== list[idx]) {
            nextList = [...list];
            nextList[idx] = patched;
          }
        }
      }

      const last = s.lastMessageByConv[conversationId];
      const nextLast = last && last.id === messageId ? patch(last) : last;

      if (nextList === list && nextLast === last) return s;
      return {
        messagesByConv: nextList === list ? s.messagesByConv : { ...s.messagesByConv, [conversationId]: nextList! },
        lastMessageByConv:
          nextLast === last ? s.lastMessageByConv : { ...s.lastMessageByConv, [conversationId]: nextLast },
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
