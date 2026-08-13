# 开发环境说明（DEVELOPMENT）

> 当前**不使用 Docker**。本地中间件（MySQL 8 / Redis 6）运行在 **WSL2 + Ubuntu** 中（已与用户确认），前端/后端仍在 Windows 侧运行并通过 `localhost` 访问。

## 1. 前置条件

- **Windows 侧**：Node.js 22.x、npm 10.x（已具备）
- **WSL2**：Windows 已开启 WSL2，并安装 Ubuntu 发行版
  - 若未安装：`wsl --install -d Ubuntu`
  - 进入：`wsl -d Ubuntu`（或直接在 Ubuntu 终端操作）

## 2. 在 WSL2 中准备 MySQL 8 与 Redis 6

打开 Ubuntu（WSL2）终端：

```bash
# 更新并安装
sudo apt update
sudo apt install -y mysql-server redis-server

# 启动服务（WSL2 不会自动起，需手动）
sudo service mysql start
sudo service redis-server start

# 验证
mysqladmin -uroot status
redis-cli ping      # 期望输出 PONG
```

### MySQL 初始化（开发用）

```bash
sudo mysql
```

```sql
CREATE DATABASE realtime_chat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'chat'@'%' IDENTIFIED BY 'changeme';
GRANT ALL PRIVILEGES ON realtime_chat.* TO 'chat'@'%';
FLUSH PRIVILEGES;
```

> 注意：WSL2 的 `localhost` 与 Windows 的 `localhost` 互通，因此后端配置 `DB_HOST=localhost` 即可。
> 若 Redis 设了密码，在 `redis.conf` 配置 `requirepass` 并同步 `.env` 的 `REDIS_PASSWORD`。

## 3. 前端（frontend/）

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

- Vite 已将 `/api` 代理到 `http://localhost:3000`，`/ws` 代理到 `ws://localhost:3000`。
- 无需在代码里硬编码后端地址。

## 4. 后端（backend/）

```bash
cd backend
npm install
cp .env.example .env      # 然后按需修改 secrets / 密码
npm run start:dev         # http://localhost:3000
```

`.env` 关键项（来源 `.env.example`）：

| 变量 | 说明 | 本机值 |
|---|---|---|
| `PORT` | 后端端口 | `3000` |
| `DB_HOST` / `DB_PORT` | MySQL | `localhost` / `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_DATABASE` | 库账号 | `chat` / `changeme` / `realtime_chat` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis | `localhost` / `6379` / `0` |
| `JWT_ACCESS_SECRET` | access token 签名密钥 | 自行生成强随机串（`openssl rand -base64 48`） |
| `JWT_ACCESS_EXPIRES_IN` | access token 有效期 | `15m` |
| `JWT_REFRESH_EXPIRES_IN_DAYS` | 刷新令牌有效期（Redis TTL） | `7` |
| `REFRESH_COOKIE_NAME` / `REFRESH_COOKIE_SECURE` | 刷新令牌 Cookie 名 / 是否仅 HTTPS | `rtc_refresh` / `false`（开发） |

> **设计要点（决策 D3）**：刷新令牌是**不透明随机串**，仅将其 SHA-256 哈希存入 Redis（`auth:refresh:{userId}`，TTL = 刷新有效期）；原文通过 **httpOnly** Cookie 下发，**不存在** `JWT_REFRESH_SECRET`。数据库密码使用 bcrypt，密钥仅用于 access token。

> 生成密钥示例：`openssl rand -base64 48`（Windows 可用 Git Bash）。

## 5. 分支与协作流程

- `main`：受保护分支，仅合入已评审的 `develop`，禁止直接推送。
- `develop`：集成分支，功能完成后 PR 合入。
- `feature/*`：每个模块/任务一条，从 `develop` 切出，命名如 `feature/auth`、`feature/chat`；完成后 PR 回 `develop`。
- 暂不设 `release/` / `hotfix/`，待上线前再引入。

首次提交已建立 `main` 与 `develop` 分支。新功能请基于最新 `develop` 开 `feature/*`。

## 6. 常用命令速查

```bash
# 后端类型检查 / 构建
cd backend && npm run build

# 后端端到端测试（Phase 1 认证）
cd backend && npm run test:e2e

# 前端构建
cd frontend && npm run build

# （可选）WSL2 停止服务
sudo service mysql stop
sudo service redis-server stop
```

## 7. Phase 1 端到端测试（e2e）

`backend/test/auth.e2e-spec.ts` 覆盖 7 个场景：注册成功、重复注册 409、登录成功、密码错误 401、Cookie 刷新 token、登出使刷新失效、未授权访问 `/users/me`。

前置：WSL2 中 MySQL 与 Redis 已启动，并存在专用测试库（与开发库隔离）：

```bash
# WSL2 中建测试库
sudo mysql -e "CREATE DATABASE realtime_chat_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 在 Windows 侧 backend/ 运行（指定测试库与 Redis DB，避免污染开发数据）
cd backend
DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e
```

> e2e 走真实 MySQL（synchronize 自动建表）+ 真实 Redis；测试库通过 `DB_DATABASE` 覆盖，Redis 通过 `REDIS_DB` 隔离。CI/本机均依赖 WSL2 中间件。
