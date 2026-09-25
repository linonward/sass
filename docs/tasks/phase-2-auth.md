# 阶段 2：登录

阶段完成后：可以做需要登录的免费工具。

---

## T201 db

- 分支 / worktree：`feat/db` → `../sass-db`
- 依赖：T102
- 外部依赖：Neon

**做**

- 接入 Drizzle ORM 和 drizzle-kit
- `src/core/db/index.ts` 导出 `db`：
  - Neon 地址使用 `drizzle-orm/neon-serverless` 的 `Pool`（支持事务）
  - 其他 Postgres 地址使用 `pg`（本地和 CI 用）
- schema 位置：套件的表放在 `src/core/db/schema/`，业务的表放在 `src/features/*/schema.ts`；`drizzle.config.ts` 用 glob 同时收录两处
- 脚本：`db:generate`、`db:migrate`、`db:studio`；迁移文件提交进仓库
- CI 通过 GitHub Actions 的 `services: postgres` 运行需要数据库的测试；本地通过 `DATABASE_URL_TEST` 指定测试库
- 通过 Neon 官方的 Vercel 集成，为每个预览部署创建独立的数据库分支
- 在 env 中加入 `DATABASE_URL`

**不做**：任何业务表

**验收**

- [ ] 在空库上执行 `pnpm db:migrate` 能成功
- [ ] CI 中数据库测试通过
- [ ] 预览部署连接的是独立分支，而不是生产库

**测试**：一个连通性测试，以及一个事务回滚测试

---

## T202 email

- 分支 / worktree：`feat/email` → `../sass-email`
- 依赖：T102、T104
- 外部依赖：Resend（需验证发信域名）

**做**

- 接入 `resend` 和 React Email；统一入口 `sendEmail({ to, template, props, locale })`
- 发送方式由 `EMAIL_TRANSPORT` 决定，取值：
  - `resend`：生产环境使用
  - `console`：本地默认，把邮件打印到终端
  - `file`：测试用，把邮件写成 JSON 放到 `.tmp/emails/`，供 e2e 读取
- 在配置中加入 `email`：发件人名称、发件地址、回复地址
- 模板放在 `src/core/email/templates/`：基础布局（带品牌）、`sign-in-code`（登录验证码）、`welcome`；文案来自 `messages`
- 脚本 `email:dev`：本地预览模板
- 在 README 的上线清单里加入 Resend 域名验证步骤（SPF / DKIM）

**不做**：营销邮件、订阅列表

**验收**

- [ ] 本地没有 key 时，邮件打印到控制台
- [ ] 生产环境缺少 `RESEND_API_KEY` 时，启动失败
- [ ] 模板跟随 locale 切换文案

**测试**：Vitest 覆盖三种发送方式；对模板渲染做快照

---

## T203 auth

- 分支 / worktree：`feat/auth` → `../sass-auth`
- 依赖：T201、T202、T103
- 外部依赖：Google Cloud OAuth Client

**做**

- 接入 Better Auth，使用 Drizzle adapter，并生成 auth 相关的表
- 登录方式：Google OAuth，以及邮箱验证码（Better Auth `emailOTP` 插件，通过 `sendEmail` 发送 `sign-in-code` 模板）
- 验证码参数写进配置 `auth.emailOtp`，不依赖插件默认值：`length: 6`、`expiresIn: 300` 秒、`allowedAttempts: 3`、`resendCooldown: 60` 秒。实现时对照插件文档；插件原生不支持的参数（例如重发冷却），在调用发送前由 `src/core/auth` 自己校验
- 开启 Better Auth 的账户关联，把 `google` 设为可信 provider，这样同一个邮箱用两种方式登录会进入同一个账户
- 登录页流程：输入邮箱 → 发送验证码 → 输入 6 位验证码 → 进入登录态；首次使用邮箱即自动注册
- 验证码输入框支持粘贴和自动填充（`autocomplete="one-time-code"`），重发按钮显示倒计时
- 页面：`/sign-in`（Google 按钮 + 邮箱验证码表单）、OAuth 回调，以及退出登录
- 保护 `(app)` 路由组：proxy 中先做基于 cookie 的快速判断，layout 中再做服务端 session 校验
- Better Auth 自带限流，存储选 `database`
- 用户首次注册时发送 `welcome` 邮件
- 登录后跳回原来的页面（`callbackURL`）

**不做**：admin 插件（放在 T502）、magic link、密码登录、其他 OAuth 服务商

**验收**

- [ ] 用 Google 登录、邮箱验证码登录都能进入 `/dashboard`
- [ ] 验证码输错 3 次后失效，过期后失效，60 秒内不能重发
- [ ] 同一邮箱先用验证码注册、再用 Google 登录，进入的是同一个账户
- [ ] 未登录访问 `(app)` 下的页面时，跳转到登录页，登录后再跳回原页面
- [ ] 生产环境用真实邮箱走一次验证码登录：邮件进入收件箱（不是垃圾箱），发件人和排版正确（T202 的真实发信验证合并到这里）

**测试**：e2e 用 `EMAIL_TRANSPORT=file` 读取验证码完成登录，并覆盖输错、过期、重发冷却；Google 登录和账户关联做人工验证

---

## T204 dashboard

- 分支 / worktree：`feat/dashboard` → `../sass-dashboard`
- 依赖：T203

**做**

- `(app)` 布局：侧边栏导航。套件的菜单项和业务的菜单项分开配置，业务项写在 `site.config.ts` 的 `dashboard.nav`
- 用户菜单：头像、邮箱、切换语言、退出登录
- 账户设置页：修改名称、偏好语言、删除账户
- 删除账户：二次确认后级联删除用户数据。提供 `onUserDelete` 钩子注册表，供后续模块挂载清理逻辑（T303 会挂上"取消订阅"）
- Dashboard 首页：一个空状态页面

**不做**：账单页（放在 T304）

**验收**

- [ ] 在 `dashboard.nav` 加一项后，侧边栏出现对应入口
- [ ] 删除账户后无法再登录，数据库中该用户的数据已被清除

**测试**：e2e 覆盖修改名称和删除账户；Vitest 验证 `onUserDelete` 钩子被调用
