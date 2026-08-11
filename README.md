# 实时聊天 Web 应用（Real-time Chat Web）

实时聊天 Web 应用 —— **Phase 0 脚手架（仅项目基础，无任何业务代码）**。

## 技术栈（已锁定）

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | NestJS 10 + Socket.IO（WebSocket） |
| 数据库 | MySQL 8 |
| 缓存 / 消息 | Redis 6 |
| 包管理 | npm |

## 目录结构

```
.
├── frontend/   # React + TS + Vite 前端（仅骨架，无页面/路由/状态）
├── backend/    # NestJS + Socket.IO 后端（仅启动入口，无业务模块）
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

- **Phase 0 — 项目初始化**：本提交只包含规范的目录结构、依赖清单、最小启动入口与文档，**不含任何登录 / 聊天 / 好友等业务逻辑**。
- 业务功能从 Phase 1 起按计划陆续实现。
