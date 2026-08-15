# Phase 3.2 聊天体验增强 复盘

> 阶段目标：在不破坏 Phase 3.1 架构稳定性的前提下，把聊天 MVP 提升到接近真实 IM 的体验。
> 范围：**P1 会话最后消息预览** + **P2 好友申请 UI**。明确不实现：typing / 已读 / 撤回 / 图片 / 文件 / 群聊。
> 后端：**0 修改**，无 Backend Blocker。

---

## 1. 已确认的源码事实（编码前读盘）

- **前端**：React18+TS+Vite、zustand v5、axios、`socket.io-client`、纯 CSS（蓝色 `#3b6cff`）、StrictMode 开。
- **chat.store**：`conversations / messagesByConv / unreadByConv / hasMoreByConv / loading*`；`appendMessage` 含 id 去重 + 非当前会话 unread++；`prependMessages` 旧消息合并去重；`clearAll` 重置。
- **Friends API（后端真实存在，未改）**：
  - `POST /friends/requests {addresseeId}` → 成功（409=已好友/已待处理，404=用户不存在，400=自己）
  - `GET /friends/requests` → `FriendRequestView[]`
  - `POST /friends/requests/:id/accept` / `:id/reject` → 成功
  - `GET /users/search?q=` ✅
- **FriendRequestView 真实结构**（`friends.service.ts`）：`{ id, requester: PublicUser, addresseeId, status, createdAt }`（`createdAt` 序列化后为字符串）。
- **getMessages(convId, 1)**：`before` 缺省时按 `id DESC` 取最新 1 条再反转 → 返回 `[最新消息]`，可直接做预览源。
- **ConversationView**：`{ id, type, createdAt, updatedAt, members: User[] }`，**无 lastMessage 字段** → 预览必须由前端补充。

---

## 2. P1 会话最后消息预览

### 2.1 设计
- 预览唯一数据源：`chat.store.lastMessageByConv: Record<string, Message | null>`。
- 三处写入：
  - `setMessages(convId, msgs)`：写入该页末条（=最新消息）。
  - `appendMessage(msg)`：收到新消息即更新预览（保留原 unread++ 与 id 去重逻辑）。
  - `setLastMessage(convId, msg)`：供初始批量拉取写入。
- `prependMessages`（加载旧消息）**不触碰** `lastMessageByConv`。
- `clearAll` 一并清空，确保 logout 彻底清理。
- 排序：新增纯函数 `selectSortedConversations(conversations, lastMessageByConv)`，按 `lastMessage.createdAt ?? updatedAt ?? createdAt` **降序**，**不修改原始 `conversations` 数组**。

### 2.2 批量拉取 hook
- 新增 `hooks/useConversationPreview.ts`：进入页面后 `Promise.allSettled(conversations.map(c => getMessages(c.id, 1)))`。
- 依赖用 `idsKey = conversations.map(c=>c.id).join(',')` 签名，**ids 集合不变不重抓**；`cancelled` ref 防卸载后写 store；单会话失败仅置 `null`，不污染整体；StrictMode 双调用安全。

### 2.3 列表渲染
- `ConversationList` 用 `useMemo(selectSortedConversations)` 渲染；每条显示：在线点 + 对方昵称 + 最后消息内容 + 时间 + unread 徽标。
- 时间格式化：今天显示 `HH:MM`，否则 `M/D`（无新日期库）。

---

## 3. P2 好友申请 UI

### 3.1 类型与 API
- `types/chat.ts` 新增 `FriendRequestStatus` + `FriendRequestView`（字段严格对齐后端）。
- `friends.api.ts` 新增 `sendFriendRequest / listReceivedRequests / acceptRequest / rejectRequest`（全部复用现有 `client`，未新增 axios 实例）。

### 3.2 申请列表组件
- 新增 `components/FriendRequests.tsx`：渲染收到的 pending 申请（请求人昵称 + 时间 + 接受/拒绝按钮），具备 **loading / empty / error** 三态。

### 3.3 搜索结果分流
- `FriendPicker` 按 `friends` 集合判定：
  - 已是好友 → 「发消息」→ `onPick`
  - 非好友 → 「添加好友」→ `onAddFriend`；发送成功或后端 409（已好友/已待处理）后按钮变「已发送」并禁用（本地 `sentIds` 记录）。
- 错误处理：409 视为已发送，其它错误则保持可重试（不静默丢失）。

### 3.4 ChatApp 编排
- 侧栏新增「申请」tab + `requests / loadingRequests / errorRequests` 状态。
- 挂载时并行拉取会话/好友/在线/pending 申请。
- accept → 刷新申请列表 + 好友列表（新好友即时出现在「好友」tab）；reject → 仅刷新申请列表。
- `useConversationPreview(conversations)` 挂在 ChatApp 顶部（单例、Stable）。

---

## 4. 数据流变化

| 维度 | 变化 |
|------|------|
| 预览 | `messagesByConv`（完整历史，不变） ⊕ `lastMessageByConv`（预览单源，三处写入） |
| 会话排序 | 原始 `conversations` 不被修改；列表用 `useMemo` 调纯函数降序 |
| 申请流 | `ChatApp` 持有 `requests` → 传 `FriendRequests`；accept/reject 后重新拉取申请 + 好友 |
| 加好友 | `FriendPicker` 用 `friends` 判定动作；`已发送` 用本地 `sentIds` |

---

## 5. 文件清单

