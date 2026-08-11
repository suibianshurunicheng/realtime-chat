# Backend

NestJS 10 + Socket.IO backend for the realtime chat app.

## Stack
- NestJS 10 (platform-express)
- Socket.IO 4 (WebSocket) — dependency included; gateway wired in a later phase
- MySQL 8 (ORM: TypeORM or Prisma — to be decided in Phase 1)
- Redis 6 (cache / presence / pub-sub)

## Scripts
- `npm run start:dev` — watch mode on http://localhost:3000
- `npm run build` — compile to `dist/`
- `npm run start:prod` — run compiled output

## Environment
Copy `.env.example` to `.env` and fill in secrets. **Never commit `.env`.**

## Notes
- **Phase 0 skeleton**: only the bootstrap entry (`src/main.ts`) and an empty root module
  (`src/app.module.ts`) exist. No controllers, services, or WebSocket gateways yet.
- ORM choice and DB connection are deferred to Phase 1.
