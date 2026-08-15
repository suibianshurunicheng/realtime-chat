import client from './client';
import type { ConversationView, Message } from '../types/chat';

export async function listConversations(): Promise<ConversationView[]> {
  const resp = await client.get('/conversations');
  return resp.data.data as ConversationView[];
}

/** Create-or-get a 1:1 conversation. Non-friend -> 403, self -> 400, missing user -> 404. */
export async function createDirectConversation(userId: string): Promise<ConversationView> {
  const resp = await client.post('/conversations/direct', { userId });
  return resp.data.data as ConversationView;
}

/** Cursor-paginated history (oldest first within the page). `before` is a message id. */
export async function getMessages(
  conversationId: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (before) params.before = before;
  const resp = await client.get(`/conversations/${conversationId}/messages`, { params });
  return resp.data.data as Message[];
}
