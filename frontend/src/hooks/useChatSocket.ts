import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/auth.store';
import { connectSocket, disconnectSocket } from '../socket/socket';

/**
 * Owns the single chat socket for the session.
 * - First connect (or token rotation from refresh) -> (re)create the socket with the
 *   current access token. Listeners are bound once inside connectSocket, so switching
 *   conversations never re-registers them.
 * - accessToken -> null (logout) -> tear the socket down.
 * No disconnect on normal unmount: the socket is a session-wide singleton, not a
 * per-page resource. StrictMode double-invocation is harmless because the singleton
 * guard + lastToken ref make connect idempotent.
 */
export function useChatSocket(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      disconnectSocket();
      lastToken.current = null;
      return;
    }
    if (lastToken.current !== accessToken) {
      disconnectSocket();
      connectSocket(accessToken);
      lastToken.current = accessToken;
    }
  }, [accessToken]);
}
