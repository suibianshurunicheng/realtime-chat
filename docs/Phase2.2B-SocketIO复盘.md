# Phase 2.2B — Socket.IO 实时通信 复盘

> 阶段目标：在已验收的 Conversation / ConversationMember / Message 领域之上，增加 Socket.IO 实时消息闭环。
> 严格不进入：在线状态、typing、已读回执、撤回、图片/文件、音视频、群聊、Redis Pub/Sub、多实例、推送、前端完整聊天 UI。
> 验收依据：磁盘源码 + `nest build` 退出码 + `tsc --noEmit` 退出码 + `npm run lint` 退出码 + WSL2 内实跑 e2e 结果（51/51 全绿）。

---

## 1. Gateway 位置

新增独立实时层模块 `backend/src/realtime/`：

- `realtime.gateway.ts` — `RealtimeGateway`（`@WebSocketGateway`），连接鉴权中间件 + 房间自动加入 + `send_message` 处理 + `disconnect` 日志
- `realtime.module.ts` — 依赖 `ConversationsModule` / `UsersModule` / `RedisModule`，仅 `providers:[RealtimeGateway]`
- `realtime.types.ts` — `SocketUser` 接口、`conversationRoom(id)` 房间名、`MESSAGE_CREATED_EVENT` / `MESSAGE_ERROR_EVENT` 常量
- `dto/send-socket-message.dto.ts` — `SendSocketMessageDto`（class-validator）

`app.module.ts` 已注册 `RealtimeModule`；`ConversationsModule` 补 `exports:[ConversationsService]`（仅供复用，未改 REST 行为）。

Gateway 不持有任何数据库业务逻辑——所有业务规则下沉到 `ConversationsService`。

---

## 2. Socket connection 鉴权方式

连接阶段走 `server.use(...)` 中间件（在 `afterInit` 注册），执行与 REST `JwtAuthGuard` 完全一致的校验链：

1. **提取 token**：优先 `socket.handshake.auth.token`，回退 `socket.handshake.headers.authorization`（Bearer）
2. **JWT 签名校验**：`jwt.verify(token, { secret })`（`secret` 取自 `config.get('jwt.accessSecret')`）—— 不仅 decode，必须验签
3. **过期校验**：`jwt.verify` 自带 `exp` 校验，过期直接抛 `TOKEN_INVALID`
4. **黑名单校验**：`redis.isBlacklisted(payload.jti)`（logout 后写入的 `auth:access:blacklist:{jti}`）
5. **用户存在性**：`users.findById(payload.sub)` 必须存在

任一步失败 → `next(new Error(reason))` → 客户端收到 `connect_error`（reason 为 `UNAUTHORIZED` / `TOKEN_INVALID` / `TOKEN_BLACKLISTED` / `USER_NOT_FOUND`）。
复用现有 access token（`sub/username/sid/jti/exp`），**没有为 Socket.IO 单独发明 JWT**。

### 连接建立后 token 被 logout 的生命周期说明（重要）

本阶段**只在连接建立时校验一次** token 有效性。连接建立之后、该 access token 被 logout 拉黑的情况：
- 当前架构**没有 token 实时失效推送机制**（无 Redis adapter、无订阅通道），因此不会主动断掉已建立的连接。
- 这**不**影响安全边界：该连接此前能做的操作，依然受「成员校验 + senderId=me + 黑名单已在连接时通过」约束；而它**无法**用被拉黑的 token「重新建立」连接（新连接会被第 4 步拒绝）。
- 该行为**按用户指示刻意不做复杂机制**，明确列为**下一阶段设计项**（见第 14 节）。

---

## 3. socket 身份结构

鉴权通过后，把身份**唯一地**挂载到 `socket.data.user`（来源仅限已验证的 JWT，客户端后续发送的 `userId/senderId/username` 一律不信任）：

```ts
interface SocketUser {
  sub: string;
  username: string;
  jti: string;
  sid: string;
  exp?: number;
}
```

`senderId` 永远取 `socket.data.user.sub`，服务端写入，客户端不可覆盖。

---

## 4. room 规则

连接成功后（`handleConnection`）：

1. `conversations.listConversationIds(me)` 查当前用户所属 conversation
2. 仅对其**真实成员**的 conversation 执行 `client.join(conversationRoom(id))`，房间名 `conversation:{conversationId}`

约束：

