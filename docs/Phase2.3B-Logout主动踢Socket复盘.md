# Phase 2.3B 复盘 — Logout 主动踢掉已建立的 Socket

> 阶段目标：在现有 `logout` 流程（已将 access token 的 `jti` 写入 Redis 黑名单）之上，额外**主动断开所有用该 `jti` 建立的已连接 Socket**，并保持 Presence 状态正确联动。
> 范围外（按指令禁止）：typing / 已读 / 撤回 / 图片 / 文件 / 音视频 / 群聊 / Redis Pub/Sub / Redis adapter / 多实例 / sticky session / 推送 / 前端完整 UI。

---

## 1. Registry 设计

新增独立服务 `TokenSocketRegistry`（`src/realtime/token-socket.registry.ts`），**进程内、纯内存、不落库、不用 Redis**（当前单实例 Socket.IO）：

- `jti → Set<socketId>` 正向索引
- `socketId → jti` 反向索引（disconnect 时按 socketId 清理用）
- 方法：`register(jti, socketId)` / `unregister(jti, socketId)` / `getSocketIds(jti)` / `clear(socketId)` / `revoke(jti)` / `setRevoker(fn)`
- 幂等：`register` 重复无重复项；`unregister` / `clear` 对未知或已删除项永不抛错
- `revoke(jti)`：取得 socketIds 后调用注入的 `revoker` 闭包（真正 disconnect），返回被要求断开的数量；内部 try/catch，revoker 抛错只记日志不向上传播
- **职责分离**：Registry 只管 `jti → socketId`；Presence 只管 `userId → Set<socketId>`（见 `PresenceService`）。两者不互相替代。

独立 `TokenSocketRegistryModule`（`src/realtime/token-socket-registry.module.ts`）导入并导出该服务，供 `AuthModule`（登出时 revoke）与 `RealtimeModule`（connect/disconnect 时登记/清理）作为**单例**共享。

---

## 2. jti → socket 映射

- 连接鉴权成功后（`socket.data.user` 已建立，`jti` 来自 JWT），`RealtimeGateway.handleConnection` 调 `registry.register(user.jti, client.id)`。
- 断线 / 被踢时，`RealtimeGateway.handleDisconnect` 调 `registry.unregister(user.jti, client.id)`（独立 try，不与 Presence 清理互相阻塞）。

---

## 3. logout 流程（关键修改）

`AuthService.logout` 现在顺序如下（**先黑名单、后断开**，避免重连窗口）：

```
1. redis.deleteRefresh(userId, sid)            // 原逻辑
2. redis.addToBlacklist(jti, ttlSeconds)        // 原逻辑（安全事实 = 真相源）
3. registry.revoke(jti)                         // 新增：触发 gateway 闭包断开该 jti 全部 socket
```

- `revoke` 外层再包一层 try/catch：即使 socket 清理抛错，也**绝不回滚黑名单、绝不导致 401 之外的返回**。
- `revoke` 通过 gateway 在 `afterInit` 注册的 `revoker` 闭包执行真实断开——**只有 gateway 持有 Socket.IO `Server`**，因此断开逻辑留在 gateway，registry 保持纯索引。
- 多端语义：仅踢 `jti` 对应的 socket；同用户其他 `sid`/`jti` 的 socket（如手机 BBB）完全不受影响。

---

## 4. blacklist / disconnect 顺序

严格遵守「先 `addToBlacklist` 再 `revoke`」。原因：若先断开再黑名单，存在短暂窗口允许该 `jti` 重新连接成功；而先黑名单后断开，任何新连接（即便发生在 disconnect 之前一瞬）都会被 `authenticate` 中间件用黑名单拒绝。**安全边界由黑名单保证，主动断开只是体验优化。**

---

## 5. 多端语义

```
user A
├─ sid=AAA (PC)     jti=AAA
└─ sid=BBB (手机)   jti=BBB
```

- `logout AAA` → `blacklist(AAA)` + `disconnect` AAA 所有 socket；BBB 继续在线、可正常收发消息、可 refresh。
- 同一 `jti` 可在多个 socket 中使用（如 AAA 双开 PC 标签页）→ `Set<socketId>`，登出后**全部**断开。
- 已在 e2e 中显式验证（见 §11）。

---

## 6. Presence 联动

主动 disconnect 走与「网络自然断开」**完全相同**的 cleanup 路径（`handleDisconnect`）：

- `registry.unregister` + `presence.disconnect` 各自独立 try，互不影响。
- 多端聚合不变：A 有 socket1、socket2（不同 jti）→ `logout` 其中一个 token 的 socket → 仍有另一 socket → **不广播 offline**；`logout` 最后一个 → `1→0` → **广播 `presence_changed {userId:A, online:false}`**。

---

## 7. cleanup 机制

- connect：`registry.register(jti, socketId)`
- 任意 disconnect（网络 / 被踢）：`handleDisconnect` → `registry.unregister(jti, socketId)`（幂等，重复调用不产生负数或错误 offline）
- 主动踢：`server.sockets.sockets.get(id)?.disconnect(true)` → 触发 `handleDisconnect` → 统一 cleanup。两条路径合流，无重复逻辑。

---

## 8. Socket disconnect reason

