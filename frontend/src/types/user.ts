export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}
