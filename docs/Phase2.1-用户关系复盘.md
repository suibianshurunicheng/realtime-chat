# Phase 2.1 用户关系 / 好友系统 — 复盘

> 完成依据：磁盘源码 + 编译退出码 + `migration:run` 结果 + e2e 结果（非口头描述）。
> 范围：仅用户关系 / 好友系统。未触碰 WebSocket、Message、Conversation、图片系统，也未改动已验收的认证体系（JWT / refresh / sid / jti / Redis 黑名单 / login / register / logout / refresh）。

---

## 1. 实际修改文件

**新增**
- `backend/src/friends/entities/friend-request.entity.ts` — 好友申请实体
- `backend/src/friends/entities/friendship.entity.ts` — 好友关系实体
- `backend/src/friends/friends.service.ts` — 好友业务逻辑
- `backend/src/friends/friends.controller.ts` — 好友 REST 接口
- `backend/src/friends/friends.module.ts` — 好友模块
- `backend/src/friends/dto/send-request.dto.ts` — 发申请 DTO
- `backend/src/migrations/1737000000000-CreateFriendTables.ts` — 新建两张表的 migration（不改动 baseline）
- `backend/test/friends.e2e-spec.ts` — 好友 e2e（16 例）

**修改**
- `backend/src/users/users.service.ts` — 新增 `search(me, q)`（用户域搜索，好友系统依赖）
- `backend/src/users/users.controller.ts` — 新增 `GET /users/search`（按规范归属 users 域）
- `backend/src/app.module.ts` — 注册 `FriendsModule`

**未改动（确认）**：`auth/*`、`redis/*`、`common/guards/jwt-auth.guard.ts`、User 实体、baseline migration、Phase 1.5 日志/异常体系、`frontend/*`。

---

## 2. 数据库表结构

**friend_requests**（好友申请，定向）
| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK AI | |
| requesterId | bigint | 发起人 A |
| addresseeId | bigint | 接收人 B |
| status | varchar(16) | `pending`/`accepted`/`rejected`，默认 `pending` |
| pendingFlag | tinyint **VIRTUAL 生成列** | `status='pending' THEN 1 ELSE NULL` |
| created_at / updated_at | datetime(6) | |

**friendships**（已建立关系，单向一行表示无向关系）
| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint PK AI | |
| userId | bigint | 一方 |
| friendId | bigint | 另一方 |
| userLow | bigint **STORED 生成列** | `LEAST(userId, friendId)` |
| userHigh | bigint **STORED 生成列** | `GREATEST(userId, friendId)` |
| created_at | datetime(6) | |

两表均含 FK 指向 `users(id)`。

---

