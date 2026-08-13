import client from './client';
import type { AuthResponse, User } from '../types/user';

export async function register(
  username: string,
  password: string,
  nickname: string,
): Promise<AuthResponse> {
  const resp = await client.post('/auth/register', { username, password, nickname });
  return resp.data.data as AuthResponse;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const resp = await client.post('/auth/login', { username, password });
  return resp.data.data as AuthResponse;
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout');
}

export async function fetchMe(): Promise<User> {
  const resp = await client.get('/users/me');
  return resp.data.data as User;
}
