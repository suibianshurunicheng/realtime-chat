import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../store/auth.store';
import { singleFlight } from './single-flight';

const client = axios.create({
  baseURL: '/api',
  withCredentials: true, // send the httpOnly refresh-token cookie
});

// Collapse concurrent 401s into a single refresh call.
const refreshOnce = singleFlight(refreshToken);

// Attach the access token to every outgoing request.
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, attempt a single silent refresh, then retry the original request.
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (Record<string, unknown> & { _retry?: boolean; headers?: Record<string, string> }) | undefined;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const { accessToken } = await refreshOnce();
        useAuthStore.getState().setAccessToken(accessToken);
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${accessToken}`;
        return client(original);
      } catch {
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

async function refreshToken(): Promise<{ accessToken: string }> {
  const token = useAuthStore.getState().accessToken;
  const resp = await axios.post(
    '/api/auth/refresh',
    {},
    {
      withCredentials: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  return resp.data.data as { accessToken: string };
}

export default client;
