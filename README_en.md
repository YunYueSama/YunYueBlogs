# YunYueBlogs · A personal writing studio

A browser-based studio for a personal Astro blog: write, collect music, manage images, and publish a reviewed public snapshot.

[中文](README.md) · [Live blog](https://yunyuesama.cn) · [Public blog source](https://github.com/YunYueSama/YunYueBlog)

## Features

- Single-owner account, one-time activation, mandatory first password change, server-side sessions.
- Markdown editing, autosave, revision conflict detection, offline draft recovery and export.
- Articles, life journal, albums, projects, links, site settings and a Bangumi shelf.
- Custom LX-compatible music sources, keyword search across declared channels, playlists, automatic lyrics and a compact preview player. Playback quality is controlled by the owner.
- Public image-host integration; private R2 media is optional and disabled by default.
- Immutable publishing snapshots, GitHub-to-Vercel builds and live-site verification.
- Local fonts, restrained glass surfaces, scene transitions, responsive layouts and reduced-motion support.

## Architecture

| Component | Location / runtime |
| --- | --- |
| Public blog | [Separate Astro repository](https://github.com/YunYueSama/YunYueBlog), Vercel |
| Online studio | `apps/console`, React / Vite, Cloudflare Worker + D1 |
| Audio delivery | `apps/console/music-worker`, separate Cloudflare Worker |
| Password and music resolution | `services/password-verifier`, Node / Vercel |
| Legacy desktop manager | `my-blog-manager`, Next.js / FastAPI |

Drafts and encrypted integration settings stay in D1. Publishing commits only selected public documents to the blog repository. The studio reports success after the production snapshot and public pages have been verified.

## Self-hosting

Fork both repositories and use the Node version specified by each package. Configure your own domains, repository names and resource bindings. Deploy the Node service, provision D1, initialize your private owner account, deploy the audio Worker and studio, then configure and deploy the blog.

See the [deployment guide](docs/部署与运维指南.md), [studio README](apps/console/README.md) and [Node service README](services/password-verifier/README.md). There is no shared default account or bundled third-party source. Secrets, databases, backups and `.env` files must stay out of Git.

```powershell
cd apps/console
npm.cmd ci
npm.cmd test
npm.cmd run build
```

## Bandwidth and limits

Audio uses valid upstream HTTPS directly where possible, otherwise a signed URL to the separate Cloudflare service. Production audio bytes do not pass through Vercel. This still consumes visitor bandwidth and is subject to Cloudflare request/CPU limits, upstream availability and service terms. A rolling delivery budget is available. Lossless playback increases bandwidth and buffering; 320 kbps is the default.

Plan limits change: check your own provider dashboards. R2 is opt-in. Robin uses a server-side DeepSeek key with separate API billing. Search support does not guarantee playback of every result.

## Contributing and licenses

Issues and focused pull requests are welcome. Include reproduction steps and relevant checks; remove credentials and private content from screenshots.

Project-owned content is shared under [CC BY-NC 4.0](LICENSE). Third-party dependencies, fonts and artwork retain their respective terms. Witch on the Holy Night assets belong to TYPE-MOON and other rights holders; replace personal and third-party assets as needed before redistribution.

Product and interaction inspiration: [spring_blogs](https://github.com/RRTiamo/spring_blogs), [QWidgetSekai](https://github.com/Aegisir/QWidgetSekai). The web implementation is independent. LX interface adaptation references [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop); see [third-party notices](services/password-verifier/THIRD_PARTY_NOTICES.md).