- 只能加入自己是 member 的 conversation（来源是 `conversation_members` 表，不是客户端随意 join）
- 客户端**不能**直接 join 任意 conversation（无 `join_conversation` 暴露接口；房间加入完全由服务端基于成员关系决定）
- 不暴露不存在 / 无权限的 conversation

`send_message` 广播时 `server.to(conversationRoom(id)).emit(...)`，仅房间内成员收到。

---

## 5. Socket 事件协议

客户端 → 服务端：

| 事件 | payload | 说明 |
|------|---------|------|
| `send_message` | `{ conversationId: string, content: string }` | 发送文本消息；`senderId` 不允许客户端提供 |

服务端 → 房间：

| 事件 | payload | 说明 |
|------|---------|------|
| `message_created` | 见第 6 节 | 广播给 conversation 房间（含发送者本人） |
| `message_error` | `{ code, message }` | 仅发给发送者，连接级不崩 |

连接：`auth: { token: '<access>' }`（兼容 `Authorization: Bearer` 头）。

处理流程：

```
send_message
 → plainToInstance(SendSocketMessageDto) + class-validator 校验
 → conversations.sendMessage(me, conversationId, content)   // 复用 REST 同一方法
     · conversation 不存在 → 404
     · 非 member → 403
     · senderId 强制 = me
     · 落库 Message
 → server.to(room).emit('message_created', payload)
```

---

## 6. message_created payload

```json
{
  "id": "123",
  "conversationId": "42",
  "senderId": "7",
  "type": "text",
  "content": "hello",
  "createdAt": "2026-08-12T10:00:00.000Z"
}
```

与 REST `GET /api/conversations/:id/messages` 返回的 `Message` 字段一致（id / conversationId / senderId / type / content / createdAt），不返回数据库内部多余字段。发送者本人也通过房间收到**完全相同的** `message_created`（不走另一套 response）。

---

## 7. REST / Socket 共用的 service

核心复用点：`ConversationsService.sendMessage(me, conversationId, content)`。

- REST：`ConversationsController.send` → `sendMessage(me, id, dto.content)`
- Socket：`RealtimeGateway.onSendMessage` → `sendMessage(user.sub, dto.conversationId, dto.content)`

两者调用**同一个方法**，统一保证：conversation 存在（404）、member 校验（403）、sender 身份（=me）、content 落库。业务规则零复制，全部在 service 层。

房间加入复用 `ConversationsService.listConversationIds(me)`（轻量，只查 `conversation_members`，不复用 `listMine` 的额外 user 联表）。

---

## 8. 错误处理

Gateway 不允许未处理异常导致连接级崩溃。错误统一经 `message_error` 事件发给发送者，绝不向客户端暴露 DB exception / SQL / Redis 内容。

分类与映射：

| 场景 | code | message |
|------|------|---------|
| 未认证（无 socket 身份） | 401 | 未认证 |
| payload 非法（class-validator 失败） | 400 | 消息格式非法 |
| conversation 不存在（service 抛 NotFound） | 404 | 会话不存在 |
| 非 conversation member（service 抛 Forbidden） | 403 | 你不是该会话的成员 |
| content 空 / 超长（validator） | 400 | 消息格式非法 |
| 其他未预期异常 | 500 | 服务器内部错误（服务端日志保留 stack，客户端只收到固定文案） |

`toErrorEnvelope(err)` 从 `HttpException` 提取 `status` 与 `message`；非 `HttpException` 记 ERROR 日志（含 stack + 上下文）但返回 500 固定文案。

连接层错误（未认证 / token 无效 / 已拉黑 / 用户不存在）走 `connect_error`，不进入 `message_error`。

---

## 9. disconnect 日志

`handleConnection` 内注册 `client.on('disconnect', (reason) => ...)`，记录 `socketId` / `userId`（`socket.data.user.sub`）/ `reason`；并提供 `handleDisconnect` 兜底日志。仅基础连接生命周期日志，**不**实现在线状态表 / presence / typing。

---

## 10. CORS / transport 配置

- Gateway `path: '/ws'`，对齐现有 Vite 代理（`vite.config.ts` 中 `'/ws' → ws://localhost:3000, ws:true`）
- `cors.origin` 取自 `configuration.realtime.corsOrigins`（默认 `['http://localhost:5173']`，可用 `RTC_CORS_ORIGINS` 覆盖），**未使用 `origin: '*'`**
- `cors.credentials: true`
- 未改变现有 REST API 的 CORS 行为（`main.ts` 未配置 REST CORS，保持原样）
- transport 由 Socket.IO 默认（polling 降级到 websocket）；e2e 客户端显式 `transports:['websocket']`

