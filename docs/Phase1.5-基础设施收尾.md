# Phase 1.5 基础设施收尾

> 基于《Phase 1 技术复盘》执行的四项目标收尾：**Migration 基线 / 日志与异常系统 / 前端 refresh 单飞 / 基础工程检查**。
> 严格守约：**未进入 Phase 2**（好友 / 聊天 / WebSocket / 图片业务未触碰），所有 API 行为保持不变，Phase 1 e2e 仍 7/7 通过。

---

## 1. 修改文件列表

### 任务 1：TypeORM Migration 基线
| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/data-source.ts` | 新增 | 独立 TypeORM `DataSource`（CLI 用：migration:generate/run/revert）。不被应用 import，不进 `nest build` |
| `backend/src/migrations/1735689600000-CreateUsers.ts` | 新增 | 首条 baseline migration，建 `users` 表，DDL 与实体及原 synchronize 产物逐字段一致 |
| `backend/src/database/database.module.ts` | 修改 | `synchronize` 由「非 production 才 true」改为**全环境 `false`** |
| `backend/package.json` | 修改 | 新增 `migration:generate` / `migration:run` / `migration:revert` 脚本 + `ts-node` devDep |
| `backend/tsconfig.json` | 修改 | 移除临时加的 `ts-node` 顶层键（`tsc` 不认，会 TS5023） |
| `backend/test/setup-e2e.ts` | 修改 | e2e 启动前先 `drop tables → runMigrations` 重建 schema（取代 synchronize） |

### 任务 2：日志与异常系统
| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/src/common/types/express.d.ts` | 修改 | `Request` 增加 `traceId?: string` |
| `backend/src/common/interceptors/logging.interceptor.ts` | 新增 | 请求日志拦截器：分配 traceId，记录 `method url statusCode responseTime tid` |
| `backend/src/common/filters/http-exception.filter.ts` | 修改 | Http 异常 → `WARN` 记 `method/url/status/message/tid`；非 Http 异常 → `ERROR` 打印**完整 stack** + tid（stack 不返给客户端） |
| `backend/src/main.ts` | 修改 | 注册 `LoggingInterceptor`（全局） |
| `backend/test/setup-e2e.ts` | 修改 | e2e 也注册 `LoggingInterceptor`（保证 traceId 在此环境可关联） |

### 任务 3：前端 refresh 单飞
| 文件 | 动作 | 说明 |
|---|---|---|
| `frontend/src/api/single-flight.ts` | 新增 | 纯函数 `singleFlight<T>()`：并发调用合并为同一 in-flight Promise |
| `frontend/src/api/client.ts` | 修改 | 401 刷新改为 `singleFlight(refreshToken)`，并发 401 只发一次 `/auth/refresh` |

