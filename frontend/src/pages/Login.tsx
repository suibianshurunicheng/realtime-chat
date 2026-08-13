import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { accessToken, user } = await login(username, password);
      setAuth(accessToken, user);
      const to = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      navigate(to, { replace: true });
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? '登录失败，请检查用户名或密码');
    }
  };

  return (
    <div className="auth-card">
      <h1>登录</h1>
      <form onSubmit={onSubmit}>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit">登录</button>
      </form>
      <p className="auth-switch">
        没有账号？<a href="/register">去注册</a>
      </p>
    </div>
  );
}
