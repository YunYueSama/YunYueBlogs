# YunYueBlogs · 云月博客管理端

**Ai·Code·Magic** — 为个人博客准备的本地桌面控制台，负责创作、音乐、图床与安全发布。

[访问博客](https://majo-elaina.top) · [公开站源码](https://github.com/YunYueSama/YunYueBlog) · [English](README_en.md) · [技术文档](docs/README.md)

![管理端概览](.github/readme/console-overview.png)

## 两个仓库，各司其职

| 工程 | 职责 | 技术 |
| --- | --- | --- |
| 本仓库的 `my-blog-manager` | 本机编辑、账号配置、差异预览、同步与提交 | Next.js 16、React 19、FastAPI、pywebview |
| 独立仓库 `YunYueBlog` | 访客访问的公开博客与服务端接口 | Astro 7、React Islands、Tailwind CSS 4、Vercel |

公开内容以连接的**远程博客仓库**为同步基准。各设备需要连接同一仓库；未发布修改、私密草稿和账号凭据留在本机。公开网站是已部署的快照，保存本地草稿不会自动改变线上内容。

## 控制台能做什么

- **内容创作**：管理文章、杂谈与说说，支持富文本、Markdown 和媒体插入。
- **资源管理**：图床上传、相册、项目与友链配置。
- **音乐**：网易云与酷狗账号登录、歌曲搜索、公开歌单、音源检查与歌词；账号权益受平台实际返回结果约束。
- **外观与 Robin**：配置站点外观、Bangumi 和 Robin API Key。Robin 固定使用 DeepSeek-V4.1-Flash，接口模型标识为 `deepseek-flash`。
- **安全发布**：服务器内容刷新、差异预览、同步计划、后台任务队列和 Git 提交推送。文章 Giscus/Gitalk 评论功能已移除。

![发布页：先检查差异，再同步与推送](.github/readme/console-publish.png)

## 从第一次启动到第一次发布

**管理端在自己的 Windows 电脑运行，公开博客部署到 Vercel。** 推荐先让博客上线，再连接管理端；下面各步骤可以单独展开。博客首次上线的图文介绍见[博客 README](https://github.com/YunYueSama/YunYueBlog#想自己搭一个也欢迎)。

<details>
<summary><strong>① 准备工具和两个仓库</strong></summary>

安装 [Git for Windows](https://git-scm.com/downloads/win)、[Node.js](https://nodejs.org/) **22.12+** 和 [Python](https://www.python.org/downloads/windows/) **3.10+**（例如 3.12）。Python 安装时启用 PATH 或 Python Launcher，安装后重新打开 PowerShell：

```powershell
git --version
node --version
npm.cmd --version
py -3 --version
```

`py` 不可用时检查 `python --version`，后续 Python 命令使用实际可用且版本符合要求的解释器。

在 GitHub 为两个工程准备自己有权限的仓库：博客仓库需要可推送并授权 Vercel 访问；管理端仓库用于本机控制台。可以 Fork，或从有权访问的源码创建自己的副本。未登录或仓库权限不足时，GitHub 可能显示 404。

以下示例中的 `你的用户名` 要先替换，路径也可按自己的电脑调整：

```powershell
New-Item -ItemType Directory -Force D:\Projects
Set-Location D:\Projects
git clone https://github.com/你的用户名/YunYueBlogs.git YunYueBlogs
Set-Location YunYueBlogs
git clone https://github.com/你的用户名/YunYueBlog.git YunYueBlog
```

得到下面的结构。内层博客是独立 Git 仓库，已被外层仓库忽略，不要把它作为管理端文件再次上传：

```text
D:\Projects\YunYueBlogs/
├─ my-blog-manager/      本机控制台
└─ YunYueBlog/           Astro 博客仓库
```

首次提交前配置自己的 Git 姓名和公开邮箱（可用 GitHub noreply 邮箱）。推送时通过 Git Credential Manager 的浏览器授权登录，不把 Token 拼进 URL。先按[博客搭建教程](https://github.com/YunYueSama/YunYueBlog#想自己搭一个也欢迎)完成个性化、首次 Vercel 部署，并提交所有准备修改，让博客仓库保持干净。

</details>

<details>
<summary><strong>② 安装并打开桌面管理端</strong></summary>

在上一步创建的目录中执行：

```powershell
Set-Location D:\Projects\YunYueBlogs\my-blog-manager
npm.cmd ci
py -3 -m pip install -r requirements.txt
.\Start.bat
```

只有 `python` 命令时，将安装命令换成 `python -m pip install -r requirements.txt`，确保与启动器使用同一个 Python 环境。

首次启动会检查依赖、准备本机音乐网关并构建桌面前端，可能需要几分钟。等桌面窗口出现并能打开“概览”“文章”“发布”，就完成了启动。后续可直接双击 `my-blog-manager/Start.bat`。

启动器自动选择本机端口并生成被忽略的 `public/backend_config.json`，桌面模式不用手工填写端口。关闭管理窗口会清理它启动的服务进程。管理端仅监听本机，不要将它直接作为公网管理后台部署。

打不开时，先在 PowerShell 执行上述启动命令看错误：检查 Python 版本、Node 和 npm 是否可用，以及 npm / GitHub 网络。不要通过上传依赖目录或构建文件来解决安装失败。纯浏览器开发方式见[运维指南](docs/部署与运维指南.md)。

</details>

<details>
<summary><strong>③ 首次连接：先读取服务器内容，再开始编辑</strong></summary>

进入管理端“发布”，填写以下配置：

| 字段 | 首次示例 / 含义 |
| --- | --- |
| 本地博客仓库 | `D:\Projects\YunYueBlogs\YunYueBlog`，必须是 Astro 仓库根目录 |
| Remote | 通常 `origin`，对应自己的远程博客仓库 |
| 分支 | 通常 `main`，与 Vercel Production Branch 一致 |
| Vercel 项目地址（可选） | 自己的 `https://vercel.com/团队/项目`，用于打开部署页面 |

**点击“检查状态”会保存发布配置并检查仓库。** 随后“刷新远程”，若落后且工作区干净，执行“安全更新本地”。路径不要填网页 URL、外层管理端目录、`src` 或 `.git`。

回到顶部“连接服务器内容”，点击 **从服务器同步并启用**。首次连接会备份旧本地内容，再读取远程博客仓库中的文章、歌单和公开设置。确认文章数量、近期更新与歌单符合服务器最新版本，再开始编辑，避免用空白或过时内容覆盖其他设备的工作。

这里的“服务器内容”指远程 Git 仓库中的目标分支，公开网站展示的是 Vercel 已部署的版本，两者在部署期间可能暂时不同。

填写 Vercel 项目地址只提供跳转入口，**不等于完成 Vercel 登录或项目绑定**。普通内容发布由 GitHub 集成触发，无需本机 Vercel CLI；上传 Robin 密钥需要下一节的单独授权。

</details>

<details>
<summary><strong>④ 第一次发布：保存 → 预览 → 同步 → 推送 → 检查上线</strong></summary>

1. 在文章、外观或音乐页编辑并保存。**保存只写入本机工作区**，不会立刻修改线上博客。
2. 进入“发布”，点击 **刷新远程**，有远程新版本时先检查并 **安全更新本地**；刷新服务器内容，确认跨设备更新。
3. 点击 **生成差异预览**，逐项检查新增、更新和删除。特别核对删除的文章或歌曲是否确实是本次操作。
4. 计划可用后点击 **应用同步**，将受管内容写入本地博客仓库。
5. 填写中文提交信息，例如 `内容：新增学习笔记并更新歌单`，不超过 120 字；点击 **提交并推送**，等待任务成功。
6. 打开 Vercel 项目，找到对应提交的部署。生产分支推送通常直接触发 Production，其他分支通常是 Preview；等 **Ready** 后检查正式网址的文章、图片与音乐页。

| 操作 | 实际结果 |
| --- | --- |
| 保存 | 本机编辑结果已保存 |
| 刷新服务器内容 | 从远程仓库刷新公开内容基准 |
| 应用同步 | 审查过的内容写入本机博客仓库 |
| 提交并推送 | 源码交给远程 Git，由 Vercel 仓库集成构建 |
| 部署 Ready 并检查页面 | 确认正式网站实际更新 |

目标博客仓库有未提交代码改动时，同步会锁定；先检查 `git status --short`，自行保留、提交或处理这些改动。服务器内容变化后需要重新生成计划，不能复用旧预览。推送失败时本地提交会保留，修复权限或网络后再推送，不用强制推送覆盖分歧。

换设备时重复安装和连接步骤，使用同一个远程博客仓库；开始编辑前刷新服务器内容。未发布草稿、账号登录状态与本机设置不会自动复制到另一台电脑。

</details>

<details>
<summary><strong>⑤ 配置 Robin、图床、书架和音乐账号</strong></summary>

**Robin 密钥**可以直接在 Vercel 配置 `DEEPSEEK_API_KEY`（Production）并重新部署，也可以使用管理端“集成”中的 Robin 配置。后者需要先安装 CLI，并在**本地博客目录**关联已有项目：

```powershell
npm.cmd install -g vercel
vercel.cmd login
Set-Location D:\Projects\YunYueBlogs\YunYueBlog
vercel.cmd link
```

按提示选择正确团队和已经部署的博客项目，不另建一个空项目。`.vercel/` 是本机绑定信息，不提交，每台设备分别登录和关联。然后在管理端填写 API Key，点击 **保存 Robin 配置 → 同步到 Vercel 并部署 → 刷新服务器状态**，同时检查 Vercel 部署结果。模型固定为 **DeepSeek-V4.1-Flash**，仅配置密钥。

**图床**：在“集成”填写自己图床服务的接口地址与 API Token，保存后用一张非敏感图片验证上传及访问链接。不同图床协议并非都兼容，不能直接使用作者的账号或密钥；上传成功后再将链接加入文章并发布。

**Bangumi**：填写自己的公开用户名，保存集成配置，再通过日常发布流程同步 `src/data/site.json`。无需 Token；如果 Vercel 已配置 `BANGUMI_USERNAME`，它会覆盖公开文件中的用户名。

**音乐账号**：在“音乐”选择网易云或酷狗扫码 / 手机号登录，按官方端要求确认，看到登录状态后再测试歌曲。歌单需要按发布流程上线；本机登录不等于服务器拥有账号。当前界面没有音乐账号一键同步到 Vercel 的按钮，服务器会员音源是额外的私有环境配置；不要把账号 Cookie 填进公开歌单或上传登录文件。会员权益与福利领取以平台实际返回和记录为准。

</details>

## 目录与隐私

```text
my-blog-manager/
  app/              控制台页面
  components/       编辑器与管理组件
  cms_core/         FastAPI、同步、发布与账号服务
  services/         本机音乐网关
  tests/            API 和客户端测试
  workspace/        本机内容、设置与任务（Git 忽略）
docs/               当前架构与运维文档
.github/readme/     README 配图
```

`workspace/`、`.env*`、本机端口配置、窗口设置、账号文件、旧版本机内容目录、依赖、构建产物和测试缓存不进入 Git。公开博客所需文章、图片、角色素材和公开配置保存在独立博客仓库。

服务端密钥通过 Vercel 环境变量配置；不要把 API Key、Cookie、图床 Token 或 Git 凭据放进公开 JSON、截图或提交。取消跟踪不会抹除已有 Git 历史；曾公开过的真实密钥需要在对应平台撤销并重新生成。

## 验证与恢复

```powershell
cd my-blog-manager
npm.cmd run typecheck
npm.cmd run test:client
python -m pytest -q
npm.cmd run build
```

发布失败时保留本地提交并检查任务日志，不使用强制推送覆盖分歧。线上异常可在 Vercel 切回上一份成功部署，本机工作区独立保留。

## 素材与使用范围

角色主题与互动为个人博客中的同人表达，参考《魔法使之夜》2022 全语音高清版及 2023 Steam 版；作品角色和素材权利归原权利人。复用项目前应核对源码、字体、图片和第三方依赖各自的授权，勿将游戏素材误认为项目自行授权的公共资产。
