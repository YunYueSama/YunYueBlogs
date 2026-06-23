import os
import json
from fastapi import APIRouter, Request

router = APIRouter()


def fix_picbed_urls(data, pic_bed_url):
    """将图床 publicUrl 格式转为图片直链（/file/ 路径）"""
    if not pic_bed_url:
        return data
    base = pic_bed_url.rstrip('/')

    def fix_url(url):
        if not url or not isinstance(url, str):
            return url
        # 格式1: https://tu.majo-elaina.top/xxx.jpg → /file/xxx.jpg
        if url.startswith(base + '/') and '/file/' not in url:
            return url.replace(base + '/', base + '/file/', 1)
        # 格式2: https://tu.majo-elaina.topxxx.jpg（缺少分隔符）
        if url.startswith(base) and not url.startswith(base + '/') and len(url) > len(base):
            return base + '/file/' + url[len(base):]
        return url

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                if 'cover' in item:
                    item['cover'] = fix_url(item['cover'])
                if 'photos' in item and isinstance(item['photos'], list):
                    for photo in item['photos']:
                        if isinstance(photo, dict) and 'url' in photo:
                            photo['url'] = fix_url(photo['url'])
    return data

# 🌟 核心修复：动态获取项目根目录
# __file__ 是当前文件的绝对路径
# os.path.dirname(__file__) 是 cms_core/api/
# 再向上两级就是项目根目录 my-blog-manager/
CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))

# 🌟 根据你提供的位置，目标文件在项目根目录下的 data/albums.ts
ALBUMS_TS_PATH = os.path.join(PROJECT_ROOT, "data", "albums.ts")


@router.post("/sync")
async def sync_gallery(request: Request):
    """
    接收前端传来的全量相册数组，并将其物理重写回 data/albums.ts
    """
    try:
        payload = await request.json()
        albums_data = payload.get("albums", [])

        if not isinstance(albums_data, list):
            return {"success": False, "message": "数据格式非法，预期为数组"}

        # 🌟 读取 picBedUrl 并转换所有图床 URL
        pic_bed_url = None
        site_config_path = os.path.join(PROJECT_ROOT, "siteConfig.ts")
        if os.path.exists(site_config_path):
            import re
            with open(site_config_path, "r", encoding="utf-8") as f:
                content = f.read()
            m = re.search(r'picBedUrl\s*:\s*"([^"]*)"', content)
            if m:
                pic_bed_url = m.group(1)

        albums_data = fix_picbed_urls(albums_data, pic_bed_url)

        # 1. 序列化数据（确保中文不乱码，缩进漂亮）
        json_str = json.dumps(albums_data, ensure_ascii=False, indent=2)

        # 2. 构造标准的 TypeScript 导出模板
        # 🛡️ 这种方式不依赖于绝对路径，只要相对位置不变，哪里都能跑
        ts_content = (
            "// 🛡️ 本文件由 XingHuiSama 控制台自动生成，请勿手动修改\n"
            "export interface Photo { url: string; caption?: string; }\n"
            "export interface Album { id: string; title: string; description: string; cover: string; date: string; photos: Photo[]; }\n\n"
            f"export const albums: Album[] = {json_str};"
        )

        # 3. 确保目录存在并执行覆盖写入
        os.makedirs(os.path.dirname(ALBUMS_TS_PATH), exist_ok=True)
        with open(ALBUMS_TS_PATH, "w", encoding="utf-8") as f:
            f.write(ts_content)

        return {
            "success": True,
            "message": f"📸 画廊物理文件已更新！已同步 {len(albums_data)} 个相册。"
        }
    except Exception as e:
        # 这里把具体的报错抛给前端方便排查
        return {"success": False, "message": f"同步失败: {str(e)}"}


@router.get("/debug_path")
async def debug_path():
    """用于检查当前后端锁定的物理路径"""
    return {
        "project_root": PROJECT_ROOT,
        "target_file": ALBUMS_TS_PATH,
        "exists": os.path.exists(ALBUMS_TS_PATH)
    }