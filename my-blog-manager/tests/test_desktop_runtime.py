import os
import subprocess
import sys
import time
import pytest

from desktop_runtime import sync_assets


def test_assets_only_copy_new_or_changed_files(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    (source / "nested").mkdir(parents=True)
    original = source / "nested" / "asset.txt"
    original.write_text("first", encoding="utf-8")
    assert sync_assets(str(source), str(target)) == 1
    assert sync_assets(str(source), str(target)) == 0
    previous = original.stat()
    original.write_text("other", encoding="utf-8")
    os.utime(original, ns=(previous.st_atime_ns, previous.st_mtime_ns + 1_000_000_000))
    assert sync_assets(str(source), str(target)) == 1
    assert (target / "nested" / "asset.txt").read_text(encoding="utf-8") == "other"


def test_missing_asset_source_does_not_delete_target(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    existing = target / "keep.txt"
    existing.write_text("keep", encoding="utf-8")
    assert sync_assets(str(tmp_path / "missing"), str(target)) == 0
    assert existing.read_text(encoding="utf-8") == "keep"


@pytest.mark.skipif(os.name != 'nt', reason='Windows Job 生命周期验证')
def test_desktop_exit_terminates_child_process(tmp_path):
    import ctypes
    from ctypes import wintypes
    pid_file = tmp_path / 'child.pid'
    script = (
        'import os, subprocess, sys; from desktop_runtime import contain_process_tree; '
        'contain_process_tree(); '
        'p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); '
        f'open({str(pid_file)!r},"w").write(str(p.pid)); '
        'os._exit(0)'
    )
    subprocess.run([sys.executable, '-c', script], check=True, timeout=10)
    pid = int(pid_file.read_text())
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    for _ in range(50):
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return
        code = wintypes.DWORD()
        kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        if code.value != 259:
            return
        time.sleep(.1)
    subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], capture_output=True)
    pytest.fail('桌面进程退出后子进程仍在运行')
