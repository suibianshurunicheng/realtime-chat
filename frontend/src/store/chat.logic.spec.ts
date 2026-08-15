import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, otherUser } from './chat.store';
import { usePresenceStore } from './presence.store';
import type { ConversationView, Message } from '../types/chat';
import type { User } from '../types/user';

const me: User = { id: '1', username: 'a', nickname: 'A', avatar: null, status: 'active', createdAt: '' };
const bob: User = { id: '2', username: 'b', nickname: 'B', avatar: null, status: 'active', createdAt: '' };

const conv = (id = 'c1'): ConversationView => ({
  id,
  type: 'direct',
  createdAt: '',
  updatedAt: '',
  members: [me, bob],
});

const msg = (id: string, conversationId = 'c1', senderId = '2'): Message => ({
  id,
  conversationId,
  senderId,
  type: 'text',
  content: 'hi',
  createdAt: new Date().toISOString(),
});

describe('chat store', () => {
  beforeEach(() => useChatStore.getState().clearAll());

  it('appendMessage adds a message and never duplicates by id (self-send echo)', () => {
    useChatStore.getState().setMessages('c1', []);
    useChatStore.getState().appendMessage(msg('m1', 'c1', '2'));
    useChatStore.getState().appendMessage(msg('m1', 'c1', '2'));
    expect(useChatStore.getState().messagesByConv['c1']).toHaveLength(1);
  });

  it('appendMessage increments unread for a non-active conversation', () => {
    useChatStore.getState().setActive('c1');
    useChatStore.getState().appendMessage(msg('x', 'c2', '2'));
    expect(useChatStore.getState().unreadByConv['c2']).toBe(1);
  });

  it('appendMessage does NOT increment unread for the active conversation', () => {
    useChatStore.getState().setActive('c2');
    useChatStore.getState().appendMessage(msg('x', 'c2', '2'));
    expect(useChatStore.getState().unreadByConv['c2'] ?? 0).toBe(0);
  });

  it('setActive clears unread for that conversation', () => {
    useChatStore.getState().appendMessage(msg('x', 'c2', '2'));
    expect(useChatStore.getState().unreadByConv['c2']).toBe(1);
    useChatStore.getState().setActive('c2');
    expect(useChatStore.getState().unreadByConv['c2'] ?? 0).toBe(0);
  });

  it('prependMessages preserves ascending order and dedups', () => {
    useChatStore.getState().setMessages('c1', [msg('m2', 'c1'), msg('m3', 'c1')]);
    useChatStore.getState().prependMessages('c1', [msg('m1', 'c1')]);
    expect(useChatStore.getState().messagesByConv['c1']!.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('clearAll resets all chat state', () => {
    useChatStore.getState().setActive('c1');
    useChatStore.getState().appendMessage(msg('x', 'c1', '2'));
    useChatStore.getState().clearAll();
    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(useChatStore.getState().conversations).toEqual([]);
    expect(useChatStore.getState().messagesByConv).toEqual({});
  });

  it('setLastMessage updates the preview for a conversation', () => {
    useChatStore.getState().setLastMessage('c1', msg('m9', 'c1', '2'));
    expect(useChatStore.getState().lastMessageByConv['c1']?.id).toBe('m9');
  });

  it('appendMessage updates lastMessageByConv and keeps unread logic', () => {
    useChatStore.getState().setActive('c1');
    useChatStore.getState().appendMessage(msg('m1', 'c2', '2'));
    expect(useChatStore.getState().lastMessageByConv['c2']?.id).toBe('m1');
    expect(useChatStore.getState().unreadByConv['c2']).toBe(1);
  });

  it('prependMessages does NOT change lastMessageByConv (only setMessages/appendMessage do)', () => {
    // Initial load sets the preview to the latest message of the page (m3).
    useChatStore.getState().setMessages('c1', [msg('m2', 'c1'), msg('m3', 'c1')]);
    expect(useChatStore.getState().lastMessageByConv['c1']?.id).toBe('m3');
    // Loading OLDER messages must NOT move the preview forward.
    useChatStore.getState().prependMessages('c1', [msg('m1', 'c1')]);
    expect(useChatStore.getState().lastMessageByConv['c1']?.id).toBe('m3');
  });

  it('clearAll wipes lastMessageByConv', () => {
    useChatStore.getState().setLastMessage('c1', msg('m9', 'c1', '2'));
    useChatStore.getState().clearAll();
    expect(useChatStore.getState().lastMessageByConv).toEqual({});
  });
});

describe('otherUser helper', () => {
  it('returns the member that is not me', () => {
    expect(otherUser(conv(), '1')?.id).toBe('2');
    expect(otherUser(conv(), '2')?.id).toBe('1');
  });
});

describe('presence store', () => {
  beforeEach(() => usePresenceStore.getState().clearAll());

  it('applySnapshot fills the presence map', () => {
    usePresenceStore.getState().applySnapshot([
      { userId: '2', online: true },
      { userId: '3', online: false },
    ]);
    expect(usePresenceStore.getState().presence['2']).toBe(true);
    expect(usePresenceStore.getState().presence['3']).toBe(false);
  });

  it('setPresence updates a single user', () => {
    usePresenceStore.getState().setPresence('2', true);
    usePresenceStore.getState().setPresence('2', false);
    expect(usePresenceStore.getState().presence['2']).toBe(false);
  });
});
