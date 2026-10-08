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


def configure_daily_task(enabled):
    """当前 Windows 用户登录时运行，不保存 Windows 密码或提升权限。"""
    if os.name != 'nt':
        return {'enabled': False, 'message': '当前系统仅支持窗口运行期间自动检查'}
    import hashlib
    import sys
    name = 'YunYueMusicDaily-' + hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]
    def quote(value):
        return "'" + str(value).replace("'", "''") + "'"
    if enabled:
        python = Path(sys.executable).with_name('pythonw.exe')
        if not python.exists():
            return {'enabled': False, 'message': '未找到 pythonw.exe，窗口运行期间仍会自动检查'}
        script = (
            "$ErrorActionPreference='Stop';"
            f"$action=New-ScheduledTaskAction -Execute {quote(python)} -Argument {quote(chr(34) + str(ROOT / 'music_daily_worker.py') + chr(34))} -WorkingDirectory {quote(ROOT)};"
            "$daily=New-ScheduledTaskTrigger -Daily -At '09:05';"
            "$logon=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name);"
            "$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5);"
            "$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited;"
            f"Register-ScheduledTask -TaskName {quote(name)} -Action $action -Trigger @($daily,$logon) -Settings $settings -Principal $principal -Force | Out-Null"
        )
    else:
        script = f"$ErrorActionPreference='Stop';if(Get-ScheduledTask -TaskName {quote(name)} -ErrorAction SilentlyContinue){{Unregister-ScheduledTask -TaskName {quote(name)} -Confirm:$false}}"
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                                capture_output=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise ValueError()
        if not enabled:
            configure_startup_worker(False, name)
        return {'enabled': enabled, 'message': '每天 09:05 及登录 Windows 时检查；电脑需开机且当前用户已登录' if enabled else '已关闭后台每日任务'}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return configure_startup_worker(enabled, name)


def configure_startup_worker(enabled, name):
    # 某些电脑拒绝注册计划任务，改用当前用户启动项，无需管理员权限。
    import sys
    import winreg
    python = Path(sys.executable).with_name('pythonw.exe')
    if enabled and not python.exists():
        return {'enabled': False, 'message': '未找到 pythonw.exe，窗口运行期间仍会自动检查'}
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as registry:
            if enabled:
                command = subprocess.list2cmdline([str(python), str(ROOT / 'music_daily_worker.py'), '--resident'])
                winreg.SetValueEx(registry, name, 0, winreg.REG_SZ, command)
                subprocess.Popen([str(python), str(ROOT / 'music_daily_worker.py'), '--resident'], cwd=ROOT,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                try:
                    winreg.DeleteValue(registry, name)
                except FileNotFoundError:
                    pass
        return {'enabled': enabled, 'mode': 'startup', 'message': '已启用当前用户后台每日检查；登录 Windows 后自动运行，关闭管理窗口仍有效' if enabled else '已关闭后台每日任务'}
    except OSError:
        return {'enabled': False, 'message': '系统拒绝设置后台任务；窗口运行期间仍会自动检查'}