---

## 11. 测试清单

新增 `test/realtime.e2e-spec.ts`（12 个 `it`，覆盖用户要求的 23 项要点）。全量 e2e 共 **4 套 / 51 例** 全绿。

连接鉴权：
1. 合法 access token 可建立连接
2. 无 token 不能连接
3. 非法 token 不能连接
4. 已拉黑（logout 后）token 不能连接

房间 / 权限：
5. 成员自动加入自己 conversation room；非成员 C 不能发送且**绝不会**收到（证明未进房间）；C 发往 A↔B 会话 → 403
6. 非成员不能使用他人 conversation → 403

消息闭环：
7-11. A 发送 → B 收到；A 本人也通过房间收到统一 `message_created`；`senderId === A.sub`
12-13. 伪造 `senderId` 不生效（仍为 A）；空 content → 400；超长（2001）content → 400
14. 不存在的 conversation → 404
15-17. B 回复 → A 收到，且 `senderId === B.sub`

持久化 / REST↔Socket 一致性：
18-20. Socket 发的消息落库，REST `GET .../messages` 能查到
21-23. REST 发的消息，socket 连接中的客户端经 REST 历史也能查到

回归（其余 3 套并行运行，0 回归）：auth 9 / friends 16 / conversations 17。

---

## 12. build / tsc / lint / e2e 结果

WSL2 内（node 18 + 直连 127.0.0.1 的 MySQL `realtime_chat_test` / Redis `db=1`）实跑：

- `npm run build`（nest build）→ **EXIT 0**，`dist/realtime/*` 已产出
- `npx tsc --noEmit` → **0 error**
- `npm run lint` → **0 problem**
- `npm run test:e2e` → **Test Suites: 4 passed, Tests: 51 passed**

> 注：本 Agent 沙箱内 `nest build` 默认 `deleteOutDir:true` 会因「一次删除 >50 文件」触发沙箱批量删除保护而中断；验证时临时改用 `deleteOutDir:false` 完成编译，已确认产物正确后**还原为 `true`**（你的本地 WSL2 无此保护，原配置不受影响）。

---

## 13. 已知限制

- **单实例 Socket.IO**：本阶段按单实例设计，广播走进程内 adapter。
- **连接后 token 失效不实时推送**：连接建立时校验一次；已建立连接不会因后续 logout 被主动踢掉（安全边界仍由成员校验 + senderId 服务端写入保证）。列为下一阶段项。
- 未实现：在线状态 / presence、typing、已读回执、消息撤回、图片/文件/音视频、群聊、Redis adapter / PubSub / 多实例 / sticky session / cluster、推送通知、前端完整聊天 UI。
- 无新增 migration：Socket.IO 完全复用 `conversations` / `conversation_members` / `messages` 三表，未建 `socket_sessions` / `online` 等表。

---

## 14. 下一阶段建议

1. **连接后 token 实时失效**：引入 Redis Pub/Sub（或后续 Socket.IO Redis adapter 的 `__adapter__` 通道）广播 `access:revoked:{jti}`，Gateway 订阅后主动 `client.disconnect()` 命中房间/用户。需先确定是否上 Redis adapter（见第 2 点）。
2. **多实例水平扩展**：引入 `@nestjs/platform-socket.io` 的 Redis adapter（`@socket.io/redis-adapter` + ioredis），替换进程内广播；届时房间广播自动跨节点。注意 `conversationId → 多节点` 路由一致性。
3. **在线状态 / presence**：新建 `user_presence` 表或 Redis 结构，连接/断开维护 online 集合，增 `presence` 事件。
4. **typing / 已读回执 / 撤回**：纯领域扩展，沿用本阶段 `message_error` / 房间广播模式，新增对应事件与（如需）消息状态表字段。
5. **多媒体消息**：`Message.type` 已预留（当前仅 `text`），扩展需新增附件元数据表 + 对象存储（Phase 0 已定本地磁盘抽象）。
6. **前端聊天 UI**：`frontend` 已装 `socket.io-client` 待用时，按本阶段协议（`path:'/ws'`、`auth.token`、监听 `message_created`、发送 `send_message`）接入，复用现有 Zustand 登录态。