## 3. API 清单

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/users/search?q=` | JwtAuthGuard | 搜索用户（排除自己），LIMIT 20 |
| POST | `/api/friends/requests` | JwtAuthGuard | 发申请 `{addresseeId}` → 201 |
| GET | `/api/friends/requests` | JwtAuthGuard | 我收到的 pending 申请 |
| POST | `/api/friends/requests/:id/accept` | JwtAuthGuard | 同意（仅接收人） |
| POST | `/api/friends/requests/:id/reject` | JwtAuthGuard | 拒绝（仅接收人） |
| DELETE | `/api/friends/requests/:id` | JwtAuthGuard | 取消（仅发起人）— 补需求三.4 |
| GET | `/api/friends` | JwtAuthGuard | 我的好友列表 |
| DELETE | `/api/friends/:userId` | JwtAuthGuard | 删除好友 |

所有接口从 `req.user.sub` 取当前用户，绝不信任客户端传入的 userId。

---

## 4. 状态流转

```
A 发申请 → friend_requests(status=pending)
B accept  → status=accepted 且写入 friendships(A,B)
B reject  → status=rejected（不写 friendships）
A cancel  → 删除该 pending 行（仅发起人）
```

`accepted`/`rejected` 行**保留为历史**；`friendships` 是当前关系事实（满足四节“不把状态全塞进 friendships”）。

---

## 5. 索引 / unique constraint（DB 层优先，业务层再兜底）

- `friend_requests`：
  - `UNIQUE(requesterId, addresseeId, pendingFlag)` — 因 pendingFlag 对非 pending 为 NULL，MySQL 唯一索引忽略 NULL，故**同时只允许一个 pending**，accepted/rejected 历史可共存（满足三.6；拒绝后允许重新申请）。
  - `KEY(addresseeId, status)` — 收件箱查询。
  - FK `requesterId`/`addresseeId` → `users(id)`。
- `friendships`：
  - `UNIQUE(userLow, userHigh)` — **杜绝 A→B 与 B→A 重复关系**（满足三.8）。
  - `KEY(userId)`。
  - FK `userId`/`friendId` → `users(id)`。
- 业务层校验：非自己、非已是好友（409）、无 pending（409）、所有权（403/404）、已处理（409）、并发唯一约束冲突转 409。

---

## 6. 新增测试

`test/friends.e2e-spec.ts`（16 例，全部覆盖需求八）：
1. A 搜索 B（且不包含自己）
2. A 发申请给 B
3. B 查看收到的申请
4–6. B 同意；A/B 好友列表互现
7. A 不能重复添加 B
8. A 不能添加自己
9. B 拒绝申请
10. 非接收者不能 accept（403）
11. 非接收者不能 reject（403）
12–13. 删除好友；双方互不可见
14. 并发重复申请 → 仅 1 个 pending + 1 个 friendship（无重复）
15. 发起人取消 pending；取消后可重新申请
16. 未登录访问好友接口 → 401

认证原 9 例（含 Phase 1 原 7）全部不受影响、继续通过。

---

## 7. 遇到的问题

1. **NestJS 本机版本 ModuleMetadata 未声明 `global`**：试图给 `RedisModule` 加 `global:true` 触发 TS2353。沿用项目既有模式（用到 Guard 的模块 `providers:[JwtAuthGuard]` + `imports:[RedisModule]`），不加 global。
2. **实体列名与 migration 列名不一致**：项目约定“实体属性名即列名（仅 `created_at`/`updated_at` 显式 snake）”。初版 migration 误用 snake_case 列名，TypeORM 的 SELECT 用实体属性名（`userId` 等）找不到列 → `Unknown column`。改为 camelCase 列名并同步修正 QueryBuilder 中的裸列名（`f.userId`/`f.friendId`）。
3. **并发重复发申请会撞唯一约束抛 500**：`sendRequest` 与 `friendship.save` 捕获 `ER_DUP_ENTRY`（`QueryFailedError`）转 `ConflictException(409)`，保证并发不产生 500、不产生脏数据。
4. **路由归属**：用户搜索按规范放 `GET /users/search`（UsersController 用户域），未塞进 FriendsController。
5. **WSL2 验证环境**：Windows↔WSL2 隧道不稳，统一在 WSL2 内用 Linux Node（`/usr/bin/node`）跑 e2e 与 `migration:run`（证明代码正确；用户本地用标准 `DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e` 即可复现）。

---

## 8. build / tsc / lint / migration / e2e 结果

| 项 | 结果 |
|---|---|
| `nest build` | ✅ |
| `tsc --noEmit` | ✅ |
| `eslint`（后端） | ✅ 0 problem |
| `migration:run`（干净库） | ✅ 建 `users/friend_requests/friendships/migrations/typeorm_metadata`；二次运行 `No migrations are pending` |
| e2e（WSL2 内 Linux node） | ✅ **22/22**（auth 9 + friends 16；原 7/7 无回归） |
| synchronize 依赖 | ✅ 无（全靠 migration 重建） |
| TypeScript error | ✅ 无 |
| 越权测试 | ✅ 10/11 非接收者 accept/reject 均 403 |

---

## 9. 遗留问题

- **删除好友不清理双方残留 pending 申请**：功能不受影响（历史保留），如要求严格可加“删除好友时一并取消彼此 pending 申请”（非必须）。
- **拉黑 / block 关系未实现**：本期范围外。后续 Phase 需明确优先级与状态规则（如被拉黑方不可发起申请、不出现在搜索结果）。
- **搜索防暴搜**：仅 `LIMIT 20`，无频率限制；如上线建议加限流。
- **前端未同步**：本阶段仅后端 API + e2e，前端好友 UI（搜索/申请/列表/删除）属后续。
- **沙箱 git 不持久**：源码已落盘 `D:\MY-WEB`，提交由用户本地执行（见下）。

---

## 10. 下一阶段建议

- **Phase 2.2 会话(Conversation) / 消息(Message) + WebSocket(Socket.IO) 实时通信**：复用 `JwtAuthGuard` 与 Redis（架构已为横向扩展预留 Redis Pub/Sub 入口）。
- **拉黑关系模型**设计（与好友系统正交，优先级高于好友申请）。
- **前端好友 UI**（搜索 / 申请 / 列表 / 删除 / 实时状态）。
- 本地提交示例：
  ```bash
  cd D:\MY-WEB
  git checkout develop && git checkout -b feature/friends
  git add backend docs
  git commit -m "feat(friends): Phase 2.1 用户关系/好友系统"
  ```

---

**状态**：Phase 2.1 完成，严格停在 Phase 2.1，未进入 Conversation / Message / WebSocket。等待下一步指令。
