# Phase 3.1 前端聊天 MVP 复盘

> 阶段目标：在已验收的后端（P1 ~ P2.3B，66/66 e2e 全绿）之上，交付一个**真正可用的前端聊天 MVP**。
> 用户完整链路：登录 → 好友/会话列表 → 选择好友 → 获取/创建会话 → 加载历史 → 实时收发 → 在线状态 → 断线重连 → logout。
> 严格范围：仅前端 MVP；不实现已读/typing/撤回/图片/文件/群聊/搜索/收藏等；**不修改后端业务代码**。

---

## 1. 当前前端架构（改造前基线）

- React 18 + TypeScript + Vite；`react-router-dom` v6（createBrowserRouter）；`zustand` v5（persist）；`axios`；纯 CSS（蓝色 `#3b6cff` 主题，无 UI 框架）。
- 文件：`pages/{Login,Register,Home}`（Home 为占位欢迎页）、`components/{Layout,ProtectedRoute}`、`store/auth.store`、`api/{client,auth.api,single-flight}`、`types/user.ts`、`vite.config.ts`（已配 `/api` 与 `/ws` 代理到 `localhost:3000`）。
- `auth.store` 已用 `persist`（key=`rtc-auth`）持有 `accessToken` + `user`，是唯一 token 真源；`client.ts` 拦截器自动附加 Bearer 并做 refresh single-flight。
- 此前 **未安装 `socket.io-client`，无测试框架，无聊天 UI**。

## 2. 新增页面

- `pages/Home.tsx`：由占位欢迎页改为渲染 `<ChatApp/>`（聊天主屏）。受 `ProtectedRoute` 包裹，路由结构不变（仍 `/login`、`/register`、`/`）。
- 聊天主屏即 `components/ChatApp.tsx`，含顶栏（当前用户 + 连接状态 + 退出）+ 两栏布局（左：会话/好友；右：聊天窗）。

## 3. 新增组件

| 组件 | 职责 |
|------|------|
| `ChatApp` | 聊天主容器：挂载 socket、拉取会话/好友/在线快照、左右栏与顶栏、logout 编排 |
| `ConversationList` | 会话列表：对方昵称、在线点、未读角标、选中高亮；空态「暂无会话」 |
| `FriendPicker` | 好友 tab：好友列表 + 用户搜索（`/users/search`）+「发消息」→ 创建/获取会话 |
| `ChatWindow` | 聊天窗：对方昵称+在线点、消息区（加载/空/错误态）、向上加载更早消息且保持滚动位置、输入框 |
| `MessageList` | 消息气泡：自己右 / 对方左，按 `senderId===currentUser.id` 判定；仅渲染 `type==='text'` |
| `MessageInput` | 输入框：内容为空时禁用发送 |
| `PresenceDot` | 在线/离线小圆点 |
| `ConnectionBadge` | 连接状态徽标：已连接 / 连接中 / 连接已断开 / 未连接 |

## 4. 新增 store

- `store/chat.store.ts`（会话 + 消息 + 未读 + 加载态）：
  - `conversations`、`activeConversationId`、`messagesByConv: Record<convId, Message[]>`（升序）、`unreadByConv`、`hasMoreByConv`、加载/错误标志。
  - 动作：`setConversations/setActive/setMessages/prependMessages/appendMessage/markHasMore/clearUnread/clearAll` 等。
  - `appendMessage` 关键逻辑：按 `id` **去重**（防自己发送后收到 `message_created` 回声重复）；非当前会话则 `unread++`；`setActive` 自动清该会话未读。
  - 辅助 `otherUser(conv, myId)`：从 `members` 中过滤出非我方用户。
- `store/presence.store.ts`（在线状态 + Socket 连接态）：
  - `presence: Record<userId, boolean>`、`connection: 'idle'|'connecting'|'connected'|'disconnected'`。
  - 动作：`applySnapshot`（初始化）、`setPresence`（单点更新）、`setConnection`、`clearAll`。
- **未重复创建 auth store**，token 始终取自 `auth.store`。

## 5. Socket 生命周期