| 动作 | 文件 | 关键改动 |
|------|------|----------|
| 改 | `src/store/chat.store.ts` | 新增 `lastMessageByConv`；`setMessages/appendMessage` 维护；新增 `setLastMessage`；新增纯函数 `selectSortedConversations`；`clearAll` 清理 |
| 改 | `src/types/chat.ts` | 新增 `FriendRequestStatus`、`FriendRequestView` |
| 改 | `src/api/friends.api.ts` | 新增 `sendFriendRequest/listReceivedRequests/acceptRequest/rejectRequest` |
| 新增 | `src/hooks/useConversationPreview.ts` | 批量预览拉取（allSettled + idsKey 去重 + cancelled） |
| 改 | `src/components/ConversationList.tsx` | 渲染预览（昵称/在线/最后消息/时间/unread）+ 降序 |
| 新增 | `src/components/FriendRequests.tsx` | 收到的 pending 申请 + 接受/拒绝 + 三态 |
| 改 | `src/components/FriendPicker.tsx` | 好友判定（发消息/添加好友/已发送） |
| 改 | `src/components/ChatApp.tsx` | 新增「申请」tab + requests 状态 + preview hook + accept/reject 处理 |
| 改 | `src/index.css` | 预览两行（conv-main/conv-line/conv-time/conv-preview）、申请操作（req-actions/req-btn）、已发送按钮样式 |
| 改 | `src/store/chat.logic.spec.ts` | +4 例预览 store 测试 |

**后端：0 修改。未引入 UI 框架。React+TS+Zustand+Socket 架构不变。**

---

## 6. 测试

- `chat.logic.spec.ts` 扩至 **13 例**，新增：
  1. `setLastMessage` 正确更新预览
  2. `appendMessage` 更新预览且保留 unread 逻辑
  3. `prependMessages` 不改变预览（仅 `setMessages`/`appendMessage` 会更新）→ 修正了最初把 setMessages 合法更新误判为 bug 的断言
  4. `clearAll` 清理 `lastMessageByConv`
- 验证：`npm run lint`(0) + `npm run build`(`tsc -b && vite build`, 0 error, dist 315KB/gz 104KB) + `npm test`(13/13) 全绿。

---

## 7. lint / build / test 结果

| 项 | 结果 |
|----|------|
| `npm run lint` | 0 problem ✅ |
| `npm run build` | 0 error ✅（145 modules，dist 生成） |
| `npm test` | 13/13 ✅ |
| 后端全量回归 | 未改动，66/66 保持 |
| 真实两浏览器联调 | 沙箱无 MySQL/Redis 与浏览器，**未执行**（同 3.1，需本地 WSL2 验收） |

---

## 8. 真实联调建议（本地 WSL2 验收脚本）

启动后端（WSL2）：`cd /d/MY-WEB/backend && DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run start:dev`
启动前端（Windows）：`cd /d/MY-WEB/frontend && npm run dev`
用两个浏览器分别登录 A / B：
1. A 在「好友」tab 搜索 B → 添加好友（B 收到申请）
2. B 切到「申请」tab → 接受 → A 出现在 B「好友」tab
3. A 点 B → 自动创建/获取会话 → 会话列表显示最后消息预览
4. A 发消息 → B 实时收到；会话列表预览 + 未读更新
5. 刷新 A access token 后（等 15m 或手动触发 refresh）→ Socket 仍用新 token 正常
6. 会话列表按最后消息时间降序排列

---

## 9. 已完成功能
- ✅ 会话列表：对方昵称 + 在线状态 + 最后一条消息 + 时间 + unread 数量
- ✅ 会话列表按最后消息时间降序
- ✅ 新消息实时更新对应会话预览（当前会话/非当前会话均正确）
- ✅ 好友申请：搜索用户、发送申请、查看收到的申请、接受、拒绝
- ✅ 申请列表 loading / empty / error 三态
- ✅ 搜索结果「已好友→发消息 / 非好友→添加好友（已发送禁用）」分流

## 10. 未完成功能（按本阶段范围排除）
- ❌ typing 输入状态（后端 gateway 无 typing 事件，**缺接口，按"禁止改 backend"推迟**）
- ❌ 已读回执 / 撤回 / 图片 / 文件 / 群聊（明确不在范围）

## 11. 是否修改 backend
- **否**。所有功能基于现有接口。后端 0 改动，无 Backend Blocker。

## 12. 是否引入新依赖
- 否。复用 Phase 3.1 已装的 `socket.io-client` 与 `vitest`。`package.json` 无新增依赖。

## 13. 已知问题 / 风险点
- **预览 = N 次请求**：进入聊天页为每个会话并行 `getMessages(conv.id,1)`。好友/会话规模大时会放大请求数，MVP 可接受；后续可在后端 `GET /conversations` 增加 `lastMessage` 字段一次性返回（需后端改动，本期不做）。
- **P3 typing 阻塞**：后端 `realtime.gateway.ts` 未实现 `typing_start/typing_stop/typing_changed`，纯前端 emit 会被忽略。若要落地 typing，需后端最小改动（gateway 加订阅，向 `conversation:${id}` 房间广播 `typing_changed{conversationId,userId,typing}`，排除发送者）。
- **真实联调未跑**：沙箱无 MySQL/Redis 与浏览器；验收脚本见第 8 节，需你在本机 WSL2 跑一遍闭环。

## 14. 下一阶段建议
- 若要做 typing：后端 gateway 加订阅+广播（最小改动），前端新增 `typing.store` + `MessageInput` 防抖 + `ChatWindow` 头部提示。
- 若要做「已读回执 / 撤回」：需后端新增消息状态字段与事件，属 P2.4 范围。
- 会话列表预览可优化为后端 `GET /conversations` 携带 `lastMessage`（减少 N 次请求）。

---

**严格停在 Phase 3.2**，未自动进入 P2.4(typing/已读/撤回)/P2.5(图片/文件)/P3 后续（除本阶段已交付的预览+申请 UI）。下一步待用户指令。
