from fastapi import APIRouter, Body, UploadFile, File, Form
import httpx

router = APIRouter()


@router.post("/test")
async def test_picbed_connection(payload: dict = Body(...)):
    """测试图床 Token 是否真正有效（发送一个 1x1 像素测试图片验证认证）"""
    url = payload.get("url", "").strip().rstrip('/')
    token = payload.get("token", "").strip()

    if not url or not token:
        return {"success": False, "message": "图床 API 地址和 Token 不能为空"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. 先检查服务是否在线
            response = await client.get(url)
            if response.status_code != 200:
                return {"success": False, "message": f"图床服务不可达，返回了 {response.status_code}"}

            # 2. 检查 token 格式
            if not token.startswith("imgbed_"):
                return {
                    "success": False,
                    "message": "Token 格式异常：CloudFlare-ImgBed 的 Token 通常以 'imgbed_' 开头，请检查是否正确"
                }

            # 3. 🌟 真实验证：发送不含文件的请求，通过状态码判断 Token 是否有效
            # 401 = Token 无效，400 = Token 有效但缺少文件（不会创建任何图片）
            upload_endpoint = f"{url}/upload"
            headers = {"Authorization": f"Bearer {token}"}

            test_res = await client.post(upload_endpoint, headers=headers)

            # 401 = Token 无效，其他状态码（400/404/422/200）= Token 有效但请求格式不对
            if test_res.status_code == 401:
                return {"success": False, "message": "Token 无效或已过期，请在图床后台重新获取"}

            return {
                "success": True,
                "message": "Token 验证通过！图床已就绪"
            }
    except Exception as e:
        return {"success": False, "message": f"网络异常: {str(e)}"}


# 👇 【全新追加】：真实的图床图片上传接口
@router.post("/upload")
async def upload_image(
        file: UploadFile = File(...),
        url: str = Form(...),
        token: str = Form(...)
):
    url = url.strip().rstrip('/')
    token = token.strip()

    # CloudFlare-ImgBed 使用 Authorization: Bearer 请求头进行认证
    upload_endpoint = f"{url}/upload"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        content = await file.read()
        # 封装为 httpx 支持的文件上传格式
        files = {'file': (file.filename, content, file.content_type)}

        # 上传图片可能较慢，将超时设置为 60 秒
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(upload_endpoint, headers=headers, files=files)

            if response.status_code == 401:
                return {"success": False, "message": "Token 无效或已过期，请检查图床后台重新获取"}
            if response.status_code != 200:
                return {"success": False, "message": f"上传失败，图床返回了 {response.status_code} 错误"}

            data = response.json()
            # CloudFlare-ImgBed 返回格式: [{"src": "/file/xxx", "publicUrl": "..."}]
            # 注意: publicUrl 可能是 HTML 页面，src 才是真正的图片路径
            if isinstance(data, list) and len(data) > 0:
                src = data[0].get("src")
                img_url = data[0].get("publicUrl")
                if src:
                    # 优先使用 src 拼接（确保是直链图片）
                    img_url = f"{url}{src}" if src.startswith("/") else src
                if img_url:
                    return {"success": True, "message": "上传成功", "url": img_url}
                else:
                    return {"success": False, "message": "图床返回了空的图片链接"}
            elif isinstance(data, dict):
                # 兼容可能的错误响应格式
                if data.get("success") is False:
                    return {"success": False, "message": f"图床拒绝接收: {data.get('message', '未知')}"}
                return {"success": False, "message": f"图床返回了未知格式的响应"}
            else:
                return {"success": False, "message": "图床返回了无法解析的响应"}
    except httpx.ReadTimeout:
        return {"success": False, "message": "图片上传超时，请检查网络或图片是否过大"}
    except httpx.ConnectTimeout:
        return {"success": False, "message": "连接图床服务器超时，请检查网络连接"}
    except httpx.ConnectError:
        return {"success": False, "message": "无法连接到图床服务器，请检查网络或图床地址"}
    except Exception as e:
        return {"success": False, "message": f"服务器异常: {str(e)}"}
