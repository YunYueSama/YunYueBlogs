"""桌面和计划任务共用的本机网关生命周期。"""
import json
import os
import secrets
import shutil
import socket
import subprocess
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent


def start_gateway(config_path):
    node = shutil.which('node')
    if not node:
        raise ValueError('未找到 Node.js，请先通过 Start.bat 安装音乐服务依赖')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    key = secrets.token_urlsafe(32)
    env = {**os.environ, 'PORT': str(port), 'MUSIC_GATEWAY_TOKEN': key}
    process = subprocess.Popen([node, 'server.cjs'], cwd=ROOT / 'services/music-gateway', env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    for _ in range(60):
        if process.poll() is not None:
            break
        try:
            response = httpx.get(f'http://127.0.0.1:{port}/health', headers={'Authorization': f'Bearer {key}'}, timeout=1)
            if response.status_code == 200:
                Path(config_path).parent.mkdir(parents=True, exist_ok=True)
                Path(config_path).write_text(json.dumps({'port': port, 'key': key}), encoding='utf-8')
                return process
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    process.terminate()
    process.wait(timeout=5)
    raise ValueError('本机音乐服务启动失败，请重新运行 Start.bat 检查依赖')


def stop_gateway(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


_legacy_disabled = False


def configure_daily_task(enabled):
    """自动领取仅在管理窗口运行时检查，同时移除旧版本的常驻任务。"""
    global _legacy_disabled
    if os.name == 'nt' and not _legacy_disabled:
        import hashlib
        import winreg
        name = 'YunYueMusicDaily-' + hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
        quoted = "'" + name.replace("'", "''") + "'"
        script = (
            "$ErrorActionPreference='Stop';"
            f"if(Get-ScheduledTask -TaskName {quoted} -ErrorAction SilentlyContinue){{"
            f"Stop-ScheduledTask -TaskName {quoted} -ErrorAction SilentlyContinue;"
            f"Unregister-ScheduledTask -TaskName {quoted} -Confirm:$false}}"
        )
        try:
            result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                                    capture_output=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as registry:
                try:
                    winreg.DeleteValue(registry, name)
                except FileNotFoundError:
                    pass
            _legacy_disabled = result.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
    return {'enabled': enabled, 'mode': 'desktop', 'message': '管理窗口运行期间自动检查；关闭窗口后停止'}
