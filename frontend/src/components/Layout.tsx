import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="logo">实时聊天</span>
      </header>
      <main className="app-main">{children ?? <Outlet />}</main>
    </div>
  );
}
