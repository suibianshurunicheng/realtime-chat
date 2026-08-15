import { create } from 'zustand';

/**
 * Ephemeral "typing" indicator per conversation. Maps conversationId -> the id
 * of the user currently typing (null = nobody). This is transient realtime
 * state only — never persisted to any store/DB, per Phase 3.3. It is kept
 * separate from chat.store so it can never pollute message/conversation state.
 */
interface TypingState {
  /** conversationId -> typing user id (null/undefined = nobody typing). */
  typingByConversation: Record<string, string | null>;
  /**
   * Set/refresh the typing user for a conversation.
   *  - `userId = string`  → mark that user as typing and (re)start a 6s watchdog
   *    that auto-clears the flag if no further heartbeat arrives (covers a lost
   *    stop event, network drop, or browser close).
   *  - `userId = null`    → clear immediately and cancel the watchdog.
   */
  setTyping: (conversationId: string, userId: string | null) => void;
  /** Wipe all typing state (logout). Cancels every pending watchdog timer. */
  clearAll: () => void;
}

// Per-conversation watchdog timers live outside React state (module-level).
const watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();
const WATCHDOG_MS = 6000;

function clearWatchdog(conversationId: string): void {
  const t = watchdogTimers.get(conversationId);
  if (t) {
    clearTimeout(t);
    watchdogTimers.delete(conversationId);
  }
}

function startWatchdog(
  conversationId: string,
  clear: (id: string) => void,
): void {
  clearWatchdog(conversationId);
  watchdogTimers.set(
    conversationId,
    setTimeout(() => {
      watchdogTimers.delete(conversationId);
      clear(conversationId);
    }, WATCHDOG_MS),
  );
}

export const useTypingStore = create<TypingState>((set) => ({
  typingByConversation: {},

  setTyping: (conversationId, userId) => {
    if (userId === null) {
      clearWatchdog(conversationId);
    } else {
      // Refresh the watchdog on every heartbeat so sustained typing stays true.
      startWatchdog(conversationId, (id) => {
        set((s) => {
          if (s.typingByConversation[id] === null) return s;
          const next = { ...s.typingByConversation };
          next[id] = null;
          return { typingByConversation: next };
        });
      });
    }
    set((s) => {
      if (s.typingByConversation[conversationId] === userId) return s; // no-op
      const next = { ...s.typingByConversation };
      next[conversationId] = userId;
      return { typingByConversation: next };
    });
  },

  clearAll: () => {
    for (const id of watchdogTimers.keys()) clearWatchdog(id);
    set({ typingByConversation: {} });
  },
}));
