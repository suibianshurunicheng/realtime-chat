# 数据库设计（DATABASE）

> **本文件为占位文档。** 完整的库表定义、索引、约束与 Redis 结构已在 [系统设计.md](系统设计.md) 中给出，是当前的权威来源。本文件用于记录后续迁移（migration）/ 种子（seed）/ 环境差异。

## 采用的存储

- **关系库**：MySQL 8
- **缓存 / 消息**：Redis 6

## 数据表（概要，详见系统设计）

| 表 | 用途 |
|---|---|
| `users` | 用户账户、资料、头像 |
| `friendships` | 好友关系（唯一对 `uk_pair`） |
| `friend_requests` | 好友申请（唯一对 `uk_req`，防并发重复） |
| `messages` | 单聊消息（雪花 ID 保序） |

## Redis 结构（概要）

| Key 模式 | 用途 | TTL |
|---|---|---|
| `online:{userId}` | 在线状态/连接快照 | 会话级 |
| `unread:{userId}:{peerId}` | 未读计数 | 长期 |
| `session:{userId}` | 会话索引 | 长期 |

> 降级策略：Redis 不可用时回退 MySQL 重算未读/在线（详见系统设计）。

## TODO（Phase 1 落地）

- [ ] 选定 ORM（TypeORM / Prisma）并初始化 migration
- [ ] 写入建表 DDL（来源：系统设计.md）
- [ ] 本地 WSL2 MySQL 实例初始化（见 [DEVELOPMENT.md](DEVELOPMENT.md)）
- [ ] 种子数据脚本（开发用）
