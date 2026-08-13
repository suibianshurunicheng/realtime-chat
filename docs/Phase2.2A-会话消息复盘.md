# Phase 2.2A 会话 / 消息 数据模型与 REST 基线 — 复盘

> 阶段范围：**仅** Conversation / ConversationMember / Message 数据模型 + REST API + migration + e2e。
> 严格未实现：Socket.IO / WebSocket / 在线状态 / typing / 实时推送 / 图片·文件·音频·视频消息 / 群聊 / 已读回执 / 消息撤回 / 推送通知 / 前端聊天 UI。

---

## 1. 实际修改文件

新增（全部位于 `backend/`）：

| 文件 | 说明 |
|---|---|
| `src/conversations/entities/conversation.entity.ts` | `Conversation` 实体 |
| `src/conversations/entities/conversation-member.entity.ts` | `ConversationMember` 实体 |
| `src/conversations/entities/message.entity.ts` | `Message` 实体 |
| `src/conversations/dto/create-direct.dto.ts` | 创建直接会话 DTO |
| `src/conversations/dto/send-message.dto.ts` | 发送消息 DTO |
| `src/conversations/conversations.service.ts` | 会话 / 消息业务逻辑 |
| `src/conversations/conversations.controller.ts` | 5 个 REST 路由 |
| `src/conversations/conversations.module.ts` | 模块装配 |
| `src/migrations/1737500000000-CreateConversationTables.ts` | 新增 migration（不改动 baseline） |
| `test/conversations.e2e-spec.ts` | 17 个 e2e 场景 |

修改：

| 文件 | 说明 |
|---|---|
| `src/app.module.ts` | 注册 `ConversationsModule` |

未改动（认证与好友系统保持原样）：auth / users / friends / redis / common / 既有 migration / 前端。

---

## 2. Conversation 数据模型（`conversations`）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | bigint | PK AI | |
| `type` | varchar(16) | default `'direct'` | 预留 `'group'`（本阶段只用 direct） |
| `userLow` | bigint | nullable, `UNIQUE(userLow,userHigh)` | 直接会话两参与者的较小 id（LEAST） |
| `userHigh` | bigint | nullable, `UNIQUE(userLow,userHigh)` | 较大 id（GREATEST） |
| `created_at` / `updated_at` | datetime(6) | | |

`userLow`/`userHigh` 是**直接会话的去重锚点**：服务层始终以 `LEAST/GREATEST` 写入，
`UNIQUE(userLow,userHigh)` 保证 A↔B 与 B↔A 解析到**同一个**会话。group 阶段该列置 NULL，唯一约束自然失效。

---

## 3. ConversationMember 数据模型（`conversation_members`）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | bigint | PK AI | |
| `conversationId` | bigint | FK→`conversations(id)`, `UNIQUE(conv,user)` | |
| `userId` | bigint | FK→`users(id)`, KEY | |
| `created_at` | datetime(6) | | |

- `UNIQUE(conversationId, userId)`：同一用户在同一会话内不能重复成为成员（无孤儿 / 重复行）。
- `KEY(userId)`：支撑「我的会话列表」查询。
- 直接会话固定写入两条 member 行（A、B），与 `conversations.userLow/userHigh` 冗余但分工明确：
  member 表是**权限 / 列表查询面**，conversation 对列是**去重锚点**。

---

## 4. Message 数据模型（`messages`）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | bigint | PK AI | 自增，天然时序，用作分页游标 |
| `conversationId` | bigint | FK→`conversations(id)`, KEY | |
| `senderId` | bigint | FK→`users(id)` | **永远由服务端从 `req.user.sub` 写入** |
| `type` | varchar(16) | default `'text'` | 本阶段仅 `text`（其它类型预留不实现） |
| `content` | text | NOT NULL | |
| `created_at` | datetime(6) | `KEY(conversationId, created_at)` | 历史分页索引 |

---

## 5. Migration（`1737500000000-CreateConversationTables`）