- 主动登出断开：`server.sockets.sockets.get(id).disconnect(true)` → 客户端收到 `disconnect`，reason 为 `io server disconnect`。
- 服务端日志记 `reason=logout`（含 userId / sid / jti / socketId），**绝不打印 access token 原文**。
- 不依赖客户端 reason 判定安全状态——安全事实是「该 `jti` 已在黑名单」。

---

## 9. 日志

`AuthService.logout` 在 `revoke` 命中 socket 时记：
`logout revoked N socket(s) userId=.. sid=.. jti=..`
gateway revoker 记：
`revoke socket on logout socketId=.. userId=.. sid=.. jti=.. reason=logout`
registry 内部 revoker 异常记 `revoke failed for jti=..`（含 stack，不含 token）。

---

## 10. unit test

`test/token-socket.registry.spec.ts`（新增 `jest.config.js` + `test:unit` 脚本，纯内存、无需 DB/Redis）：

- register / 重复 register 幂等
- unregister / 重复 unregister 不抛
- clear 按 socketId 清理
- 同 jti 多 socket
- 不同 jti 互不影响
- 无 revoker / 无 socket 时 revoke 安全
- revoker 抛错时 revoke 仍返回计数且不向上抛

**结果：9/9 通过。**

---

## 11. e2e

`test/logout-socket.e2e-spec.ts`（WSL2 内 `DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e`）覆盖：

1. 单 socket 被登出踢断 + 之后用该 token 重连被拒（黑名单）
2. 多端：登出 PC(AAA) → 手机(BBB) 仍在线且可发消息（senderId=A）
3. 同 jti 双 socket → 登出后二者均断
4. presence：登出唯一 socket → 好友收到 offline
5. presence：双设备（不同 jti）→ 断一不 offline，断最后一 offline
6. registry 清理：先网络断开再登出不报错，新 token 仍可连

**完整 e2e 结果（WSL2 实跑）：`Test Suites: 6 passed, 6 total` / `Tests: 66 passed, 66 total`**
（auth 9 + friends 13 + conversations 17 + realtime 12 + presence 9 + logout 6 = 66，全绿，含 Phase 1/2.1/2.2A/2.2B/2.3A 全部回归。）

---

## 12. build / tsc / lint / unit

在 Windows 托管 node 实跑（`nest build` 受沙箱批量删除保护，临时 `deleteOutDir:false` 验证后已还原 `true`，与真实 WSL2 环境一致）：

- `nest build` **EXIT 0** ✅
- `tsc --noEmit` **0 error** ✅
- `eslint "src/**/*.ts"` **0 problem** ✅
- `npm run test:unit` **9/9** ✅
- 完整 `test:e2e`（WSL2）**66/66** ✅

---

## 13. 已知限制

- **当前单实例**：Registry / Presence 均为进程内 `Map`；`revoke` 只能断开本进程 socket。
- **不使用 Redis**：无 Redis Pub/Sub、无 Redis adapter、无分布式锁。
- **不支持多实例 revoke**：多实例下，某节点的黑名单写入后，其他节点的 socket 无法被本节点 revoke（需后续阶段引入 Redis registry + adapter + 跨节点 revoke 广播）。
- **不实现 logout 主动踢 Socket 的实时推送**：仅被动在 connect 时校验黑名单拒绝重连 + 登出时断开已存在 socket；无「强制其他节点失效」机制（属下一阶段）。
- 运行期发现并修复的健壮性缺口：`handleConnection` 原对 `listConversationIds` / `listFriendIds` / `broadcastPresence` 等 DB 查询无 try/catch，MySQL 瞬时抖动会抛**未处理 rejection 导致整个网关进程崩溃**（影响所有在途连接/测试）。已加 try/catch：失败则回滚 registry 绑定并关闭该 socket，进程不再崩溃。属防御性修复，未改 REST/业务/事件协议。

---

## 14. 下一阶段建议

- **多实例 Socket revoke**：引入 Redis 版 registry（`auth:sockets:{jti}` set）+ Socket.IO Redis adapter；logout 时跨节点广播 revoke。
- **logout 实时失效推送**：在 `revoke` 之外，对仍在线但 token 已失效的连接做主动探测（结合黑名单 subscribe）。
- 之后可进入：Phase 2.4 typing / 已读 / 撤回；Phase 2.5 图片 / 文件；Phase 3 前端聊天 UI。

---

## 修改文件清单

- 新增 `src/realtime/token-socket.registry.ts`
- 新增 `src/realtime/token-socket-registry.module.ts`
- 新增 `test/token-socket.registry.spec.ts`（unit）
- 新增 `test/logout-socket.e2e-spec.ts`
- 新增 `jest.config.js`、`package.json` 增加 `test:unit` 脚本
- 修改 `src/realtime/realtime.gateway.ts`（注入 registry；`afterInit` 注册 revoker；`handleConnection` 登记 + try/catch 健壮性；`handleDisconnect` 独立清理 unregister）
- 修改 `src/realtime/realtime.module.ts`（导入 `TokenSocketRegistryModule`）
- 修改 `src/auth/auth.service.ts`（`logout` 在 blacklist 后 `revoke`；注入 registry；记日志）
- 修改 `src/auth/auth.module.ts`（导入 `TokenSocketRegistryModule`）
- **未改**：REST 路由 / response shape / refresh 删除逻辑 / access blacklist 逻辑 / 实体 / 唯一约束 / migration / senderId 服务端写入 / conversation room 规则。无新增 migration。
