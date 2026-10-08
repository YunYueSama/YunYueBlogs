"""桌面运行所需的文件同步，避免每次启动重写全部静态资源。"""

import os
import shutil
from pathlib import Path

_instance_handle = None


def claim_instance(root: str) -> bool:
    """同一工作目录只运行一个桌面实例，重复启动时唤回已有窗口。"""
    global _instance_handle
    if os.name != "nt":
        return True
    import ctypes
    import hashlib
    key = hashlib.sha256(os.path.normcase(os.path.abspath(root)).encode("utf-8")).hexdigest()[:24]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel.CreateMutexW(None, False, f"Local\\YunYueCMS_{key}")
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(handle)
        user = ctypes.WinDLL("user32", use_last_error=True)
        user.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        user.FindWindowW.restype = ctypes.c_void_p
        user.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        user.SetForegroundWindow.argtypes = [ctypes.c_void_p]
        window = user.FindWindowW(None, "星辉云端·控制台")
        if window:
            user.ShowWindow(window, 9)
            user.SetForegroundWindow(window)
        return False
    _instance_handle = handle
    return True


def sync_assets(source: str, target: str) -> int:
    source_root, target_root = Path(source), Path(target)
    if not source_root.is_dir():
        return 0
    copied = 0
    for directory, _, names in os.walk(source_root):
        relative = Path(directory).relative_to(source_root)
        destination = target_root / relative
        destination.mkdir(parents=True, exist_ok=True)
        for name in names:
            src, dst = Path(directory) / name, destination / name
            source_stat = src.stat()
            target_stat = dst.stat() if dst.exists() else None
            if target_stat and source_stat.st_size == target_stat.st_size and source_stat.st_mtime_ns == target_stat.st_mtime_ns:
                continue
            shutil.copy2(src, dst)
            copied += 1
    return copied
