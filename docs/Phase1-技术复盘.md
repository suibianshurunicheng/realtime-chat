# Phase 1 技术复盘（认证模块）

> 复盘时间：2026-08-12
> 范围：注册 / 登录 / 刷新 / 登出 / `GET /users/me`
> 验收结论：`nest build` ✅ · `tsc --noEmit`（含 test）✅ · `frontend build` ✅ · `npm run test:e2e` **7/7 绿**（真实 MySQL 8 + Redis 6）
> 本文档不含任何代码修改，仅为事实记录与后续决策依据。

---

## 1. 本阶段实际修复过的 Bug（共 10 个）

按暴露阶段排列。**注意：编译期 5 个靠 `tsc` 拦下，DI 期 3 个靠启动拦下，业务逻辑 2 个只有真实 e2e 才暴露**——这条递进关系本身就是本阶段最重要的结论。

### 1.1 编译 / 类型期（5 个）

| # | 现象 | 根因 | 修复 | 性质 |
|---|---|---|---|---|
| B1 | `login.dto.ts` 编译失败 | 用了 `@MaxLength` 但未从 `class-validator` 导入 | 补导入 | 编码疏漏 |
| B2 | `cookie-parser` "不可调用"（TS2349），`main.ts` + `test/setup-e2e.ts` 各一处 | CJS 包用 `import * as cookieParser` 得到命名空间对象，非函数 | 改为默认导入 `import cookieParser from 'cookie-parser'` | 工程配置 / 模块互操作 |
| B3 | `req.user` 类型不存在 | Express 的 `Request` 无 `user` 字段，guard 写入后无类型可依 | 新增 `src/common/types/express.d.ts` 做类型增强 | 类型体系缺失 |
| B4 | `auth.controller.ts` 编译失败 | `UnauthorizedException` 等未从 `@nestjs/common` 导入 | 补导入 | 编码疏漏 |
| B5 | e2e spec 类型失败 | `res.headers['set-cookie']` 在 supertest 类型下可能是 `string`，直接 `.join()` 不安全 | 归一为数组后再拼接 | 测试代码类型 |

### 1.2 依赖注入 / 启动期（3 个）

| # | 现象 | 根因 | 修复 | 性质 |
|---|---|---|---|---|
| B6 | `Nest can't resolve RedisService(?, ...)`，`ConfigService` 不可见 | `RedisModule` 只 `imports: [ConfigModule]`，未 `exports`，注入器解析链上拿不到 | `exports: [RedisService, ConfigModule]` | **架构** |
| B7 | `REDIS_CLIENT` token 在 DI 解析时为 `undefined` | `redis.module.ts` ↔ `redis.service.ts` 循环导入；装饰器求值时 token 常量还没赋值 | token 抽到独立 `redis.constants.ts` 打破环 | **架构** |
| B8 | `Nest can't resolve JwtAuthGuard (?, ConfigService)`，`JwtService` 在 `UsersModule` 上下文不可用 | `JwtModule` 只在 `AuthModule` 局部注册，而 `JwtAuthGuard` 被 `UsersController` 使用；`AuthModule` 已 import `UsersModule`，反向 import 会成环 | `JwtModule.registerAsync({ global: true, ... })`——单点注册、无环、guard 全局可用 | **架构** |

### 1.3 业务逻辑期（2 个，只有真实 e2e 能暴露）

| # | 现象 | 根因 | 修复 | 性质 |
|---|---|---|---|---|
| B9 | 注册通过，但 login / refresh / logout 全部 **500**（4 个用例连锁失败），且**服务端无任何错误日志** | `User.passwordHash` 标了 `select: false`，login 走的 `findOne` 拿不到哈希 → `bcrypt.compare(pw, undefined)` 抛异常 | 新增 `findByUsernameWithPassword()` 显式 `select` 哈希，保留实体上的 `select:false` 作为安全护栏 | **架构 / ORM 语义** |
| B10 | 刷新后重签的 access token 与上一枚**逐字节相同**，旋转断言 `not.toBe` 失败 | `jsonwebtoken` 的 `iat` 秒级取整，同一秒内相同 payload 必然产出相同签名 | access token 加 `jti: randomUUID()`，每次签发唯一（同时利于追溯与后续吊销） | 一半架构（token 不可追溯）+ 一半测试可靠性 |

