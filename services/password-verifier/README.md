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

媒体主机使用渠道白名单，以有限 Range 验证 MP3 / FLAC 标记及实际码率。HTTPS 必须通过正常 TLS 校验；不能关闭证书验证、猜测替换 CDN 域名。上游格式不可识别时拒绝播放；搜索与播放是独立能力。

## 部署

将本目录作为独立 Vercel 项目根目录，使用受支持的 Node 版本，并在服务端配置 `PASSWORD_SERVICE_KEY`。控制台填写 `PASSWORD_SERVICE_URL=https://<your-service>/api/password`，密钥与该服务一致。不要把密钥放进浏览器环境变量、仓库或 CLI 参数。

默认使用单个 `hkg1` 运行区域，减少连接亚太音乐上游的往返；可按自己的用户地域与套餐修改 `regions`。这不代表上游始终可用，也不取消单次执行与请求限额。SDK 采用显式模块入口，部署文件包含其动态资源与 QuickJS WASM，避免本机正常而 Serverless 缺少依赖。

验收至少包含：未授权请求返回 401；随机密码哈希与核验通过；真实音源可读取渠道声明；代表曲目的解析结果与浏览器解码可用。不要在公开日志记录脚本、临时签名 URL、内部密钥或请求正文。API 调用受套餐函数与 CPU 限制，超时和上游不可用不等于歌曲永久无效。
