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
  readAt: null,
  recalledAt: null,
  editedAt: null,
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

describe('chat store applyMessageRecalled / applyMessageEdited (Phase 3.5)', () => {
  beforeEach(() => useChatStore.getState().clearAll());

  const RECALLED_AT = '2026-08-15T10:00:00.000Z';
  const EDITED_AT = '2026-08-15T11:00:00.000Z';

  it('applyMessageRecalled stamps recalledAt and blanks the body', () => {
    useChatStore.getState().setMessages('c1', [msg('m1'), msg('m2')]);
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm1',
      recalledAt: RECALLED_AT,
    });
    const list = useChatStore.getState().messagesByConv['c1']!;
    const m1 = list.find((m) => m.id === 'm1')!;
    expect(m1.recalledAt).toBe(RECALLED_AT);
    expect(m1.content).toBe('');
    // the sibling row is untouched
    expect(list.find((m) => m.id === 'm2')!.content).toBe('hi');
  });

  it('applyMessageRecalled keeps the conversation-list preview in sync', () => {
    useChatStore.getState().setMessages('c1', [msg('m1'), msg('m2')]);
    expect(useChatStore.getState().lastMessageByConv['c1']?.id).toBe('m2');
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm2',
      recalledAt: RECALLED_AT,
    });
    const preview = useChatStore.getState().lastMessageByConv['c1']!;
    expect(preview.recalledAt).toBe(RECALLED_AT);
    expect(preview.content).toBe('');
  });

  it('applyMessageRecalled leaves an older-message preview alone', () => {
    useChatStore.getState().setMessages('c1', [msg('m1'), msg('m2')]);
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm1',
      recalledAt: RECALLED_AT,
    });
    // the preview still points at m2, which was not recalled
    expect(useChatStore.getState().lastMessageByConv['c1']?.id).toBe('m2');
    expect(useChatStore.getState().lastMessageByConv['c1']?.recalledAt).toBeNull();
  });

  it('applyMessageRecalled is a no-op for an unknown message id / conversation', () => {
    useChatStore.getState().setMessages('c1', [msg('m1')]);
    const before = useChatStore.getState().messagesByConv;
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'nope',
      recalledAt: RECALLED_AT,
    });
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'ghost',
      messageId: 'm1',
      recalledAt: RECALLED_AT,
    });
    expect(useChatStore.getState().messagesByConv).toBe(before);
  });

  it('applyMessageRecalled is idempotent (second apply changes nothing)', () => {
    useChatStore.getState().setMessages('c1', [msg('m1')]);
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm1',
      recalledAt: RECALLED_AT,
    });
    const after = useChatStore.getState().messagesByConv;
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm1',
      recalledAt: '2026-08-15T23:59:59.000Z',
    });
    expect(useChatStore.getState().messagesByConv).toBe(after);
    expect(useChatStore.getState().messagesByConv['c1']![0].recalledAt).toBe(RECALLED_AT);
  });

  it('applyMessageRecalled does NOT touch unread counters or readAt', () => {
    useChatStore.getState().setActive('c1');
    useChatStore.getState().appendMessage(msg('m1', 'c2', '2')); // unread on c2
    const read = { ...msg('m2', 'c2', '2'), readAt: '2026-08-14T00:00:00.000Z' };
    useChatStore.getState().setMessages('c2', [read]);
    const unreadBefore = useChatStore.getState().unreadByConv['c2'];
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c2',
      messageId: 'm2',
      recalledAt: RECALLED_AT,
    });
    expect(useChatStore.getState().unreadByConv['c2']).toBe(unreadBefore);
    expect(useChatStore.getState().messagesByConv['c2']![0].readAt).toBe('2026-08-14T00:00:00.000Z');
  });

  it('applyMessageEdited overwrites content, stamps editedAt and syncs the preview', () => {
    useChatStore.getState().setMessages('c1', [msg('m1')]);
    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'm1',
      content: 'hi (fixed)',
      editedAt: EDITED_AT,
    });
    const m1 = useChatStore.getState().messagesByConv['c1']![0];
    expect(m1.content).toBe('hi (fixed)');
    expect(m1.editedAt).toBe(EDITED_AT);
    // same message is the preview -> stays consistent with the thread
    expect(useChatStore.getState().lastMessageByConv['c1']?.content).toBe('hi (fixed)');
    expect(useChatStore.getState().lastMessageByConv['c1']?.editedAt).toBe(EDITED_AT);
  });

  it('applyMessageEdited never resurrects a recalled message', () => {
    useChatStore.getState().setMessages('c1', [msg('m1')]);
    useChatStore.getState().applyMessageRecalled({
      conversationId: 'c1',
      messageId: 'm1',
      recalledAt: RECALLED_AT,
    });
    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'm1',
      content: 'should be ignored',
      editedAt: EDITED_AT,
    });
    const m1 = useChatStore.getState().messagesByConv['c1']![0];
    expect(m1.content).toBe('');
    expect(m1.recalledAt).toBe(RECALLED_AT);
    expect(m1.editedAt).toBeNull();
  });

  it('applyMessageEdited is a no-op for an unknown id and idempotent when re-applied', () => {
    useChatStore.getState().setMessages('c1', [msg('m1')]);
    const before = useChatStore.getState().messagesByConv;
    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'nope',
      content: 'x',
      editedAt: EDITED_AT,
    });
    expect(useChatStore.getState().messagesByConv).toBe(before);

    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'm1',
      content: 'v2',
      editedAt: EDITED_AT,
    });
    const after = useChatStore.getState().messagesByConv;
    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'm1',
      content: 'v2',
      editedAt: EDITED_AT,
    });
    expect(useChatStore.getState().messagesByConv).toBe(after);
  });

  it('applyMessageEdited preserves readAt and unread counters', () => {
    const read = { ...msg('m1'), readAt: '2026-08-14T00:00:00.000Z' };
    useChatStore.getState().setMessages('c1', [read]);
    useChatStore.getState().applyMessageEdited({
      conversationId: 'c1',
      messageId: 'm1',
      content: 'edited',
      editedAt: EDITED_AT,
    });
    const m1 = useChatStore.getState().messagesByConv['c1']![0];
    expect(m1.readAt).toBe('2026-08-14T00:00:00.000Z');
    expect(useChatStore.getState().unreadByConv['c1'] ?? 0).toBe(0);
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
