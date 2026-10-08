import os
import sys
import subprocess
import importlib.util

# 1. 后端 Python 依赖清单
PYTHON_PACKAGES = {
    "webview": "pywebview",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "multipart": "python-multipart",
    "requests": "requests",
    "yaml": "PyYAML",
    "markdown": "markdown",
    "markdownify": "markdownify",
    "httpx": "httpx",
}


def check_node_environment():
    """检查前端环境：是否存在 node_modules，不存在则自动安装"""
    print("🔍 正在检查前端依赖 (Node.js)...")

    # 检查当前目录下是否有 node_modules 文件夹
    if not os.path.exists("node_modules"):
        print("📦 发现缺失前端依赖，正在尝试运行 npm install (请稍候，这可能需要几分钟)...")
        try:
            # shell=True 在 Windows 下运行 npm 必须加上
            subprocess.check_call(["npm", "install"], shell=True)
            print("✅ 前端依赖安装成功！")
        except Exception as e:
            print(f"❌ 前端安装失败！请确保你安装了 Node.js。错误: {e}")
            return False
    else:
        print("✅ 前端依赖已就绪。")
    return True


def ensure_frontend_build():
    """Builds the standalone frontend when it is missing or older than source files."""
    server_js = os.path.join(".next", "standalone", "server.js")
    source_roots = ("app", "components", "context", "lib")
    watched_files = ("package.json", "package-lock.json", "next.config.ts", "tsconfig.json")

    source_files = [path for path in watched_files if os.path.exists(path)]
    for root in source_roots:
        if not os.path.isdir(root):
            continue
        for current, _, files in os.walk(root):
            source_files.extend(os.path.join(current, name) for name in files)

    build_time = os.path.getmtime(server_js) if os.path.exists(server_js) else 0
    source_time = max((os.path.getmtime(path) for path in source_files), default=0)

    if build_time >= source_time:
        print("✅ 前端生产构建已是最新版本。")
        return True

    print("🏗️ 前端构建缺失或已过期，正在生成稳定的桌面版产物...")
    try:
        subprocess.check_call(["npm", "run", "build"], shell=True)
        print("✅ 前端生产构建完成。")
        return True
    except Exception as error:
        print(f"❌ 前端生产构建失败: {error}")
        return False


def check_python_environment():
    """检查后端 Python 环境"""
    print("🔍 正在检查后端依赖 (Python)...")
    python_exe = sys.executable
    for import_name, install_name in PYTHON_PACKAGES.items():
        if importlib.util.find_spec(import_name) is None:
            print(f"📦 正在自动安装 Python 库: {install_name}...")
            subprocess.check_call([python_exe, "-m", "pip", "install", install_name])
    print("✅ 后端依赖已就绪。")
    return True


if __name__ == "__main__":
    # 强制切换到脚本所在目录
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("🌟 --- 星辉云端控制台 · 自动部署系统 --- 🌟")

    # 先查前端，再查后端
    if check_node_environment() and check_python_environment() and ensure_frontend_build():
        print("\n🚀 所有环境准备就绪，正在点火启动...")
        # 启动 launcher.py
        # 后台输出保存在本地，桌面运行不再弹出控制台。
        log_dir = os.path.join("workspace", "logs")
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, "desktop.log"), "a", encoding="utf-8") as log_file:
            subprocess.Popen([sys.executable, "-u", "launcher.py"],
                             stdout=log_file, stderr=subprocess.STDOUT,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    else:
        print("\n⚠️ 环境检查未通过，请根据报错信息手动处理。")
        sys.exit(1)
