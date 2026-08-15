import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTypingStore } from './typing.store';

describe('typing store', () => {
  beforeEach(() => {
    useTypingStore.getState().clearAll();
    vi.useRealTimers();
  });

  it('setTyping marks the given user as typing in a conversation', () => {
    useTypingStore.getState().setTyping('c1', '2');
    expect(useTypingStore.getState().typingByConversation['c1']).toBe('2');
  });

  it('setTyping(null) clears the typing flag', () => {
    useTypingStore.getState().setTyping('c1', '2');
    useTypingStore.getState().setTyping('c1', null);
    expect(useTypingStore.getState().typingByConversation['c1'] ?? null).toBeNull();
  });

  it('setTyping overwrites the previous typing user (update)', () => {
    useTypingStore.getState().setTyping('c1', '2');
    useTypingStore.getState().setTyping('c1', '3');
    expect(useTypingStore.getState().typingByConversation['c1']).toBe('3');
  });

  it('conversations are tracked independently', () => {
    useTypingStore.getState().setTyping('c1', '2');
    useTypingStore.getState().setTyping('c2', '3');
    expect(useTypingStore.getState().typingByConversation['c1']).toBe('2');
    expect(useTypingStore.getState().typingByConversation['c2']).toBe('3');
  });

  it('clearAll wipes every typing flag', () => {
    useTypingStore.getState().setTyping('c1', '2');
    useTypingStore.getState().setTyping('c2', '3');
    useTypingStore.getState().clearAll();
    expect(useTypingStore.getState().typingByConversation).toEqual({});
  });

  it('a 6s watchdog auto-clears typing if no heartbeat arrives', () => {
    vi.useFakeTimers();
    useTypingStore.getState().setTyping('c1', '2');
    expect(useTypingStore.getState().typingByConversation['c1']).toBe('2');
    vi.advanceTimersByTime(6000);
    expect(useTypingStore.getState().typingByConversation['c1'] ?? null).toBeNull();
  });

  it('a heartbeat resets the 6s watchdog so typing persists', () => {
    vi.useFakeTimers();
    useTypingStore.getState().setTyping('c1', '2'); // t=0
    vi.advanceTimersByTime(4000);
    useTypingStore.getState().setTyping('c1', '2'); // refresh at t=4000
    vi.advanceTimersByTime(4000); // t=8000, still within 6s of refresh
    expect(useTypingStore.getState().typingByConversation['c1']).toBe('2');
    vi.advanceTimersByTime(2000); // t=10000 = 6s after last refresh
    expect(useTypingStore.getState().typingByConversation['c1'] ?? null).toBeNull();
  });
});