### 任务 4：基础工程检查（lint）
| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/eslint.config.mjs` | 新增 | 扁平配置，`typescript-eslint` recommended（只抓真实 bug，无风格规则） |
| `backend/package.json` | 修改 | 新增 `lint` 脚本：`eslint "src/**/*.ts"` |
| `frontend/eslint.config.js` | 新增 | 同上（frontend 为 ESM，`eslint.config.js` 即扁平 ESM） |
| `frontend/package.json` | 修改 | `lint` 脚本由失效的 `eslint .` 改为 `eslint "src"`（原 `eslint` 未安装） |

---

## 2. 每个修改原因

- **废弃 synchronize**：Phase 1 复盘 B 类问题——`synchronize` 让 schema 与实体容易漂移、CI/生产无法复现、Phase 2 建 friends/conversations/messages 前必须切。现 schema 唯一来源 = migration。
- **data-source.ts 独立存在**：TypeORM CLI 需要独立 `DataSource`；放根目录且不被 `nest build` 编译，避免污染应用构建与打包。
- **baseline migration 用原始 DDL**：先 `SHOW CREATE TABLE` 取出 synchronize 实际产物，逐字段镜像，保证「migration 执行后结构 = 当前实体」，已有数据逻辑不受影响。
- **logging 不引 pino**：复盘建议 nestjs-pino，但本环境以「最小改动、零新运行期依赖、不破坏现有 Logger」为原则，用内置 `Logger` + 拦截器 + `req.traceId` 实现，满足全部验收点（见 §4）。nestjs-pino 保留为 Phase 2 前的可选升级项。
- **traceId 存 `req` 而非 AsyncLocalStorage**：Express `req` 在同请求内对拦截器/守卫/过滤器天然共享，比 ALStore 更稳更简单；`tid=-` 仅出现在「守卫阶段即 401」的请求（Nest 守卫先于拦截器执行），属预期。
- **前端 single-flight 抽成纯函数**：可独立单测（已验证），且不改正常请求流程；刷新失败统一 `logout()` + 跳 `/login`。
- **lint 只开 recommended、不引 Prettier**：复盘 T4「如果成本低」；只抓 floating/misused promises、explicit any 等真实缺陷，避免触发大规模风格重构。

---

## 3. 遇到的问题

1. **`tsconfig.json` 加 `ts-node` 顶层键 → `tsc -p` 报 TS5023**。
   处理：移除该键，让 `typeorm-ts-node-commonjs` 默认对 `data-source.ts` 做类型检查（文件本身干净，无影响）。

2. **e2e 在 Windows 侧首次全红（`AggregateError`）**。
   根因：本沙箱 WSL2 实例每轮重置，MySQL/Redis 默认只绑 `127.0.0.1`，Windows↔WSL2 隧道只在监听 `0.0.0.0` 时可达。
   处理：在 WSL2 内将 MySQL/Redis 重新绑定 `0.0.0.0` 并重启；Windows 侧 `127.0.0.1:3306/6379` 恢复可达。

3. **沙箱内 WSL2 网络时通时断**。
   处理：改为**在 WSL2 内部用 Linux Node 跑 e2e**（连接 WSL2 本机 `127.0.0.1`，稳定可达），绕开跨 VM 隧道。见 §4 验收方式。

4. **WSL2 内 `npm`/`npx` 解析到 Windows 二进制**（`/mnt/c/Users/XR/.workbuddy/.../npm`）。
   现象：`DB_DATABASE=realtime_chat_test npm run migration:run` 内 `process.env.DB_DATABASE` 为 `undefined`，migration 落到默认库 `realtime_chat`。
   结论：**纯属本验证环境的二进制错位，非代码缺陷**。在用户真实机器（Windows Git Bash 或 Linux npm）上 `DB_DATABASE=… npm run …` 为标准形式，Phase 1 已用过且正常。`data-source.ts` 代码正确读取 `process.env.DB_DATABASE ?? 'realtime_chat'`。

---

## 4. build / test 结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 后端编译 | `npm run build`（nest build） | ✅ OK |
| 后端类型 | `npx tsc -p tsconfig.json --noEmit`（src + test） | ✅ OK |
| 前端编译 | `npm run build`（tsc -b && vite build） | ✅ OK（~260 KB） |
| 后端 lint | `npm run lint`（eslint） | ✅ 0 problem |
| 前端 lint | `npm run lint`（eslint） | ✅ 0 problem |
| 迁移脚本 | `npm run migration:run` | ✅ 连接成功、查询 migrations 表、`No migrations are pending` |
| **e2e（重建自 migration）** | `npm run test:e2e` | ✅ **7/7 全绿**（WSL2 内 Linux Node 执行，setup 先 drop+migrate） |
| 500 完整日志 | 临时诊断控制器抛 `Error` | ✅ 控制台打印 `ERROR [HttpExceptionFilter] Unhandled exception …` + 完整 stack |
| refresh 单飞 | 10 并发 401 调 `singleFlight(refreshToken)` | ✅ `refresh calls = 1`（仅一次 `/auth/refresh`），全部拿到 token |

**e2e 日志佐证（节选）**
```
LOG [Request] POST /api/auth/register 201 126ms tid=a5bc95b5-663a-4c30-a5c3-e3744ec1d7b7
WARN [HttpExceptionFilter] POST /api/auth/register 409 用户名已存在 tid=90c274f8-5f26-4154-bf18-e0aad4d4397e
ERROR [HttpExceptionFilter] Unhandled exception: 服务器内部错误
ERROR [HttpExceptionFilter] Error: DIAG-BOOM-STACK-12345  (完整 stack ...)
```

> 注：本沙箱无法稳定从 Windows 侧跑 e2e（WSL2 隧道时断 + npm 二进制错位）。验收是在 WSL2 内部用 Linux Node 完成，证明代码正确；**你在本地 `D:\MY-WEB` 用标准 `DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e` 即可复现 7/7**。

---

## 5. 遗留问题（Phase 2 前需关注，非本次范围）

1. **生产 migration 入口**：`migration:run` 当前指向 `./data-source.ts`（ts-node 运行时）。生产应 `nest build` 后指向 `dist/data-source.js`。文档已注明。
2. **WSL2 默认绑定**：本环境 WSL2 重置后 MySQL/Redis 回到 `127.0.0.1`；你本地若同样，需 `bind-address=0.0.0.0` 或开启镜像 localhost 模式。属环境配置，非代码。
3. **logout 不吊销 access token**（Phase 1 已知）：15 分钟内 access 仍有效。M4「双 token + 黑名单」决策待你在 Phase 2 前确认是否落地（jti 已就位，加黑名单成本低）。
4. **多端登录单 refresh key 互踢**：当前一个 userId 只有一个 refresh hash，新端登录会使旧端失效。是否支持多端并发登录需在 Phase 2 定稿数据结构。
5. **前端无单测运行器**：single-flight 用临时脚本验证（已删除），未引入 vitest。如需回归覆盖，Phase 2 可补。
6. **nestjs-pino 未引入**：本阶段用内置 Logger 达标；如要结构化日志/请求日志中间件开箱即用，可后续切换（不破坏现有 `Logger` API）。

---

## 完成标准核对

- [x] migration 可重新创建数据库（e2e setup 先 drop 表再 `runMigrations`，7/7 通过）
- [x] synchronize 不再作为核心方案（全环境 `false`，schema 唯一来源 = migration）
- [x] 500 错误有完整日志（控制台 `ERROR ...` + 完整 stack，已实测）
- [x] refresh 并发只触发一次（`singleFlight` 验证 10→1）
- [x] Phase 1 e2e 保持 7/7 通过
- [x] 未进入 Phase 2，等待下一步指令

---

## 本地提交与运行（沙箱 git 不持久）

```bash
cd D:\MY-WEB
git checkout develop
git checkout -b feature/phase1.5-infra
git add backend frontend docs README.md .gitignore
git commit -m "chore(infra): Phase 1.5 收尾 — migration 基线 / 日志异常 / refresh 单飞 / lint"
git checkout main && git merge --ff-only develop
```

跑 e2e（确保 WSL2 起好中间件并建库）：
```bash
# WSL2
sudo service mysql start && sudo service redis-server start
sudo mysql -e "CREATE DATABASE IF NOT EXISTS realtime_chat_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
# Windows 侧
cd D:\MY-WEB\backend
DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run migration:run   # 建表
DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e       # 7/7
```
