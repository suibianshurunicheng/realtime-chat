import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { register } from '../api/auth.api';
import { useAuthStore } from '../store/auth.store';

export function Register() {
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { accessToken, user } = await register(username, password, nickname || username);
      setAuth(accessToken, user);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? '注册失败，请稍后重试');
    }
  };

  return (
    <div className="auth-card">
      <h1>注册</h1>
      <form onSubmit={onSubmit}>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          昵称
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <label>
          密码（至少 6 位）
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit">注册</button>
      </form>
      <p className="auth-switch">
        已有账号？<a href="/login">去登录</a>
      </p>
    </div>
  );
}
