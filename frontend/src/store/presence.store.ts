import { create } from 'zustand';
import type { ConnectionStatus, PresenceUser } from '../types/chat';

interface PresenceState {
  /** userId -> online. */
  presence: Record<string, boolean>;
  connection: ConnectionStatus;
  applySnapshot: (users: PresenceUser[]) => void;
  setPresence: (userId: string, online: boolean) => void;
  setConnection: (status: ConnectionStatus) => void;
  clearAll: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presence: {},
  connection: 'idle',

  applySnapshot: (users) =>
    set((s) => {
      const next = { ...s.presence };
      for (const u of users) next[u.userId] = u.online;
      return { presence: next };
    }),

  setPresence: (userId, online) =>
    set((s) => ({ presence: { ...s.presence, [userId]: online } })),

  setConnection: (status) => set({ connection: status }),

  clearAll: () => set({ presence: {}, connection: 'idle' }),
}));
