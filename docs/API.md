# API 文档（API）

> 完整的系统级契约（错误码、WebSocket 事件 payload）以 [系统设计.md](系统设计.md) 为权威来源。
> 本文件按模块维护**已实现**接口的具体请求/响应样例。
>
> **状态**：Phase 1（认证模块）**已实现并落盘**（2026-08-11）。好友 / 单聊 / WebSocket 为后续 Phase，尚未实现。

## 统一响应包装

所有成功响应被 `ResponseInterceptor` 包裹为：

```json
{ "code": 0, "message": "success", "data": <业务载荷> }
```

所有异常被 `HttpExceptionFilter` 归一为：

```json
{ "code": <HTTP 状态码>, "message": "<错误信息>", "data": null }
```

`code` 字段直接采用 HTTP 状态码（如 `401`、`409`）。前端以 `code` 判定成败。

## Phase 1：认证模块（已实现）

Base URL：`/api`，全局前缀。

### 1. 注册 — `POST /api/auth/register`

请求：

```json
{ "username": "alice", "password": "secret123", "nickname": "Alice" }
```

- `username`：1–64 字符，唯一
- `password`：≥ 6 字符
- `nickname`：1–64 字符

响应 `201`：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "<JWT>",
    "user": { "id": "1", "username": "alice", "nickname": "Alice", "avatar": null, "status": "active", "createdAt": "..." }
  }
}
```

- 同时下发 **httpOnly** 刷新令牌 Cookie：`rtc_refresh=<不透明随机串>; HttpOnly; SameSite=Lax; Path=/; Max-Age=7d`。
- 注册即登录，直接返回双 token。

### 2. 登录 — `POST /api/auth/login`

请求：`{ "username": "alice", "password": "secret123" }`

响应 `201`：同注册（`accessToken` + `user` + `rtc_refresh` Cookie）。
错误（密码错误 / 用户不存在）：`401`，`code: 401`，`message: "用户名或密码错误"`。

### 3. 刷新 — `POST /api/auth/refresh`

- 需要 **httpOnly Cookie** `rtc_refresh` 随请求发送（`withCredentials`）。
- 需在 `Authorization: Bearer <accessToken>` 中携带（即便已过期，仅用于解出 `sub` 定位用户）。
- 服务端用 Redis 中 `auth:refresh:{userId}` 的 SHA-256 哈希比对；一致则轮换并下发**新** `accessToken` + **新** `rtc_refresh` Cookie。
- 响应 `201`：`{ "accessToken": "<新JWT>", "user": { ... } }`。
- 缺失 Cookie / 哈希不符 / 用户被禁用：`401`，`code: 401`。

### 4. 登出 — `POST /api/auth/logout`

- 需要 `Authorization: Bearer <accessToken>`（JwtAuthGuard）。
- 删除 Redis 中 `auth:refresh:{userId}`，并清除 `rtc_refresh` Cookie。
- 响应 `201`：`{ "success": true }`。

### 5. 当前用户 — `GET /api/users/me`

- 需要 `Authorization: Bearer <accessToken>`。
- 响应 `200`：`{ "id": "...", "username": "...", "nickname": "...", "avatar": null, "status": "active", "createdAt": "..." }`。
- 未携带 / 失效令牌：`401`，`code: 401`。

### 错误码速查（Phase 1）

| HTTP | code | 场景 |
|---|---|---|
| 401 | 401 | 未登录 / token 失效 / refresh 不匹配 / 登出后刷新 |
| 409 | 409 | 用户名已存在 |
| 400 | 400 | 参数校验失败（class-validator） |

## TODO（Phase 2+）

- [ ] `PATCH /api/users/me`（资料/头像）
- [ ] 好友模块：`/api/friends`、`/api/friend-requests/*`
- [ ] 单聊：`/api/messages*` + WebSocket `message:send` / `message:new` 等
- [ ] 接入 `@nestjs/swagger` 自动生成 OpenAPI