> **B9 的定位成本远高于其它 9 个**，原因不是 bug 难，而是**全局异常过滤器把非 `HttpException` 的原始堆栈吞掉且不打日志**，只能靠逐行读源码反推。这直接推导出第 5 节的 P0 结论。

---

## 2. 属于架构问题的（4 个：B6 / B7 / B8 / B9，B10 部分）

这四个的共同模式是：**横切关注点（cross-cutting concern）的归属和可见性没有想清楚**，而不是某行代码写错。

1. **B8 — 横切能力放在了业务模块里。**
   `JwtAuthGuard` 是全局鉴权设施，但它依赖的 `JwtService` 被注册在业务模块 `AuthModule` 内。任何非 auth 模块要用 guard，就被迫 import `AuthModule`，而 `AuthModule` 又反向依赖业务模块 → 必然成环。
   *根本教训：guard / interceptor / filter 这类横切件，其依赖必须由全局或共享层提供，不能挂在任一业务模块下。*

2. **B6 — Nest 模块的 `imports` 不等于 `exports`。**
   模块内部能用 ≠ 消费方解析该模块的 provider 时能用。凡是 provider 的构造函数依赖来自外部模块，该外部模块通常要被 re-export。

3. **B7 — 模块文件同时承担"装配"和"契约"两个职责。**
   把 DI token（契约）和 `@Module` 装配写在同一文件，service 反向 import 该文件取 token，就制造了循环。**token / 接口 / 常量必须放在无依赖的叶子文件里**，这是 DI 项目的通用纪律。

4. **B9 — 实体级安全策略与查询路径耦合。**
   `select: false` 是对的（默认不泄露哈希），但它把"哪条查询路径需要哈希"变成了隐式知识。写 `findByUsername` 的人不会想到 login 拿不到密码。
   *更本质的说法：安全默认值必须配套一个显式的、命名清晰的逃逸出口，否则一定有人踩。*

5. **B10 的架构一半** — token 无唯一标识（`jti`），意味着无法追溯单枚 token、也无法做单 token 吊销。`jti` 是补上了，但**吊销机制仍未实现**（见 4.3）。

---

## 3. 属于环境问题的（5 个）

| # | 问题 | 影响 | 现状 |
|---|---|---|---|
| E1 | **沙箱 git 不持久**：`.git` 每次调用被重置，工作区回滚到 Phase 0 快照 `fd2ab87` | 直接导致第一次"Phase 1 已交付"的汇报**与磁盘事实不符**——这是本阶段最严重的一次流程事故 | 已确认机制，改为「源码���盘 + 编译验证」为准，git 提交由本地执行 |
| E2 | `node_modules` 残留 Phase 1 依赖，而 `package.json` 已回滚到 Phase 0 | 造成"依赖看起来装好了"的假象，掩盖了 E1 的回滚，延迟了问题发现 | 已通过重写 `package.json` + 重新 install 对齐 |
| E3 | 误判"沙箱没有 MySQL/Redis" | 第一轮把 e2e 失败归因为环境缺失，实际上是**服务没启动**而非未安装 | 已确认环境自带 WSL2 Ubuntu-24.04 且 MySQL/Redis 已装；`wsl -u root service mysql start` + `service redis-server start` 后从 Windows 侧 `127.0.0.1:3306/6379` 可达 |
| E4 | 测试库 / Redis DB 隔离靠手工传环境变量：`DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e` | 漏传就会污染开发库 `realtime_chat` 和 Redis db0 | 未固化（也计入债务，见 4.11） |
| E5 | 无 `.env` 时全部回落到 `configuration.ts` 硬编码默认值，含 `change-me-access-secret`、`root/root` | 本地零配置可跑（优点），但生产误用即高危；且无启动期必填校验 | 未处理 |

**E1 的流程结论：** 「已实现」的判定标准必须是**磁盘文件 + 编译/测试退出码**，不能是执行记录。本阶段两次验收失败（先是文件不存在，后是 DI 起不来）都源于跳过了终态校验。

---

## 4. 需要后续处理的代码债务

