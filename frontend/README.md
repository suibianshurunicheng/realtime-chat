# Frontend

React 18 + TypeScript + Vite scaffold for the realtime chat app.

## Scripts
- `npm run dev` — Vite dev server on http://localhost:5173 (proxies `/api` → backend :3000, `/ws` → ws :3000)
- `npm run build` — type-check (`tsc -b`) + production build to `dist/`
- `npm run preview` — preview the production build

## Notes
- **Phase 0 skeleton**: no pages, routing, or state management wired yet.
- The backend base URL is supplied by the Vite dev proxy — no hardcoded endpoint.
- Package manager: `npm` (lockfile committed).
