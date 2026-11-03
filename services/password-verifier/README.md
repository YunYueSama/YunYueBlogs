# 密码与音乐解析服务

独立 Node 服务，承担固定强度 scrypt 与受限音乐脚本解析。仅接受带 `PASSWORD_SERVICE_KEY` 的内部 POST 请求，浏览器不能直接调用 SDK 或执行脚本。音频正文由原站或独立 Cloudflare Worker 传输，此服务只返回少量解析结果。

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

`build` 生成 QuickJS 内的 Buffer 支持包；生成目录不提交。Vercel 部署使用本目录的 `vercel.json`，保留 includeFiles 配置以包含支持包与 QuickJS WASM。部署后需要真实调用脚本解析接口，不能只以构建成功作为运行证明。

## 接口

- `/api/password`：内部 `hash` / `verify`，固定 scrypt 参数，随机盐，不接受调用方指定哈希强度。
- `/api/music`：`source-import`、`source-info`、`catalog-search`、`resolve`。支持音源声明渠道的网易云、酷狗、QQ、酷我、咪咕目录检索；不提供扫码登录或平台账号操作。

LX API 2.0 兼容范围包括 musicUrl、受控 HTTP、事件、Buffer、crypto、zlib 和单次计时器。这里是受限接口适配层，不是完整 LX 桌面运行时，不承诺兼容任意第三方脚本。适配出处与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库不附带第三方音源。

每次执行使用独立 QuickJS 堆，限制内存、CPU、网络次数、累计字节和总等待时间；网络只允许公共 IP，跳转重新校验，不开放 Node、文件系统、环境变量或账号数据。音源脚本由控制台加密保存，只在内部解析时传入。

内部调用优先传入 `scriptSha256` 引用；实例缺少源码时返回 409 `source_cache_miss`，调用方仅补传一次 `scriptGzip`（gzip + Base64）或原始 `script`，并校验内容哈希。实例最多保留四份源码，闲置 15 分钟过期；每次取源仍创建独立沙箱，不复用脚本状态，也不因此复用旧音频地址。解压后限制为 256 KB，并执行相同的沙箱和媒体校验。已授权请求的 `Server-Timing` 提供处理、脚本、上游网络及媒体探测耗时，`X-Music-Region` 标识实际执行区域；诊断不包含脚本、密钥或音频地址。

可选私有环境变量 `MUSIC_SOURCE_SNAPSHOT` 可预置当前源码，格式为含 `sha256` 与 `brotli`（Brotli + Base64）的 JSON，整体不超过 60 KB。新实例核对哈希后直接接受该引用，省去首次补传。快照必须作为敏感变量保存，不提交源码或实际值；更换音源后新哈希自动使用补传路径，需更新或移除旧快照并重新部署，避免长期保留旧凭据。配置损坏不会关闭普通补传能力。

升级时先部署此服务，再部署启用源码引用的控制台 Worker；回退时先回退 Worker。服务端持续接受原始 `script` 格式，因此旧 Worker 可继续调用。

媒体主机使用渠道白名单，以有限 Range 验证 MP3 / FLAC 标记及实际码率。HTTPS 必须通过正常 TLS 校验；不能关闭证书验证、猜测替换 CDN 域名。上游格式不可识别时拒绝播放；搜索与播放是独立能力。

公开播放的网易云曲目优先尝试匿名完整文件快线路，单次目录请求超时 900 毫秒。只接受完整时长、非试听、符合所选音质且通过同样 Range 校验的文件；不可用时仍执行已选自定义音源，失败判定短期缓存一分钟。无损配置不会用匿名 MP3 代替无损。候选音源测试和控制台私人试听不走此快线路，避免把平台可用误判成候选脚本可用；不引入音乐账号或登录 Cookie。

## 部署

将本目录作为独立 Vercel 项目根目录，使用受支持的 Node 版本，并在服务端配置 `PASSWORD_SERVICE_KEY`。控制台填写 `PASSWORD_SERVICE_URL=https://<your-service>/api/password`，密钥与该服务一致。不要把密钥放进浏览器环境变量、仓库或 CLI 参数。

默认使用单个 `hkg1` 运行区域，减少连接亚太音乐上游的往返；可按自己的用户地域与套餐修改 `regions`。这不代表上游始终可用，也不取消单次执行与请求限额。SDK 采用显式模块入口，部署文件包含其动态资源与 QuickJS WASM，避免本机正常而 Serverless 缺少依赖。

验收至少包含：未授权请求返回 401；随机密码哈希与核验通过；真实音源可读取渠道声明；代表曲目的解析结果与浏览器解码可用。不要在公开日志记录脚本、临时签名 URL、内部密钥或请求正文。API 调用受套餐函数与 CPU 限制，超时和上游不可用不等于歌曲永久无效。