按优先级排序，⚠️ 标记的是 **Phase 2 一开工就会咬人的**。

### ⚠️ 高优先级（Phase 2 开工前处理）

1. **⚠️ 前端 refresh 无并发去重**（`frontend/src/api/client.ts`）
   多个请求同时 401 会**并发**打 `/api/auth/refresh`。服务端每次刷新都轮换 refresh token 并覆盖 Redis 里的 hash，于是后到的请求携带的是已被覆盖的旧 cookie → 校验失败 → 用户被误登出。
   Phase 2 引入 WebSocket + 列表页并行请求后，这个竞态几乎必然触发。**修法：单飞（single-flight）promise，首个 401 发起刷新，其余请求排队复用同一 promise。**

2. **⚠️ 无 migration，schema 靠 `synchronize`**（`database.module.ts:23`）
   当前 `synchronize: nodeEnv !== 'production'`。Phase 2 要新建 friends / conversations / messages 表并加索引，靠自动同步意味着**无版本、无回滚、无审计**，且字段改名会静默丢数据。必须在建新表之前切到 migration。

3. **⚠️ 异常过滤器吞掉原始堆栈且不打日志**（`common/filters/http-exception.filter.ts`）
   `@Catch()` 捕获一切，非 `HttpException` 一律返回"服务器内部错误"，**不记录任何日志**。B9 的 4 个 500 就是这么变成黑盒的。Phase 2 的 WS 与消息链路错误更难复现，这是排障的最大黑洞。

4. **⚠️ 单点 refresh key = 多端互踢**（`redis.service.ts:23`）
   `auth:refresh:{userId}` 一个用户只有一个有效 refresh token，第二个设备登录会把第一个挤掉。**需求上是否允许多端并存必须在 Phase 2 前定**——改晚了要做 Redis key 迁移。多端方案：`auth:refresh:{userId}:{deviceId}`。

5. **⚠️ 登出不吊销 access token，与既定决策 M4 不一致**
   `logout` 只删 Redis 里的 refresh hash，access token 在剩余 TTL（15 分钟）内**仍然有效**。而 Phase 0 的 M4 决策明确写了"双 token + 黑名单吊销"。当前**黑名单未实现**——这是一处决策与实现的偏差，需要显式确认是「延后实现」还是「变更决策」。

### 中优先级

6. **`refresh.dto.ts` / `logout.dto.ts` 是空类且零引用** —— 死代码（refresh 从 cookie 读，logout 走 guard），应删除或补内容。
7. **`decodeExpired` 不验签就取 `sub`**（`token.service.ts:31` + `auth.controller.ts:68`）
   刷新时从**未验证签名**的 access token 里取 userId。当前安全性由 Redis 中的 refresh hash 兜底（伪造 sub 也必须持有对应 cookie），不构成漏洞，但这是脆弱契约。更稳的写法是 `verify(token, { ignoreExpiration: true })`，或让 refresh cookie 自身携带用户标识。
8. **无结构化日志** —— 全项目只有 `main.ts` 一行 `Logger('Bootstrap')`。没有请求日志、没有 traceId、没有慢查询（`typeorm logging: false`）。
9. **`RedisService.ping()` 无人调用**、`config` 仅用于取 TTL —— 预留了健康检查能力但未接入。
10. **响应码语义混用** —— 成功走 `code: 0`（interceptor），失败走 `code: HTTP status`（filter），两套语义压在同一字段。文档已说明，但长期建议独立 `success` 字段或引入业务错误码表。
11. **测试工程化不足** —— 只有 auth 的 e2e（7 例），无单元测试、无 CI；测试数据不清理（靠随机用户名避免冲突，测试库会持续膨胀）；E4 的环境变量未固化成 `.env.test` 或脚本。
12. **无 lint / format 基线** —— `backend/package.json` 无 `lint` 脚本，全项目无 `.eslintrc` / `.prettierrc`。B1、B4 这类"漏导入"本该被 lint 提前拦下。

### 低优先级

