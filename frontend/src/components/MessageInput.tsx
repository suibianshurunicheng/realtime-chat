import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emitTypingStart, emitTypingStop } from '../socket/socket';

interface Props {
  conversationId: string;
  onSend: (content: string) => void;
}

const IDLE_STOP_MS = 2000; // emit typing_stop after 2s of no input
const HEARTBEAT_MS = 1000; // at most one typing_start per second while typing

export function MessageInput({ conversationId, onSend }: Props) {
  const [content, setContent] = useState('');

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);
  const lastStartAt = useRef(0);

  // Stop typing + reset throttle state when the conversation changes or the
  // component unmounts (switch / logout). Leaving a conversation must never
  // leave the peer stuck on "对方正在输入…".
  useEffect(() => {
    isTyping.current = false;
    lastStartAt.current = 0;
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      if (isTyping.current) {
        emitTypingStop(conversationId);
        isTyping.current = false;
      }
    };
  }, [conversationId]);

  const stopTyping = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (isTyping.current) {
      emitTypingStop(conversationId);
      isTyping.current = false;
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setContent(value);

    // Empty input means the user cleared the box — stop typing immediately.
    if (!value) {
      stopTyping();
      return;
    }

    // Refresh the idle timer on every keystroke.
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, IDLE_STOP_MS);

    const now = Date.now();
    if (!isTyping.current) {
      emitTypingStart(conversationId); // first keystroke of this burst
      isTyping.current = true;
      lastStartAt.current = now;
    } else if (now - lastStartAt.current >= HEARTBEAT_MS) {
      emitTypingStart(conversationId); // throttled heartbeat (~1/sec)
      lastStartAt.current = now;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    stopTyping(); // sending implies we stopped typing
    onSend(text);
    setContent('');
  };

  const canSend = content.trim().length > 0;

  return (
    <form className="msg-input" onSubmit={submit}>
      <input
        value={content}
        onChange={onChange}
        placeholder="输入消息…"
        autoComplete="off"
      />
      <button type="submit" disabled={!canSend}>
        发送
      </button>
    </form>
  );
}
