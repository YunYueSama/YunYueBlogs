# 星辉云端控制台

YunYueBlogs 的本地管理端，由 Next.js 16 工作台和 FastAPI 服务组成。管理端仓库只提交程序代码；文章、草稿、结构化数据、计划、任务和密钥位于被忽略的 `workspace/`。

## 启动

```powershell
npm ci
python -m pip install -r requirements.txt
python -m uvicorn cms_core.main:app --host 127.0.0.1 --port 8000
npm run dev
```

也可以在 Windows 中运行 `Start.bat` 启动桌面模式。脚本会在依赖或源码变化后生成 Next standalone 构建，复制静态资源，并把真实管理端根目录传给服务端组件；`workspace/` 不会被复制进构建目录。

启动脚本优先使用 `py -3`，否则使用 PATH 中的 `python`，支持 Python 3.10 及以上版本（包括 3.12）。启动检查失败时窗口会保留错误信息，按任意键退出后返回失败状态。

启动准备完成后，后台控制台隐藏，开发者工具默认关闭。桌面窗口可通过系统标题栏拖动、最小化、最大化和关闭；后台运行日志保存在 `workspace/logs/desktop.log`。

图床上传保留原文件名（包括中文），并向 CloudFlare ImgBed 兼容接口传递 `uploadNameType=origin`。图床遇到同名文件时可能自动添加编号；已上传文件的旧地址不会自动变更。

## 主要接口

| 接口 | 用途 |
|------|------|
| `POST /api/sync/migrate` | 幂等导入旧内容 |
| `POST /api/sync/plan` | 生成差异与警告 |
| `POST /api/sync/apply` | 按 `planId` 同步受管文件 |
| `POST /api/deploy/push` | 创建中文提交并推送 |
| `POST /api/deploy/repository/status` | 读取分支、脏文件和领先/落后状态 |
| `POST /api/deploy/repository/fetch` | 刷新远程引用，不修改工作区文件 |
| `POST /api/deploy/repository/update` | 仅在干净工作区执行 fast-forward 更新 |
| `GET /api/jobs/{id}` | 查询发布任务 |
| `GET/PUT /api/operations` | 读取或持久化操作队列 |
| `POST /api/operations/apply` | 原子应用队列并在失败时回滚 |
| `GET/POST /api/drafts/*` | 保存、读取和删除本地草稿 |
| `GET/POST/DELETE /api/picbed/assets` | 管理本地媒体清单 |
| `POST /api/picbed/test` | 测试图床连接，不回显 Token |
| `POST /api/picbed/upload` | 校验并上传图片 |
| `GET/POST /api/settings/*` | 管理公开配置与本机集成 |
| `GET /api/music/query/{id}` | 校验并缓存网易云歌曲元数据 |
| `GET /api/music/search/kugou` | 按关键词搜索酷狗歌曲并返回 hash 引用 |
| `GET /api/music/lyrics/status` | 执行在线 KRC 搜索、下载、解码和解析检查 |
| `GET /api/music/kugou/{hash}/status` | 检查酷狗歌曲元数据与播放地址 |

所有新接口使用 `{ok, data, error}` 响应。草稿自动保存使用同一草稿 ID 覆盖写入，不会在每次保存时生成新文件；上传接口限制为 12 MB，并校验扩展名、MIME、图片魔数和危险远程地址。

## 本地数据边界

`workspace/` 由程序自动创建并被 Git 忽略，主要包含：

- `content/`、`drafts/`：文章、杂谈、说说和自动保存草稿；
- `data/`：项目、相册、友链和媒体清单；
- `config/public.json`、`config/integrations.json`：可公开设置与非敏感连接信息；
- `config/secrets.json`：图床 Token 等仅限本机的密钥；
- `operations.json`、发布记录：待应用操作和任务状态。

旧目录迁移采用复制和数量校验，确认成功前不会删除来源文件。

“外观”页面可以维护建站日期；保存时统一写为北京时间零点并包含 `+08:00` 时区，供公开站运行时钟使用。

“音乐”页面维护最多 12 首网易云或酷狗歌曲。网易云使用歌曲 ID，酷狗使用关键词搜索后保存歌曲 hash；点击加入时会先检查真实播放地址，保存前还会再次全量复检，不可播放的版本不会进入发布数据。两种来源统一保存为 `musicTracks`，并保留 `musicIds` 兼容旧配置。每首歌会自动执行酷狗在线 KRC 链路获取逐字歌词，无需上传歌词文件；少量源时间误差可以用 -5000 到 5000 毫秒的单曲偏移校准。图床、音乐、相册、项目与友链均可从左侧导航直接进入，图床连接参数仍位于“集成”。

