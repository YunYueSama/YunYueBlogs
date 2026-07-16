# YunYueBlogs

YunYueBlogs 是一个本地优先的个人博客系统。公开站使用 Astro 7 构建并部署到 Vercel；星辉云端控制台使用 Next.js 16 与 FastAPI 管理内容、媒体、集成和 Git 发布。

本项目基于 [XinghuisamaBlogs](https://github.com/heiehiehi/XinghuisamaBlogs) 二次开发，感谢原作者的开源贡献。

## 项目结构

| 目录 | 职责 | 是否提交内容 |
|------|------|--------------|
| `YunYueBlog/` | Astro 公开博客、服务端接口、Vercel 构建 | 是 |
| `my-blog-manager/` | Next.js 管理界面与 FastAPI 本地服务 | 只提交程序代码 |
| `my-blog-manager/workspace/` | 文章、草稿、结构化数据、计划、任务和密钥 | 否 |
| `docs/` | 当前架构、部署说明和专题技术笔记 | 是 |

## 核心能力

- Astro Content Collections 管理文章、杂谈和说说，保留原文件名与公开 URL；
- Pagefind 静态搜索、RSS、Sitemap、数学公式、代码高亮与响应式阅读；
- Giscus 评论、只读 Bangumi 书架、网易云/酷狗双源播放器、在线 KRC 动感歌词和按需 AI 助手；
- 本地控制台管理内容、图床、公开配置、集成与发布；
- `plan -> apply -> push` 三阶段发布，阻断无关 Git 改动且不执行强制覆盖；
- 密钥仅保存在本机忽略目录或 Vercel 环境变量中。

## 快速开始

公开站：

```powershell
cd YunYueBlog
npm install
npm run dev
```

管理端：

```powershell
cd my-blog-manager
npm install
python -m pip install -r requirements.txt
python -m uvicorn cms_core.main:app --host 127.0.0.1 --port 8000
npm run dev
```

Windows 也可运行 `my-blog-manager/Start.bat` 启动桌面控制台；首次运行或源码变化后会自动生成稳定的 standalone 构建。

## 质量检查

```powershell
cd YunYueBlog
npm run lint
npm run test
npm run check
npm run build

cd ..\my-blog-manager
npm run lint
npm run typecheck
python -m pytest -q
npm run build
```

详细说明见 [博客 2.0 项目总览](docs/博客2.0项目总览.md)、[项目架构详解](docs/项目架构详解.md)和[部署与运维指南](docs/部署与运维指南.md)。
