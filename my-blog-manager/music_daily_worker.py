"""关闭桌面窗口后由 Windows 计划任务执行；独立网关不覆盖桌面端配置。"""
import os
import tempfile
import sys
import time
from pathlib import Path

from cms_core.music_accounts import claim_daily, state
from music_runtime import start_gateway, stop_gateway


def main():
    resident = '--resident' in sys.argv
    if resident and os.name == 'nt':
        import ctypes
        import hashlib
        from music_runtime import ROOT
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateMutexW.restype = ctypes.c_void_p
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        handle = kernel.CreateMutexW(None, False, 'Local\\YunYueMusicWorker-' + hashlib.sha256(str(ROOT).encode()).hexdigest()[:12])
        if not handle or ctypes.get_last_error() == 183:
            return
    account = state().get('kugou', {})
    if not account.get('cookie') or not account.get('autoDailyVip'):
        return
    process = None
    with tempfile.TemporaryDirectory(prefix='yunyue-music-') as directory:
        config = Path(directory) / 'gateway.json'
        os.environ['MUSIC_GATEWAY_CONFIG'] = str(config)
        try:
            while True:
                account = state().get('kugou', {})
                if not account.get('cookie') or not account.get('autoDailyVip'):
                    break
                try:
                    if process is None or process.poll() is not None:
                        process = start_gateway(config)
                    claim_daily()
                except (ValueError, OSError):
                    pass
                if not resident:
                    break
                time.sleep(300)
        finally:
            stop_gateway(process)


if __name__ == '__main__':
    main()
