import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emitTypingStart, emitTypingStop } from '../socket/socket';
import { uploadAttachment } from '../api/attachments.api';

interface Props {
  conversationId: string;
  onSend: (content: string, attachmentIds?: string[]) => void;
}

interface PendingItem {
  localId: string;
  fileName: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  attachmentId?: string;
  controller: AbortController;
  error?: string;
}

const IDLE_STOP_MS = 2000; // emit typing_stop after 2s of no input
const HEARTBEAT_MS = 1000; // at most one typing_start per second while typing

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MessageInput({ conversationId, onSend }: Props) {
  const [content, setContent] = useState('');
  const [pending, setPending] = useState<PendingItem[]>([]);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);
  const lastStartAt = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset typing + uploads when switching conversations (unmount / switch).
  useEffect(() => {
    isTyping.current = false;
    lastStartAt.current = 0;
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    // Abort any in-flight uploads for the previous conversation.
    setPending((prev) => {
      prev.forEach((p) => p.controller.abort());
      return [];
    });
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
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
    if (!value) {
      stopTyping();
      return;
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, IDLE_STOP_MS);
    const now = Date.now();
    if (!isTyping.current) {
      emitTypingStart(conversationId);
      isTyping.current = true;
      lastStartAt.current = now;
    } else if (now - lastStartAt.current >= HEARTBEAT_MS) {
      emitTypingStart(conversationId);
      lastStartAt.current = now;
    }
  };

  const startUpload = (file: File) => {
    const controller = new AbortController();
    const localId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const item: PendingItem = {
      localId,
      fileName: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading',
      controller,
    };
    setPending((prev) => [...prev, item]);

    uploadAttachment(conversationId, file, {
      signal: controller.signal,
      onProgress: (percent) =>
        setPending((prev) =>
          prev.map((p) => (p.localId === localId ? { ...p, progress: percent } : p)),
        ),
    })
      .then((view) => {
        setPending((prev) =>
          prev.map((p) =>
            p.localId === localId
              ? { ...p, status: 'done', progress: 100, attachmentId: view.id }
              : p,
          ),
        );
      })
      .catch((err) => {
        // Aborted uploads are simply removed; other failures stay as error chips.
        if (controller.signal.aborted) {
          setPending((prev) => prev.filter((p) => p.localId !== localId));
          return;
        }
        setPending((prev) =>
          prev.map((p) =>
            p.localId === localId
              ? {
                  ...p,
                  status: 'error',
                  error: err?.response?.data?.message ?? err?.message ?? '上传失败',
                }
              : p,
          ),
        );
      });
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(startUpload);
  };

  const removePending = (localId: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.localId === localId);
      target?.controller.abort();
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    const doneIds = pending
      .filter((p) => p.status === 'done' && p.attachmentId)
      .map((p) => p.attachmentId!);
    // Require either text or at least one successfully uploaded attachment.
    if (!text && doneIds.length === 0) return;
    // Do not send while an upload is still in flight.
    if (pending.some((p) => p.status === 'uploading')) return;

    stopTyping();
    onSend(text, doneIds.length ? doneIds : undefined);
    setContent('');
    setPending([]);
  };

  const canSend =
    (content.trim().length > 0 || pending.some((p) => p.status === 'done')) &&
    !pending.some((p) => p.status === 'uploading');

  return (
    <form className="msg-input" onSubmit={submit}>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="msg-input-tools">
        <button
          type="button"
          className="tool-btn"
          title="发送图片"
          onClick={() => imageInput.current?.click()}
        >
          图片
        </button>
        <button
          type="button"
          className="tool-btn"
          title="发送文件"
          onClick={() => fileInput.current?.click()}
        >
          文件
        </button>
      </div>

      <input
        value={content}
        onChange={onChange}
        placeholder="输入消息…"
        autoComplete="off"
      />

      {pending.length > 0 && (
        <div className="upload-chips">
          {pending.map((p) => (
            <div key={p.localId} className={`upload-chip status-${p.status}`}>
              <span className="chip-name" title={p.fileName}>
                {p.fileName}
              </span>
              <span className="chip-size">{formatSize(p.size)}</span>
              {p.status === 'uploading' && (
                <span className="chip-progress">{p.progress}%</span>
              )}
              {p.status === 'error' && (
                <span className="chip-error" title={p.error}>
                  失败
                </span>
              )}
              {p.status === 'done' && <span className="chip-done">✓</span>}
              <button
                type="button"
                className="chip-remove"
                onClick={() => removePending(p.localId)}
                title="移除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="submit" disabled={!canSend}>
        发送
      </button>
    </form>
  );
}
