import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat.store';
import { getMessages } from '../api/conversations.api';

/**
 * Batch-loads the latest message for every conversation to power the
 * conversation-list preview. Uses Promise.allSettled so a single failing
 * conversation never breaks the whole list; failures simply yield `null`.
 *
 * Re-fetches only when the *set* of conversation ids changes (idsKey),
 * never on message/order churn — keeping it cheap and StrictMode-safe.
 */
export function useConversationPreview(conversations: { id: string }[]): { loading: boolean } {
  const setLastMessage = useChatStore((s) => s.setLastMessage);
  const [loading, setLoading] = useState(false);
  const cancelled = useRef(false);
  const idsKey = conversations.map((c) => c.id).join(',');

  useEffect(() => {
    if (!idsKey) return;
    cancelled.current = false;
    setLoading(true);
    const ids = idsKey.split(',');
    Promise.allSettled(ids.map((id) => getMessages(id, 1)))
      .then((results) => {
        if (cancelled.current) return;
        ids.forEach((id, i) => {
          const r = results[i];
          if (r.status === 'fulfilled') {
            const arr = r.value;
            setLastMessage(id, arr.length ? arr[arr.length - 1] : null);
          } else {
            setLastMessage(id, null);
          }
        });
      })
      .finally(() => {
        if (!cancelled.current) setLoading(false);
      });
    return () => {
      cancelled.current = true;
    };
  }, [idsKey]);

  return { loading };
}