- `socket/socket.ts`：**模块级单例**。`connectSocket(token)` 仅在无实例时创建 `io({ path:'/ws', auth:{token}, reconnection:true })`；`disconnectSocket()` 移除监听并断开、置空单例。
- 事件接线在 `attach(socket)` 中**创建时一次性绑定**，直接写回两个 store，组件只读取状态、从不自行绑定监听器：
  - `connect/disconnect/connect_error/reconnect_attempt/reconnect` → 更新 `connection`；
  - `message_created` → `chat.appendMessage`；`message_error{code,message}` → `chat.setError`；
  - `friend_presence_snapshot{users}` → `presence.applySnapshot`；`presence_changed{userId,online}` → `presence.setPresence`。
- `hooks/useChatSocket.ts`：在 `ChatApp` 挂载时调用。**单例 + `lastToken` ref 保证 connect 幂等**；`accessToken` 变化（refresh 换 token）→ 先 `disconnectSocket()` 再用新 token 重建；`accessToken` 为 `null`（logout）→ 断开。正常卸载不断开（session 级单例），规避 React StrictMode 双挂载导致重复建连/重复监听。

## 6. token refresh 与 Socket 的关系

- REST 刷新沿用既有 `singleFlight(refreshToken)`：`client.ts` 401 时静默刷新并 `setAccessToken`，拦截器自动给后续请求挂新 token。
- Socket 不缓存旧 token：`useChatSocket` 订阅 `auth.accessToken`，**一旦 token 变化即断开旧 socket、用最新 token 重建**（服务端每次握手重新验签+黑名单校验）。
- 若 refresh 失败：`client.ts` 已 `logout()` + 跳转 `/login`，auth store token 置空 → hook 断开 socket，前端无残留旧连接。

## 7. Conversation 状态

- 进入即 `GET /api/conversations`（REST，`data: ConversationView[]`），每项 `members` 含双方，前端用 `otherUser` 取对方并展示昵称/在线。
- 列表**无 lastMessage**（后端未返回，遵守「不修改后端」），按现有字段展示；空 → 「暂无会话」。
- 从好友 tab 选人 → `POST /api/conversations/direct {userId}`：200/201 返回 ConversationView（已存在则复用）；处理 403/404/401（非好友/用户不存在/过期走刷新）。新建会话即时并入左栏并切到「会话」tab。

## 8. Message 状态

- 打开会话 → `GET /api/conversations/:id/messages?limit=50`（升序，cursor `before=最旧消息 id`）。
- 初次加载最近 50 条；向上滚动到顶（`scrollTop<40`）且 `hasMore` 时加载更早一批并 `prependMessages`，**用 `useLayoutEffect` 记录滚动高度差保持视口位置**（不跳底部）。
- 发送：仅 `emit('send_message',{conversationId,content})`，**不乐观更新**；以服务端广播回的 `message_created` 为唯一真源（store 去重兜底防重复）。
- 消息 UI：自己右侧、对方左侧，展示 `content` + `createdAt`（用 `toLocaleString('zh-CN',…)` 本地化，未引入日期库）。

## 9. Presence 状态

- 连接成功时服务端推 `friend_presence_snapshot{users:[{userId,online}]}` 初始化；其后 `presence_changed` 单点更新。
- 额外以 `GET /api/friends/presence`（REST）作兜底初始化。
- 左栏会话/好友、聊天窗顶栏均用 `PresenceDot` 展示。第一版不做 last seen。

## 10. 错误处理

- REST：401 → 既有 refresh 流程；403 → 静默（好友/权限）；404 → 静默；其余 → 列表/加载失败提示。
- Socket `message_error{code,message}`：在聊天窗显示错误条（**不展示 stack/SQL/Redis/异常对象**）。

## 11. reconnect

- 依赖 socket.io-client 默认自动重连（`reconnection:true`）。`disconnect` → 显示「连接已断开」；`reconnect_attempt` → 「连接中…」；`reconnect`/`connect` → 「已连接」。
- **断开 ≠ logout**：不触发任何重新登录；仅后端 logout 主动 revoke 时服务端 `disconnect(true)`（reason 非自动重连类），前端亦在 logout 时显式 `disconnectSocket()`，绝不无限重连。

## 12. logout

