# 实时聊天 Web 应用（Real-time Chat Web）

实时聊天 Web 应用 —— **Phase 1 已完成（认证模块）**。本期仅实现单聊所需的账号体系：注册 / 登录 / 刷新 / 登出 / 当前用户，不含好友与聊天（后续 Phase）。

## 技术栈（已锁定）

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | NestJS 10 + Socket.IO（WebSocket） |
| 数据库 | MySQL 8（TypeORM） |
| 缓存 / 消息 | Redis 6（ioredis，存储刷新令牌哈希） |
| 鉴权 | 双 token：access=JWT(@nestjs/jwt)，refresh=不透明随机串（httpOnly Cookie + Redis 哈希） |
| 包管理 | npm |

## 目录结构

```
.
├── frontend/   # React + TS + Vite 前端（router / axios 封装 / Zustand 登录态 / 登录·注册·首页）
├── backend/    # NestJS 后端：auth(注册/登录/刷新/登出) + users(/me) + config/database/redis 模块
│   └── test/   # e2e：auth.e2e-spec.ts（7 场景，test:e2e 跑）
├── docs/       # 项目文档（架构 / 数据库 / API / 开发环境 + 设计稿）
└── README.md
```

## 快速开始

详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

- 前端：`cd frontend && npm install && npm run dev` → http://localhost:5173
- 后端：`cd backend && npm install && cp .env.example .env && npm run start:dev` → http://localhost:3000

## 设计文档

- [需求评审与开发计划](docs/需求评审与开发计划.md)
- [系统设计（数据库 / 接口 / 业务流程）](docs/系统设计.md)
- 页面原型：飞书画板（token `OdFYwOyFwhA7h4b53hLc5yFGnYf`）

## 分支策略

`main`（受保护，仅合入已评审的 `develop`）← `develop`（集成分支）← `feature/*`（按模块，如 `feature/auth`）。
详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#分支与协作流程)。

## 当前状态

- **Phase 0 — 项目初始化**：目录结构、依赖清单、最小启动入口与文档。
- **Phase 1 — 认证模块（已实现并落盘）**：注册 / 登录 / 刷新 / 登出 / 当前用户；统一响应包装 + 全局异常过滤；access=JWT、refresh=httpOnly Cookie + Redis 哈希（决策 D3/D7）。前端含路由守卫、axios 401 自动刷新、Zustand 持久化登录态。详见 [docs/API.md](docs/API.md) 与 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
- 好友 / 单聊 / WebSocket / 图片消息：未实现（后续 Phase）。