13. **CORS 未配置** —— `main.ts` 无 `enableCors()`，开发期靠 Vite proxy（`/api` → `:3000`）同源，部署时需补。
14. **无限流** —— 登录接口无防爆破；`ValidationPipe` 未开 `forbidNonWhitelisted`。
15. **`bcrypt` cost 硬编码 10**（`auth.service.ts:44`）；`passwordHash` 列长 100（bcrypt 60 字符够用，换算法就不够）。
16. **无 API 文档生成** —— `docs/API.md` 手写维护，与代码易漂移；可考虑 Swagger 自动生成。

---

## 5. Phase 2 开工前的基础设施建议

结论：**P0 三项必须先做，否则 Phase 2 的调试成本会指数上升。**

### P0 —— 必须先做（预计 0.5～1 天）

| 项 | 具体动作 | 为什么不能等 |
|---|---|---|
| **Migration** | `synchronize: false` + 独立 `data-source.ts` + `src/migrations/` + `migration:generate` / `migration:run` / `migration:revert` 脚本；先为现有 `users` 表补一条基线 migration | Phase 2 要建 friends / conversations / messages 并加复合索引。**先建表再补 migration，基线就永远对不上了** |
| **日志 + 异常记录** | ① 异常过滤器中对非 `HttpException` 打 `logger.error(exception.stack)`；② 加请求日志（method / url / status / 耗时 / traceId）；③ 推荐 `nestjs-pino`（JSON 输出，便于后续接采集） | B9 已经证明：**没有错误日志，一个 500 要读完整条调用链才能定位**。WS 消息链路的错误比 REST 更难复现 |
| **前端 refresh 单飞** | `client.ts` 用模块级 `let refreshing: Promise \| null`，并发 401 复用同一 promise | 债务 #1，Phase 2 并行请求一上来就会误登出用户 |

### P1 —— 强烈建议（Phase 2 早期）

| 项 | 具体动作 | 收益 |
|---|---|---|
| **异常监控** | `@sentry/node`（后端 5xx + 未捕获异常）+ `@sentry/react`（前端 ErrorBoundary），按 `NODE_ENV` 开关 | WS 断连、消息丢失这类问题**用户侧偶发、本地不可复现**，没有上报就只能靠猜 |
| **健康检查** | `@nestjs/terminus` 暴露 `GET /api/health`，接上现成的 `RedisService.ping()` + DB ping | 部署与 e2e 前置检查都需要；顺手把债务 #9 兑现 |
| **多端登录模型定稿** | 明确「单端 / 多端」；若多端则改 Redis key 为 `auth:refresh:{userId}:{deviceId}` | 债务 #4，**属于数据结构决策，越晚改迁移成本越高** |
| **access token 吊销** | Redis 黑名单存 `jti`（`jti` 已具备），TTL = access 剩余寿命；guard 中查黑名单 | 兑现 M4 决策（债务 #5），封禁/登出才能即时生效 |
| **登录限流** | `@nestjs/throttler`，对 `/auth/login`、`/auth/register` 单独限流 | 防爆破，成本极低 |

### P2 —— 可与 Phase 2 并行

- **CI**：GitHub Actions — `build` + `tsc --noEmit` + `test:e2e`（用 MySQL/Redis service containers），**顺带彻底解决 E1 类"汇报与事实不符"的问题**：CI 绿才算交付。
- **ESLint + Prettier + husky pre-commit**：B1 / B4 这类漏导入本该被 lint 拦下（债务 #12）。
- **测试环境固化**：`.env.test`（`DB_DATABASE=realtime_chat_test` / `REDIS_DB=1`）+ 一键起 WSL2 中间件脚本 + e2e 后清理测试数据（债务 #11、E4）。
- **Swagger**：`@nestjs/swagger` 自动生成，替代手写 `docs/API.md`（债务 #16）。
- **配置必填校验**：用 `joi` / `class-validator` 校验环境变量，生产环境禁止使用 `change-me-*` 默认密钥（E5）。

---

## 6. 一句话总结

Phase 1 功能已闭环并有真实 e2e 兜底，**但 10 个 bug 里 4 个是架构级模块边界问题、2 个只有真实 e2e 才能发现**——这说明「编译通过」远不等于「可运行」。Phase 2 开工前的最小必要投入是 **migration + 日志/异常记录 + 前端 refresh 单飞** 这三项；其中日志的缺失已经在 B9 上真实付出过一次高昂的定位成本，不应再付第二次。