## 验证

```powershell
npm run lint
npm run typecheck
npm run test:client
python -m pytest -q
npm run build
```

若桌面窗口仍在运行，可使用独立目录验收构建，避免 Windows 文件占用：

```powershell
$env:YUNYUE_BUILD_DIR = '.next-review'
npm run build
Remove-Item Env:YUNYUE_BUILD_DIR
```

独立构建用于验收，不会替换当前桌面进程。关闭旧窗口后，双击 `Start.bat` 会按源码变化重新生成正式构建。

## 工作台操作

- 内容库支持按标题、摘要、标签搜索及文章/杂谈筛选，每页最多渲染 20 篇内容。
- 顶栏“快速前往”或 `Ctrl/⌘ + K` 可查找功能，Enter 打开首项，Esc 关闭。
- 操作队列会顺序保存；点击“应用到工作区”时先等待最新快照保存完成。连接或保存失败时保留当前内容，并在队列中提供重试。
- 接口请求默认最多等待 60 秒，不自动重试写入；提交超时后应先确认当前状态，避免重复操作。
- 图床空请求测试只确认接口响应，真实上传仍需图片验证；空请求返回 404 时不再断言上传接口不存在。
- 桌面启动按文件大小和修改时间增量同步资源；退出只清理本次启动的进程，不再按端口终止其他应用。
- 同一目录只运行一个桌面实例，重复启动会唤回已有窗口。首次升级前需先关闭没有实例保护的旧窗口。

同步接口拒绝脏仓库、路径穿越和清单外改动，不执行 `reset`、`clean`、自动合并或强制推送。仓库更新只接受 fast-forward；提交信息必须包含中文，`workspace/config/secrets.json` 不得提交或复制到公开博客仓库。GitHub 推送成功后由 Vercel 仓库集成自动触发构建，控制台保存的 Vercel 项目地址仅用于查看最终部署状态。


## 本机音乐账号与每日福利

登录方式可选择“扫码登录”或“手机号登录”。手机号登录支持中国大陆手机号；点击“获取验证码”才向对应平台请求短信，发送间隔为 60 秒，登录会话保留 10 分钟，验证码最多尝试 5 次。手机号、验证码只在本机内存中临时使用，不写入账号配置或日志。切换方式时取消旧会话，登录成功后清空输入。

扫码确认后会自动更新账号卡片；连续读取失败会明确提示，并提供“重新检查”及手机号替代方式。酷狗会在创建二维码、查询状态与短信登录之间保留相同设备字段。手机端显示成功而这里未显示已登录时，说明本机尚未获得有效凭据，请重新检查；如平台要求安全验证，请在官方手机端完成。

双击 `Start.bat` 会安装固定版本的音乐 SDK 并启动只监听 127.0.0.1 的私密 Node 网关。在“音乐 → 我的音乐账号”中分别用网易云、酷狗概念版手机端扫码确认。二维码 3 分钟过期；账号凭据仅在本机 `workspace/config/music-accounts.json` 保存，Windows 下使用当前用户 DPAPI 加密，不随内容同步。退出账号会清除凭据，酷狗退出同时关闭每日后台任务。

歌曲候选和已有歌单都提供“本机账号试听”。会员、购买、地区和平台资格仍决定是否可取得完整音源；个人音源不会保存进公开歌单。公开博客只提供匿名完整音源，试听片段不会算作可发布歌曲。

酷狗登录后默认启用每天自动领取福利。优先注册当前用户的 Windows 计划任务（每天 09:05、用户登录时）；若系统拒绝注册，使用当前用户启动项运行无窗口后台检查，关闭管理窗口仍有效。电脑必须开机、当前 Windows 用户已登录且网络可用。关闭自动领取开关会关闭后台任务；后台每 5 分钟检查，已确认当日领取不再领取，失败最多每小时重试一次。先查平台记录，再提交领取，再查记录；只在平台记录确认后显示“到账”。需要听歌、广告或其他操作时，应由用户在官方手机端正常完成，本程序不会伪造这些记录。手动“领取 / 核实”可重新确认状态。

本机网关的依赖为 `@neteasecloudmusicapienhanced/api@4.41.1` 和 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) 固定提交 `da5ccfd9304c043085a2fd18e94ebc5c315044ab`。登录及福利流程参考 [kgka_Music_hl](https://github.com/umr-xiaomai/kgka_Music_hl) 与 [KugouMusic.NET](https://github.com/Linsxyx/KugouMusic.NET)；不使用其公共演示服务接收账号凭据。平台接口变更可能需要后续适配。
