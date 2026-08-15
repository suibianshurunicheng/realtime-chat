# Phase 3.3 聊天实时体验增强（typing）复盘

> 目标：在单聊中实现 IM 常见的「正在输入」typing 状态。
> 前置：Phase 3.1（聊天 MVP / Socket 单例 / 实时消息 / presence）、Phase 3.2（最后一条消息预览 / 好友申请 UI）均已完成并验证。
> 日期：2026-08-13

---

## 1. 修改文件列表

### 后端（realtime gateway 最小扩展，无新依赖、无 DB 字段、无消息表）
- `backend/src/realtime/realtime.types.ts`（改）
  - 新增 3 个事件常量：`TYPING_START_EVENT` / `TYPING_STOP_EVENT` / `TYPING_CHANGED_EVENT`
- `backend/src/realtime/dto/typing.dto.ts`（新）
  - `TypingDto { @IsString() @Length(1,64) conversationId }`，校验与 `SendSocketMessageDto` 的 `conversationId` 一致
- `backend/src/realtime/realtime.gateway.ts`（改）
  - 新增 `onTypingStart` / `onTypingStop`（`@SubscribeMessage`，共用私有 `broadcastTyping`）
  - `handleDisconnect` 增加「断开即广播 typing:false」第三层清理 `broadcastTypingStopOnDisconnect`
- `backend/src/conversations/conversations.service.ts`（改）
  - `isMember` 由 `private` 改为 `public`（仅访问修饰符，逻辑零改动）

### 前端（不污染 chat.store，独立 ephemeral 状态，保持 Socket 单例结构）
- `frontend/src/store/typing.store.ts`（新）
  - `typingByConversation: Record<string, string|null>` + `setTyping` / `clearAll`
  - 模块级 `Map<convId, Timeout>` 实现 6s watchdog 自动清除
- `frontend/src/types/chat.ts`（改）
  - 新增 `TypingPayload { conversationId; userId; typing }`（对齐后端）
- `frontend/src/socket/socket.ts`（改）
  - `attach` 内追加 `typing_changed` 监听（写入 typing.store）
  - 新增 `emitTypingStart(conversationId)` / `emitTypingStop(conversationId)`
- `frontend/src/components/MessageInput.tsx`（改）
  - 新增 `conversationId` prop；输入节流发 start（首键立即 + ≤1 次/秒心跳）、2s 空闲发 stop；切会话/卸载/logout 清理 timer 并补发 stop
- `frontend/src/components/ChatWindow.tsx`（改）
  - 读取 `typingByConversation[id]`，仅当 `=== otherUser.id` 时显示「对方正在输入…」
- `frontend/src/components/ChatApp.tsx`（改）
  - 退出登录链路追加 `clearTyping()`（取消 watchdog timer + 置空）
- `frontend/src/index.css`（改）
  - 新增 `.chat-typing` 样式（带呼吸动画 + 尊重 `prefers-reduced-motion`）
- `frontend/src/store/typing.logic.spec.ts`（新）
  - 7 例单测：setTyping / null 清除 / 覆盖更新 / 会话独立 / clearAll / 6s watchdog / 心跳刷新 watchdog

### 测试（新增）
- `backend/test/typing.e2e-spec.ts`（新）
  - 5 例端到端：start→B 收到 true、stop→B 收到 false、非成员不泄露、断开广播 false、非法 payload 丢弃

---

## 2. 后端 Socket 事件流

### 事件定义
| 方向 | 事件 | payload |
|------|------|---------|
| C→S | `typing_start` | `{ conversationId: string }` |
| C→S | `typing_stop` | `{ conversationId: string }` |
| S→C | `typing_changed` | `{ conversationId: string, userId: string, typing: boolean }` |

### 处理链路（`realtime.gateway.ts`）
```
client emit typing_start/stop
  → @SubscribeMessage(TYPING_START_EVENT / TYPING_STOP_EVENT)
  → broadcastTyping(client, body, typing)
       1. user = client.data.user                // 服务端固定身份，绝不信任客户端
       2. plainToInstance(TypingDto, body) + validate
            └─ 校验失败 → 直接 return（静默丢弃，不发 error 包，避免打扰）
       3. conversations.isMember(cid, user.sub)   // 成员校验（public 化后可直接调用）
            └─ 非成员 → return（不广播）
       4. server.to(conversationRoom(cid))
              .except(client.id)                  // 原生 self-exclusion，发送者不收回声
              .emit(TYPING_CHANGED_EVENT, { conversationId, userId: user.sub, typing })
```

### 断开清理（第三层保护）
```
handleDisconnect(client)
  → broadcastTypingStopOnDisconnect(user.sub, client.id)
       1. listConversationIds(user.sub)            // 复用 connect 时的同一查询
       2. for each cid:
            server.to(conversationRoom(cid)).except(socketId)
                  .emit(TYPING_CHANGED_EVENT, { ..., typing: false })
       3. try/catch 包裹，失败只记日志，绝不阻断 disconnect 主流程
```

> typing 为**纯内存 ephemeral 状态，全程不落库**（无 migration、无 entity 改动、无 Redis 持久化），符合本期约束。

---

## 3. 前端状态流

### 发送端（MessageInput.tsx）
```
onChange(value):
  if value 为空          → stopTyping()（立即补发 typing_stop）
  else:
    重置 2s 空闲 timer    → 到点 stopTyping()
    if 尚未 typing       → emitTypingStart(cid); isTyping=true; lastStartAt=now   // 首键
    else if now-last≥1s   → emitTypingStart(cid); lastStartAt=now                  // 节流心跳
submit(): stopTyping(); onSend(text); setContent('')

useEffect([conversationId]):
  进入新会话 → 重置 isTyping/lastStartAt/空闲 timer
  cleanup（切会话 / 卸载 / logout 触发 ChatWindow 卸载）→ 若 isTyping 则 emitTypingStop(cid)
```

