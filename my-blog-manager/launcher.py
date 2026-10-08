import sys
import os

# 🌟 路径定位逻辑
if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
    EXE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    EXE_DIR = BASE_DIR

import webview
import threading
import uvicorn
import time
import socket
import json
import subprocess
import traceback
from desktop_runtime import claim_instance, sync_assets
from cms_core.main import app
from cms_core.music_accounts import auto_daily_loop
from cms_core.workspace import CONFIG_ROOT
from music_runtime import start_gateway, stop_gateway

frontend_process = None
api_server = None
api_thread = None
music_process = None
music_stop = threading.Event()
WINDOW_CONFIG_FILE = os.path.join(EXE_DIR, 'window_config.json')

def load_window_size():
    try:
        if os.path.exists(WINDOW_CONFIG_FILE):
            with open(WINDOW_CONFIG_FILE, 'r') as f:
                return json.load(f)
    except:
        pass
    return {"width": 1440, "height": 900}

def save_window_size(width, height):
    try:
        with open(WINDOW_CONFIG_FILE, 'w') as f:
            json.dump({"width": int(width), "height": int(height)}, f)
    except:
        pass

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def write_port_config(port):
    # 写入解压目录供前端读取
    public_dir = os.path.join(BASE_DIR, 'public')
    os.makedirs(public_dir, exist_ok=True)
    with open(os.path.join(public_dir, 'backend_config.json'), 'w', encoding='utf-8') as f:
        json.dump({"api_port": port}, f)

    standalone_public = os.path.join(BASE_DIR, '.next', 'standalone', 'public')
    if os.path.exists(os.path.join(BASE_DIR, '.next', 'standalone')):
        os.makedirs(standalone_public, exist_ok=True)
        with open(os.path.join(standalone_public, 'backend_config.json'), 'w', encoding='utf-8') as f:
            json.dump({"api_port": port}, f)


def prepare_standalone_assets():
    standalone_dir = os.path.join(BASE_DIR, '.next', 'standalone')
    static_source = os.path.join(BASE_DIR, '.next', 'static')
    static_target = os.path.join(standalone_dir, '.next', 'static')
    public_source = os.path.join(BASE_DIR, 'public')
    public_target = os.path.join(standalone_dir, 'public')

    copied = sync_assets(static_source, static_target) + sync_assets(public_source, public_target)
    print(f"[启动] 更新 {copied} 个静态资源")

def wait_for_port(port, timeout=60):
    start_time = time.time()
    while time.time() - start_time < timeout:
        if frontend_process is not None and frontend_process.poll() is not None:
            return False
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return True
        except (ConnectionRefusedError, socket.timeout, OSError):
            time.sleep(1)
    return False

class WindowAPI:
    def resize_window(self, width, height):
        save_window_size(width, height)
        webview.windows[0].resize(int(width), int(height))
        return True
    def minimize_window(self): webview.windows[0].minimize()
    def maximize_window(self): webview.windows[0].toggle_fullscreen()
    def close_window(self): on_closed()

def run_api(port):
    global api_server
    # 🌟 强制后端在 EXE 所在的真实目录工作，确保能读取到旁边的 data/ 等数据
    os.chdir(EXE_DIR)
    print(f"🟢 [后端] 工作路径已锁定: {EXE_DIR}")
    try:
        api_server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info"))
        api_server.run()
    except Exception as e:
        print("❌ [后端] 崩溃报错：")
        traceback.print_exc()

def on_closed(exit_code=0):
    # 仅停止本次启动的服务，避免端口被重用后误杀其他应用。
    music_stop.set()
    stop_gateway(music_process)
    if api_server:
        api_server.should_exit = True
    if api_thread and api_thread.is_alive():
        api_thread.join(timeout=5)
    if frontend_process and frontend_process.poll() is None:
        if os.name == 'nt':
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(frontend_process.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            frontend_process.terminate()
        try:
            frontend_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            frontend_process.kill()
    os._exit(exit_code)

def on_shown():
    win_size = load_window_size()
    webview.windows[0].resize(int(win_size["width"]), int(win_size["height"]))

if __name__ == "__main__":
    if not claim_instance(EXE_DIR):
        print("[启动] 控制台已在运行，已唤回现有窗口")
        sys.exit(0)
    try:
        music_process = start_gateway(CONFIG_ROOT / 'music-gateway.json')
        threading.Thread(target=auto_daily_loop, args=(music_stop,), daemon=True).start()
    except ValueError as error:
        print(f'[音乐服务] {error}')
    frontend_port = get_free_port()
    backend_port = get_free_port()
    while backend_port == frontend_port:
        backend_port = get_free_port()

    env_vars = os.environ.copy()
    env_vars["PORT"] = str(frontend_port)

    standalone_dir = os.path.join(BASE_DIR, '.next', 'standalone')
    server_js = os.path.join(standalone_dir, 'server.js')

    # 🌟 核心自适应逻辑：判断是“打包运行”还是“开发运行”
    if os.path.exists(server_js):
        print("🚀 [生产模式] 使用 127.0.0.1 强制同步...")
        prepare_standalone_assets()
        env_vars["HOSTNAME"] = "127.0.0.1"
        env_vars["YUNYUE_MANAGER_ROOT"] = EXE_DIR
        frontend_process = subprocess.Popen(["node", "server.js"], cwd=standalone_dir, env=env_vars,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        window_url = f"http://127.0.0.1:{frontend_port}"
    else:
        print("🛠️ [开发模式] 使用 localhost 保持兼容...")
        frontend_process = subprocess.Popen("npm run dev", shell=True, cwd=BASE_DIR, env=env_vars,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        window_url = f"http://localhost:{frontend_port}"

    write_port_config(backend_port)
    api_thread = threading.Thread(target=run_api, args=(backend_port,), daemon=True)
    api_thread.start()

    if not wait_for_port(backend_port) or not wait_for_port(frontend_port):
        print(">>> ❌ 前后端启动失败！")
        on_closed(1)

    api = WindowAPI()
    window = webview.create_window(
        title='星辉云端·控制台',
        url=window_url,
        width=1440, height=900, min_size=(1024, 768),
        # 使用系统标题栏提供可靠的拖动、最小化、最大化和关闭操作。
        background_color='#0f172a', resizable=True, frameless=False, js_api=api
    )

    window.events.shown += on_shown
    window.events.closed += on_closed

    try:
        webview.start(debug=False)
    except KeyboardInterrupt:
        on_closed()
