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

## Windows 启动

安装 Node.js **22.12+**、Python **3.10+** 和 Git，然后进入管理端：

```powershell
cd my-blog-manager
npm.cmd ci
python -m pip install -r requirements.txt
.\Start.bat
```

首次启动会准备前端和本机音乐网关，耗时长于后续启动。也可双击 `Start.bat`。关闭桌面管理窗口时，启动器清理其启动的前端、API 与音乐网关进程，不结束其他程序。

纯浏览器开发方式见[部署与运维指南](docs/部署与运维指南.md)。管理端仅供本机使用，不应直接开放到公网。

## 跨设备使用与发布

1. 在“发布”设置连接你的 **Astro 博客仓库**、目标分支和 Vercel 项目。
2. 首次使用或换设备后，刷新服务器内容。已有未发布修改时先检查提示，避免用过时数据覆盖远程。
3. 编辑后保存；保存只写入本机工作区。
4. 在“发布”生成差异，逐项确认新增、更新与删除，再应用同步。
5. 提交并推送后，到 Vercel 查看部署结果。只有部署成功且线上页面验证通过，才算正式发布。

| 操作 | 作用 |
| --- | --- |
| 保存 | 保存本机编辑结果 |
| 刷新服务器内容 | 从连接的远程仓库更新工作区 |
| 应用同步 | 将审查过的工作区变化写入本机博客仓库 |
| 提交并推送 | 将博客仓库提交推送到远程，由部署平台发布 |

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