- 点退出 → `logoutApi()`（忽略网络错误）→ `disconnectSocket()` → `chat.clearAll()` + `presence.clearAll()` → `auth.logout()` → 跳 `/login`。
- 区分三种断开：用户主动 logout / 网络临时断开（自动重连）/ 服务端 revoke（不重连）。

## 13. 测试

- 新增 `vitest`（轻量、Vite 原生，node 环境，无 DOM 依赖）。
- `src/store/chat.logic.spec.ts`（9 例）覆盖核心正确性：
  - `appendMessage` 按 id 去重（自收发回声不重复）；
  - 非当前会话到达消息 → 未读 +1；当前会话 → 未读不变；
  - `setActive` 清除该会话未读；
  - `prependMessages` 保持升序且去重；
  - `clearAll` 重置；`otherUser` 取对方；presence `applySnapshot`/`setPresence`。
- 集成类（两浏览器实时联调、token 刷新后 socket 换 token、listener 不重复注册等）因需真实后端（MySQL/Redis 在 WSL2）与浏览器，**沙箱内无法自动化**，见第 15 节由人工联调。

## 14. build / lint / test

- `npm run lint`：0 problem ✅（`eslint` 仅抓真实 bug，不含格式规则）
- `npm run build`：`tsc -b && vite build` 0 error ✅（产物 `dist/` 约 312KB / gzip 103KB）
- `npm test`：`vitest run` 9/9 ✅
- ⚠️ 本沙箱安装依赖受限：npm 写 `AppData` 缓存与项目 `package.json` 遭 OS EPERM，最终以「沙箱放行 + 本地缓存 + `--no-save` 安装后手工补 `package.json` 依赖」完成；删除被锁的 `tsconfig.tsbuildinfo` 后 `tsc -b` 方可写。用户本地正常 `npm install` 不受影响。

## 15. 真实联调结果

- **沙箱环境无法跑真实联调**：MySQL 8 / Redis 6 仅运行于 WSL2，浏览器/双端不可用。以下为**交付给用户的验收脚本**（在本地 WSL2 后端 + 两浏览器执行）：
  1. 后端 `npm run start:dev`；前端 `npm run dev`（vite 代理 `/api`、`/ws` → `:3000`）。
  2. 浏览器 A、B 分别注册并登录。
  3. A 在「好友」搜 B 并加好友（P2.1 后端已支持，前端 MVP 暂用搜索+发消息；若尚未是好友需先 `POST /friends/requests` 接受——本 MVP 未做申请 UI，联调前请确保已是好友）。
  4. A 选 B → 创建/获取会话 → 发 `hello`；B 实时收到 `message_created`。
  5. B 回 `hi`；A 实时收到。
  6. A 断开网络 → B 见 A 离线；恢复 → B 见 A 在线。
  7. A logout → A 的 socket 被后端 revoke 断开；B 不受影响、继续在线。
  8. A/B 在会话间切换 → socket 仅一个（不重复连接）；刷新 access token 后 socket 用新 token 重连。

## 16. 已知限制

- 未做：已读回执、typing、撤回、图片/文件、群聊、消息搜索、收藏、emoji、通知中心、多主题、复杂动画（均按范围排除）。
- 会话列表无「最后一条消息/时间」预览（后端未返回，未改后端）。
- 好友申请/接受 UI 未做（仅搜索+发消息；已是好友才能建会话，非好友会 403）。
- 实时联调在沙箱内未执行，需用户在本地按第 15 节验收。
- 单实例后端：`TokenSocketRegistry` 为进程内索引；多实例需后续换 Redis 版 + Socket.IO adapter（非本阶段）。

## 17. 下一阶段建议 / 改动声明

- **是否修改 backend**：否。后端 0 业务代码改动；前端严格复用既有 REST + Socket 协议。
- **是否引入新依赖**：是，且仅为前端 MVP 必需——`socket.io-client@^4.8.3`（运行时）、`vitest@^4.1.10`（开发/测试）。二者已写入 `package.json`。
- 建议下一步（待用户指令，本阶段已停）：P2.4 typing / 已读 / 撤回；P2.5 图片/文件；P3 后续前端增强（好友申请 UI、会话最后消息预览、未读聚合）。
- **P3.1 Backend Blocker**：无。前端未发现后端 API/Socket 阻塞项。
