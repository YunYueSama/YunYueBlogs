# 云月的创作间

React / Vite 在线管理端，Cloudflare Worker 处理鉴权、内容与发布，D1 保存文稿、修订、会话和加密集成配置。公开博客由独立 Astro 仓库构建。

## 使用

在自己绑定的管理域名登录，编辑并保存文稿，选择公开内容后发布。保存是云端草稿操作，发布会生成不可变快照并提交到目标 GitHub 仓库。Vercel Git 集成负责构建与原子上线；控制台回读正式站的 `release.json`、首页和首篇公开文章，全部匹配后显示成功。通常需要等待几分钟，30 分钟未确认则显示失败，请检查部署记录。

一个站点只有一个站长账号；首次激活后必须改密。密码必填、确认一致、不能与原密码相同，不设置字符组合或复杂度规则。服务端仍执行限流、固定强度 scrypt、Origin / CSRF 校验与改密后会话撤销。

音乐工作台提供自定义音源导入、测试和启用，以及音源声明渠道的关键词检索、歌单编辑排序与试听。支持网易云、酷狗、QQ、酷我、咪咕目录适配；歌词自动加载，不提供音乐平台账号登录或手动排轴。检索显式提交、每页 15 条，关键词跨渠道保留，缓存 5 分钟并限制并发。支持检索不代表每个结果都可播放。

播放音质只由站长配置，保存并发布后对博客生效。右侧播放器与歌单共用音频实例；两个页面均设置 no-referrer，避免媒体 CDN 因来源校验返回 403。

公开播放支持静态已发布清单入口 `GET /public/music/play?catalog=…&track=…`，Cloudflare 仅从 `SITE_URL/music-catalog.json` 读取并核对清单哈希、曲目及后台音质，公开清单最多缓存 60 秒。浏览器不能提交任意曲目元数据或提升音质。博客首屏不需要 Vercel 动态歌单接口，也不在静态页面中放置长期播放密钥。

取源完成后返回 307，音频继续由原站或独立音频 Worker 传输。`prepare=true` 只返回地址与有效期 JSON，浏览器可预备当前曲目、顺序播放的下一首和悬停曲目，点击直接使用已准备地址，不提前下载音频。网易云地址按签名截止时间提前一分钟失效，最多缓存五分钟；无法识别截止时间的地址缓存两分钟。命中缓存不调用远程解析，也不占用远程取源限流额度。`renewal` 使用刷新批次隔离缓存，确保手动刷新及失效重试可取得新地址。`warm=true` 的 204 入口、短期 HMAC 入口和 `POST /public/music/resolve` 保留兼容。博客不显示音质数值，默认品质仍由站长统一维护。

更换已有曲目渠道时，应同时保存站点歌单、歌词引用和公开发布数据，核对歌手、专辑、时长及游戏版等版本差异；不能只修改平台 ID。失败时可恢复控制台配置历史版本及对应公开站点提交，再重新发布。音源文件与凭据不进入公开快照。

## 开发与验证

使用 `package.json` engines 指定的 Node 版本：

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

项目使用 `cloudflare.config.ts` 与 cf CLI；类型由 `cf workers types` 生成。不要手写或提交 `.cloudflare`。生产域名和仓库绑定请在配置中改成自己的。

浏览器验收使用 `CONSOLE_BOOTSTRAP_FILE`、`E2E_ADMIN_USERNAME`、`E2E_INITIAL_PASSWORD` 与 `npm.cmd run test:e2e`。测试服务使用隔离的 Miniflare D1/R2 和真实 Node scrypt，不连接生产库。

人工预览可设置 `CONSOLE_LOCAL_REVIEW=1`，再运行 `tests/preview-server.mjs`。本机持久数据位于忽略目录 `.cloudflare/local-review/resources`，通过 Miniflare 5 的 `resourcePersistencePath` 保留。自动验收应使用 `CONSOLE_LOCAL_REVIEW=0` 和独立端口；不要用自动测试覆盖人工库。

## 配置

| 名称 | 用途 |
| --- | --- |
| `DB` | D1 文稿、修订、账号、会话与发布记录 |
| `D1_DATABASE_ID` | 构建、部署时提供已有 D1 的 UUID，关闭自动建库时必须填写 |
| `MEDIA` | 可选私有 R2 素材，默认不绑定 |
| `PASSWORD_SERVICE_URL` | Node 服务的 `/api/password` 完整 HTTPS 地址；音乐接口使用同 origin 的 `/api/music` |
| `PASSWORD_SERVICE_KEY` | Node 与管理 Worker 的内部共享密钥 |
| `SETTINGS_ENCRYPTION_KEY` | 32 字节十六进制 AES-GCM 密钥；丢失后无法恢复加密配置 |
| `GITHUB_TOKEN` / `GITHUB_REPOSITORY` | 目标公开博客仓库的写入凭据与仓库名 |
| `PUBLISH_TOKEN` | 兼容内部发布回调的独立认证密钥 |
| `SITE_URL` | 正式博客 origin，供上线回读与 CORS 使用 |
| `MUSIC_DELIVERY_KEY` | 博客、管理 Worker、音频 Worker 共用的 32 字节十六进制 HMAC 密钥 |
| `MUSIC_STREAM_ORIGIN` | 独立音频 Worker 的 HTTPS origin |
| `MUSIC_DELIVERY_BUDGET_BYTES` | 滚动 31 个 UTC 日桶的中转预留上限；0 仅监测 |

私有配置只以 Cloudflare / Vercel 服务端秘密或忽略文件注入。`ENABLE_PRIVATE_MEDIA=1` 才启用 R2 绑定；需要先自行开通 R2、核对费用并创建桶，不能把部署默认行为当成免费承诺。

## 初始化、迁移与部署

完整步骤见[部署指南](../../docs/部署与运维指南.md)。

- `scripts/prepare-admin.mjs` 从进程环境读取私有账号与密码，生成 D1 初始化批次和 24 小时一次性激活票据；不会直接写数据库，也不会覆盖既有文件。
- `scripts/import-public.mjs` 从公开博客的白名单目录导入，跳过 `draft: true`；重复运行不覆盖云端已编辑文稿。
- 先应用 `migrations/0001_console.sql`、`0002_integrations.sql`，再初始化账号和内容。迁移已有库时备份账号哈希、修订及 `SETTINGS_ENCRYPTION_KEY`，不要重置站长密码。
- `music-worker/cloudflare.config.ts` 单独部署音频服务，仅需要 D1 与 HMAC 密钥，不持有管理员解密密钥或 GitHub 写入权限。
- 有效原站 HTTPS 直接给浏览器；原站仅 HTTP 时使用最多约 10 分钟的签名票据走独立 Worker。生产博客不通过 Vercel 兜底音频。

```powershell
# 登录后先查看当前版本命令帮助，并预览部署
npx cf deploy --help
npx cf deploy --prebuilt --mode production --provision=false --secrets-file <private-secrets.json> --dry-run
# 核对绑定、域名、秘密文件后移除 --dry-run 执行
```

部署环境变量在构建前提供，cf 的模式与产物必须一致。音频项目在 `music-worker` 目录单独构建、部署。回退代码不能恢复数据库或密钥；停用音源后已有短期票据会自然失效，不要通过删除私有设置来排障。

## 数据与隐私

管理 API 使用 `private, no-store`，会话使用 HttpOnly Cookie。本机 IndexedDB 仅用于断网恢复，退出时清理。第三方音源、图床 Token 以 AES-GCM 保存，公开快照拒绝私密字段。不要公开本机数据库、激活票据、真实账号、临时媒体地址、测试截图和诊断日志。
