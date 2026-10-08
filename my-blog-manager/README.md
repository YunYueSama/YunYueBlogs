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
python -m pytest -q
npm run build
```

同步接口拒绝脏仓库、路径穿越和清单外改动，不执行 `reset`、`clean`、自动合并或强制推送。仓库更新只接受 fast-forward；提交信息必须包含中文，`workspace/config/secrets.json` 不得提交或复制到公开博客仓库。GitHub 推送成功后由 Vercel 仓库集成自动触发构建，控制台保存的 Vercel 项目地址仅用于查看最终部署状态。
