import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

/**
 * App shell. The chat UI (ChatApp) renders its own top bar, so this stays minimal —
 * just a full-height column container. Auth gating is handled by ProtectedRoute.
 */
export function Layout({ children }: { children?: ReactNode }) {
  return <div className="app-shell">{children ?? <Outlet />}</div>;
}