- 排在 `CreateUsers`(1735689600000) 与 `CreateFriendTables`(1737000000000) 之后，按 name 时间戳排序执行。
- 含三张表的建表 + PK + FK（`conversations`/`users`）+ 唯一约束 + 索引，详见 §2–§4。
- **不改** baseline；`synchronize:false` 不变。
- 验证：`migration:run` 在干净库成功建 8 表（含 `users/friend_requests/friendships/conversations/conversation_members/messages/migrations/typeorm_metadata`）；二次运行 `No migrations are pending`。

---

## 6. API 清单（全局前缀 `api`，全部 `JwtAuthGuard`）

| 方法 | 路径 | 行为 | 关键校验 |
|---|---|---|---|
| POST | `/conversations/direct` | 创建或获取 1:1 会话 | 双方存在、非自己、已是好友；并发去重 |
| GET | `/conversations` | 我的会话列表（含成员公开信息） | 仅返回当前用户参与的 |
| GET | `/conversations/:id` | 会话详情（成员） | 404 不存在；非成员 403 |
| GET | `/conversations/:id/messages?limit&before` | 历史消息（游标分页） | 非成员 403；limit 上限 50 |
| POST | `/conversations/:id/messages` | 发送文本消息 | 404 不存在；非成员 403；`senderId` 强制=sub |

返回结构沿用全局 `{ code, message, data }`；异常 `HttpExceptionFilter` 归一（403/404/400/409 等）。

---

## 7. 权限规则

1. 当前用户身份**只**取自 `req.user.sub`，绝不信任客户端传入的 `userId` / `senderId`。
2. 创建直接会话：双方必须存在、不能是自己、必须已是好友（见 §12 决策）。
3. 会话详情 / 历史 / 发送：会话不存在 → 404；存在但调用者不是 member → 403。
4. 发送消息：`senderId` 由服务端写死为 `sub`，请求体里的 `senderId` 字段被 `whitelist` 丢弃（验证测试 14）。
5. 越权只读别人的申请 / 别人的会话 → 403（与好友系统一致）。

---

## 8. 分页方案（游标模型，对实时友好）

- 游标 `before` = 消息 id（自增，等价于时序）。
- 无 `before`：取**最新** `limit` 条，`ORDER BY id DESC LIMIT n` 后反转，按时间升序展示（最新在底部）。
- 有 `before`：取 `id < before` 的最新 `limit` 条，反转展示 —— 即「向上翻页加载更旧消息」。
- 默认 `limit=30`，上限 `MAX=50`（`parseInt` 校验 + `Math.min/max` 夹紧），超过上限按 50 返回。
- 索引 `(conversationId, created_at)` 支撑范围扫描；`conversationId` 因 FK 已被 InnoDB 自动索引。

---

## 9. 并发与唯一性处理

- 直接会话去重：`UNIQUE(userLow,userHigh)` 在 DB 层拦截并发创建。
- `createDirect` 在事务内 `save(Conversation)` + 两条 `member`，若撞 `ER_DUP_ENTRY`，
  捕获后回查已存在的会话并返回（**不产生 500**），与 Phase 2.1 好友申请去重同策略。
- e2e 测试 8：8 路并发创建 A↔B → 仅 1 个会话。
- `UNIQUE(conversationId, userId)` 防止重复加入。

---

## 10. e2e 清单（`test/conversations.e2e-spec.ts`，17 项全绿）

Conversation：
1. A 与好友 B 创建 1:1 会话（返回成员双方）
2. 重复创建返回同一会话
3. B 反向创建仍返回同一会话
4. 不能与自己创建（400）
5. 非好友不能创建（403）
6. 当前用户会话列表可见
7. 非成员不能查看会话详情（403）
8. 并发创建仅产生 1 个会话

