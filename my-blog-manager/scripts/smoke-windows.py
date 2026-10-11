"""以独立用户目录和仅含系统目录的 PATH 验证安装版，不弹窗或借用开发环境。"""
import argparse
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exe', required=True)
    args = parser.parse_args()
    exe = Path(args.exe).resolve()
    with tempfile.TemporaryDirectory(prefix='yunyue-install-check-') as directory:
        profile = Path(directory)
        env = dict(os.environ)
        env.update(LOCALAPPDATA=str(profile), GH_CONFIG_DIR=str(profile / 'github'),
                   PATH=str(Path(os.environ['SystemRoot']) / 'System32'))
        for key in list(env):
            if any(part in key.upper() for part in ('TOKEN', 'API_KEY', 'SECRET', 'PASSWORD')):
                env.pop(key)
        process = subprocess.Popen([str(exe), '--smoke-test'], env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            runtime_file = profile / 'YunYueManager/workspace/config/desktop-runtime.json'
            deadline = time.monotonic() + 90
            while not runtime_file.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    log = profile / 'YunYueManager/workspace/logs/desktop.log'
                    raise RuntimeError('安装版启动失败：' + (log.read_text(encoding='utf-8')[-4000:] if log.exists() else '未生成日志'))
                time.sleep(.5)
            ports = json.loads(runtime_file.read_text())
            front = f'http://127.0.0.1:{ports["frontendPort"]}'
            back = f'http://127.0.0.1:{ports["backendPort"]}'
            def get(url):
                with urllib.request.urlopen(url, timeout=20) as response:
                    return response.read().decode('utf-8')
            assert '让你的博客在这里安家' in get(front + '/setup')
            assert json.loads(get(front + '/api/runtime'))['api_port'] == ports['backendPort']
            assert json.loads(get(back + '/api/status'))['data']['counts'] == {'posts': 0, 'chatters': 0, 'moments': 0}
            status = json.loads(get(back + '/api/onboarding/status'))['data']
            assert not status['completed'] and status['account'] is None
            print(json.dumps({'frontend': front, 'backend': back, 'emptyWorkspace': True, 'isolatedAccount': True}))
        finally:
            process.terminate()
            process.wait(timeout=10)
            # Windows Job 终止子进程后，文件句柄可能需要短暂释放。
            time.sleep(2)

if __name__ == '__main__':
    main()
