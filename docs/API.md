# API 文档（API）

> **本文件为占位文档。** 完整的请求/响应契约、错误码与 WebSocket 事件 payload 已在 [系统设计.md](系统设计.md) 中定义，是当前的权威来源。本文件用于后续按模块维护在线 API 文档（或接入 Swagger/OpenAPI）。

## REST 接口（概要，详见系统设计）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | POST | `/api/auth/register` | 注册 |
| 2 | POST | `/api/auth/login` | 登录（发双 token） |
| 3 | POST | `/api/auth/refresh` | 刷新 access token |
| 4 | POST | `/api/auth/logout` | 登出（token 入黑名单） |
| 5 | GET | `/api/users/me` | 当前用户 |
| 6 | PATCH | `/api/users/me` | 更新资料/头像 |
| 7 | GET | `/api/friends` | 好友列表 |
| 8 | POST | `/api/friend-requests` | 发送好友申请 |
| 9 | GET | `/api/friend-requests` | 收到的申请 |
| 10 | POST | `/api/friend-requests/{id}/accept` | 通过 |
| 11 | POST | `/api/friend-requests/{id}/reject` | 拒绝 |
| 12 | GET | `/api/messages?peerId=&cursor=` | 单聊历史（游标分页） |
| 13 | POST | `/api/messages` | 发消息（图片外） |
| 14 | POST | `/api/messages/image` | 发图片消息（上传） |
| 15 | POST | `/api/messages/read` | 标记已读 |

错误码表（4xx/5xx 与业务码）见系统设计文档。

## WebSocket 事件（概要）

- 客户端→服务端：`message:send`、`message:read`、`presence:ping`
- 服务端→客户端：`message:new`、`message:ack`、`message:read:update`、`presence:update`、`error`

完整事件 payload 与字段定义见系统设计文档。

## TODO（Phase 1 起）

- [ ] 接入 `@nestjs/swagger`，自动生成 OpenAPI
- [ ] 按模块补充示例请求/响应
- [ ] WebSocket 事件补充时序与重试语义
