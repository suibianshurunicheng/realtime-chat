import client from './client';
import type { User } from '../types/user';
import type { FriendRequestView } from '../types/chat';

export async function listFriends(): Promise<User[]> {
  const resp = await client.get('/friends');
  return resp.data.data as User[];
}

/** Search users by username/nickname (excludes self). Empty query -> []. */
export async function searchUsers(q: string): Promise<User[]> {
  const resp = await client.get('/users/search', { params: { q } });
  return resp.data.data as User[];
}

/** REST fallback for presence (socket also pushes live updates). */
export async function getFriendsPresence(): Promise<{ userId: string; online: boolean }[]> {
  const resp = await client.get('/friends/presence');
  return resp.data.data as { userId: string; online: boolean }[];
}

/** Send a friend request. 409 -> already friend / pending; 404 -> user missing. */
export async function sendFriendRequest(addresseeId: string): Promise<void> {
  await client.post('/friends/requests', { addresseeId });
}

/** List pending friend requests received by me. */
export async function listReceivedRequests(): Promise<FriendRequestView[]> {
  const resp = await client.get('/friends/requests');
  return resp.data.data as FriendRequestView[];
}

/** Accept a received friend request (creates the friendship). */
export async function acceptRequest(id: string): Promise<void> {
  await client.post(`/friends/requests/${id}/accept`);
}

/** Reject a received friend request. */
export async function rejectRequest(id: string): Promise<void> {
  await client.post(`/friends/requests/${id}/reject`);
}
