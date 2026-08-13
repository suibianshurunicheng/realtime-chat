import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMe, logout } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';
import type { User } from '../types/user';

export function Home() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logoutStore = useAuthStore((s) => s.logout);
  const [me, setMe] = useState<User | null>(user);

  useEffect(() => {
    if (me) return;
    fetchMe()
      .then((u) => {
        setMe(u);
        setUser(u);
      })
      .catch(() => {
        logoutStore();
        navigate('/login', { replace: true });
      });
  }, [me, setUser, logoutStore, navigate]);

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      /* ignore network errors on logout */
    }
    logoutStore();
    navigate('/login', { replace: true });
  };

  return (
    <div className="home">
      <h1>欢迎，{me?.nickname ?? '...'}</h1>
      <p className="home-meta">用户名：{me?.username}</p>
      <button onClick={onLogout}>退出登录</button>
    </div>
  );
}