Message：
9. A 发送文本消息（201，content/type/senderId 正确）
10. B 能看到该消息
11. A 能查看完整历史
12. 非成员不能读历史（403）
13. 非成员不能发消息（403）
14. `senderId` 不被客户端篡改（强制=sub）
15. 消息必须属于真实会话（不存在 → 404）
16. 游标分页稳定（初始=最新 2 条，before=更旧的 2 条，互不重叠）
17. 超限 limit 被夹紧到 50

Regression：auth 9/9、friends 16/16 无回归（与 conversations 17 同批运行共 39/39）。

---

## 11. build / tsc / lint / migration / e2e 结果

| 项 | 结果 |
|---|---|
| `nest build` | ✅ |
| `tsc --noEmit` | ✅ |
| 后端 `lint` | ✅ 0 problem |
| `migration:run`（干净库） | ✅ 建 8 表；二次 `No migrations pending` |
| e2e（WSL2 内 Linux node） | ✅ **39/39**（auth 9 + friends 16 + conversations 17） |

> 验证路径同前：本沙箱 WSL2 隧道不稳，e2e 在 WSL2 内用 Linux node 直连本地 `127.0.0.1` MySQL/Redis 完成（稳定路径）。
> 本地复现：`DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e`。

---

## 12. 遗留业务决策（明确记录，非本阶段实现）

- **「仅好友可发起会话」**：领域流 `Friendship → 允许建立会话` 暗示此约束，本阶段据此实现（测试 5 验证非好友 403）。若后续需求放宽为「非好友也可聊天」，需改 `createDirect` 去掉 `areFriends` 校验并补充「陌生人会话」权限规则——此为明确的下一阶段设计点，未擅自判断。
- **删除好友不级联删会话 / 消息**：保留历史数据（需求明确）。如需「删好友后禁止继续发消息」，记为后续业务决策（当前仍可发，因 member 行存在）。
- **群聊**：`conversation.type` 已预留 `'group'`，`userLow/userHigh` 对 group 置 NULL；群成员、群权限、群消息广播留待后续 Phase。
- **消息类型**：`type` 仅 `text`，image/file/audio/video/system 未实现（字段与约束已留扩展位）。
- **已读回执 / 撤回 / typing / 在线状态**：均未实现。

---

## 13. Socket.IO 阶段需要注意的接口（Phase 2.2B 设计预埋）

REST 基线已为实时通信预留清晰边界，接入 Socket.IO 时应复用而非破坏：

1. **鉴权**：`JwtAuthGuard` 的 access-token 校验 + Redis 黑名单逻辑可直接复用到 WebSocket 握手（用同样的 `verify` + `isBlacklisted`）。`req.user` 已含 `sub/jti/sid`。
2. **成员校验**：`ConversationsService.isMember(conversationId, userId)` 可直接用于「是否允许加入房间 / 是否允许收发该会话消息」。
3. **消息落库**：`sendMessage` 已是纯服务端写 `senderId`，Socket.IO 层只需在广播前调用同一方法即可复用持久化与权限。
4. **分页**：HTTP 历史接口与 WS 实时推送共用 `(conversationId, id/created_at)` 索引，游标 `before` 模型天然对接「进入会话先拉历史、再接实时增量」。
5. **会话发现**：`listMine` 返回用户所有会话，可用于「连接后自动 join 各会话房间」。
6. **一对一去重**：`UNIQUE(userLow,userHigh)` 保证实时阶段也不会因并发产生重复会话。
7. **不应改动**：REST 路由、返回结构、唯一约束、senderId 服务端写入、权限 403/404 规则——Socket.IO 阶段保持这些不变，仅在其上叠加实时通道。

---

## 14. 下一步建议

- 进入 **Phase 2.2B：Socket.IO 实时通道**，把上述 REST 接口桥接为实时收发（房间 = conversationId，鉴权复用 JwtAuthGuard 逻辑，落库复用 `sendMessage`）。
- 或先处理 §12 决策点（是否放开非好友聊天、删好友后禁言规则），再进实时阶段。