### 接收端（socket.ts → typing.store.ts → ChatWindow.tsx）
```
socket 'typing_changed' { conversationId, userId, typing }
  → typing.store.setTyping(cid, typing ? userId : null)
       ├─ 非 null：写入 typingByConversation[cid]=userId，并 (重) 启动 6s watchdog
       └─ null    ：清 typingByConversation[cid]=null，并取消该会话 watchdog

ChatWindow:
  typingUserId = typingByConversation[conversation.id]
  isOtherTyping = typingUserId != null && typingUserId === otherUser.id
  → 仅 isOtherTyping 时渲染「对方正在输入…」
```

### 三层防「卡死 typing」保护
1. **正常停止**：2s 空闲 / 清空输入 / 发送 → `typing_stop` → B 立即清除
2. **异常兜底**：接收端 6s watchdog，超时未收到新心跳 / stop 自动清除
3. **连接断开**：服务端 `handleDisconnect` 主动广播 `typing:false`（覆盖浏览器关闭 / 网络瞬断 / 多端其一掉线）

---

## 4. 测试结果

### 后端
| 项 | 命令 | 结果 |
|----|------|------|
| Lint | `npm run lint` | ✅ 0 |
| Build | `npm run build`（nest build） | ✅ 0 |
| 单元测试 | `npm run test:unit`（jest） | ✅ 9/9 |
| 端到端 | `DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e`（WSL MySQL8 + Redis6） | ✅ **71/71**（基线 66 + 新增 typing 5，零回归） |

新增 typing e2e（5 例全绿）：
- start → B 收到 true，A 不收回声
- stop → B 收到 false
- 非成员 C 的 emit 被忽略、不泄露到 B
- A 断开（无 stop）→ B 收到 false（第三层）
- 非法 payload（空 / 缺字段）→ 静默丢弃

### 前端
| 项 | 命令 | 结果 |
|----|------|------|
| Lint | `npm run lint`（eslint） | ✅ 0 |
| Build | `npm run build`（tsc -b && vite build） | ✅ 0 |
| 测试 | `npm run test`（vitest run） | ✅ **20/20**（chat 13 + typing 7，零回归） |

> 说明：后端无 `npm test` 脚本，仅有 `test:unit` / `test:e2e`；前端有 `test`（vitest）。
> 真实联调（浏览器 + 双账号）未在沙箱跑（无浏览器、MySQL/Redis 仅 WSL2）；但 typing 端到端已由后端 e2e 在真实 MySQL/Redis 上全覆盖。

---

## 5. 已知限制

1. **单实例约束**：typing 广播走进程内 Socket.IO room（与消息/presence 一致），多实例部署需引入 Redis adapter / Pub-Sub 才能跨实例，本期未做（架构预留）。
2. **typing 不跨端聚合**：与 presence 不同，typing 不做「多端合并」——同一用户多个设备各自发 typing 会各自广播；由于按 `userId` 去重展示，UI 不会重复，但服务端发了 N 条。可接受（IM 常规做法）。
3. **历史会话重连不恢复 typing**：刷新页面 / 重新连接不会补发「此刻谁在输入」（typing 本就是瞬时态），符合预期。
4. **6s watchdog 是接收端兜底**：若发送端以 >6s 节律输入且心跳因极端网络丢弃，理论上可能短暂清除后由下一心跳恢复——属边界抖动，不影响最终一致。
5. **仅单聊（direct）**：群聊 / 多对 typing 不在本期范围（本期 only 单聊）。
6. **未做 typing 持久化 / 已读回执 / 撤回 / 图片**：按本期范围刻意不做。

---

## 6. Phase 3.3 复盘

### 决策回顾
- **复用现有 Socket 架构**：单 gateway + conversation room + 服务端固定身份 + 前端单例 `attach`，typing 几乎零成本接入，未引入任何新依赖或 UI 框架。
- **ephemeral 不落库**：typing 明确为临时态，杜绝了「加字段 / 加表」的诱惑，保持数据模型稳定。
- **节流心跳（≤1 次/秒）**：采用方案 A（每次按键刷新），但用节流把事件量从「每键 1 条」压到「≤1 条/秒」，兼顾长输入稳定与事件成本。
- **三层停止保护**：正常 stop / 6s watchdog / disconnect 广播，覆盖所有「peer 卡在 typing」的失败路径。

### 踩坑 / 注意点
- `MessageInput` 切会话时 `isTyping`/`lastStartAt` 是 `useRef`，必须随 `conversationId` effect 重置，否则旧会话的 typing 态会污染新会话首键（已通过 effect cleanup 重置规避）。
- 前端 `ChatWindow` 中 `isOtherTyping` 依赖 `other`，须放在 `const other` **之后**声明（TS 块级作用域报错已修）。
- `emitTypingStart/Stop` 因一次工具调用被异常文本污染而漏写，已补回并通过编译/测试验证（提醒：写文件后必须 `build` 验证导出是否真正落地）。

### 交付确认
- ✅ 后端最小改动（realtime gateway + isMember public）
- ✅ 不新增 DB 字段 / 消息表 / conversation 业务逻辑
- ✅ typing 独立 ephemeral 状态，不污染 chat.store
- ✅ Socket 单例结构保持，未破坏已有事件（message/presence 等）
- ✅ Phase 3.1 / 3.2 全兼容（前端 20/20、后端 71/71 全绿）

### 下一步可选
- P2.4 增强：已读回执 / 消息撤回 / 图片文件（本期未做）
- 多实例部署的 Redis Pub/Sub 化（架构预留）
- 真实双账号浏览器联调（沙箱无浏览器，建议本地 WSL2 跑一遍）
