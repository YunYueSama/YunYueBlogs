"""仅从 Git 跟踪的源码构建独立 Windows 安装包；不复制当前设备的工作区。"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANAGER = ROOT / 'my-blog-manager'
ALLOWED = ('app/', 'components/', 'context/', 'lib/', 'cms_core/', 'services/music-gateway/',
           'public/appearance/', 'scripts/')
FILES = {'launcher.py', 'frontend_runtime.py', 'desktop_runtime.py', 'music_runtime.py',
         'package.json', 'package-lock.json', 'requirements.txt', 'next.config.ts',
         'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', 'siteConfig.ts'}

def command(args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)

def download(url, target, digest=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with urllib.request.urlopen(url, timeout=120) as source, target.open('wb') as out:
            shutil.copyfileobj(source, out)
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest and actual != digest:
        raise RuntimeError(f'下载文件校验失败：{target.name}')
    return actual

def export_source(destination):
    files = subprocess.check_output(['git', 'ls-files', '-z', 'my-blog-manager'], cwd=ROOT).decode().split('\0')
    for name in files:
        relative = name.removeprefix('my-blog-manager/')
        if not name or not (relative in FILES or relative.startswith(ALLOWED)):
            continue
        if ('node_modules' in Path(relative).parts or Path(relative).name in ('backend_config.json', 'about.md')
                or relative.endswith(('.pyc', '.log', '.env'))):
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    # 首次开发构建时新文件尚未暂存，显式包含实现文件，不扫描未跟踪的私人目录。
    for relative in ('cms_core/api/onboarding.py', 'app/setup/page.tsx', 'app/api/runtime/route.ts'):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(MANAGER / relative, target)
    about = destination / 'app/about/about.md'
    about.parent.mkdir(parents=True, exist_ok=True)
    about.write_text('关于我的博客\n', encoding='utf-8')
    # 历史配置只保留结构以编译旧组件，所有字符串与账号资料都替换成中性值。
    transformer = r'''const ts=require('typescript'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(process.argv[1],'utf8');
const context={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
function neutral(value){if(typeof value==='string')return '';if(Array.isArray(value))return value.map(neutral);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,neutral(v)]));return value;}
const config=neutral(context.exports.siteConfig);if(!config)throw new Error('配置结构无效');
fs.writeFileSync(process.argv[2],'export const siteConfig = '+JSON.stringify(config,null,2)+';\n');'''
    command(['node', '-e', transformer, str(MANAGER / 'siteConfig.ts'), str(destination / 'siteConfig.ts')], cwd=MANAGER)

def main():
    # 英文 Windows 的重定向输出可能默认 CP1252，中文构建进度须明确使用 UTF-8。
    if hasattr(os.sys.stdout, 'reconfigure'):
        os.sys.stdout.reconfigure(encoding='utf-8')
    args = argparse.ArgumentParser()
    args.add_argument('--version', default='1.0.0')
    args.add_argument('--iscc', default=os.environ.get('ISCC_PATH', r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'))
    options = args.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', options.version):
        args.error('版本号须为数字形式，例如 1.0.0')
    release = ROOT / '.release/windows'
    release.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='build-', dir=release))
    source = stage / 'source'
    source.mkdir()
    print('构建独立源码副本；不使用本机工作区与构建产物。', flush=True)
    export_source(source)
    command(['npm.cmd', 'ci', '--no-audit', '--no-fund'], cwd=source)
    env = {**os.environ, 'YUNYUE_BUILD_DIR': '.next', 'NEXT_TELEMETRY_DISABLED': '1'}
    for key in list(env):
        if any(word in key.upper() for word in ('TOKEN', 'SECRET', 'API_KEY', 'PASSWORD')):
            env.pop(key)
    command(['npm.cmd', 'run', 'build'], cwd=source, env=env)
    command(['npm.cmd', 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], cwd=source / 'services/music-gateway')
    standalone = source / '.next/standalone'
    shutil.copytree(source / '.next/static', standalone / '.next/static', dirs_exist_ok=True)
    shutil.copytree(source / 'public', standalone / 'public', dirs_exist_ok=True)
    runtime = stage / 'runtime'
    runtime.mkdir()
    lock_path = Path(__file__).with_name('windows-runtimes.json')
    manifest = json.loads(lock_path.read_text())
    cache = release / 'downloads'
    for key, info in manifest.items():
        archive = cache / info['file']
        download(info['url'], archive, info['sha256'])
        if key == 'git' and archive.suffix == '.zip':
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(runtime / 'git')
        elif key == 'git':
            command([str(archive), '-y', '-o' + str(runtime / 'git')])
        elif key in ('node', 'gh'):
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(runtime / key)
            extracted = next((runtime / key).iterdir())
            for file in extracted.iterdir():
                shutil.move(str(file), runtime / key / file.name)
            extracted.rmdir()
        else:
            shutil.copy2(archive, runtime / info['file'])
    # Git 命令只通过 PATH 调用此包内的二进制；不要求新电脑预装开发环境。
    command([os.sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--windowed', '--onedir',
             '--name', 'YunYueManager', '--distpath', str(stage / 'dist'), '--workpath', str(stage / 'pyinstaller'),
             '--specpath', str(stage), '--paths', str(source), '--collect-all', 'webview',
             '--collect-all', 'pythonnet', '--collect-submodules', 'uvicorn',
             '--add-data', f'{standalone};.next/standalone', '--add-data', f'{runtime};runtime',
             '--add-data', f'{source / "services/music-gateway"};services/music-gateway',
             str(source / 'launcher.py')], cwd=stage)
    packaged = stage / 'dist/YunYueManager'
    copy_python_licenses(packaged)
    for example in packaged.rglob('.env.example'):
        # 上游 SDK 的示例配置不参与运行，发布包也不需要携带它们。
        example.unlink()
    audit_package(packaged)
    command([os.sys.executable, str(Path(__file__).with_name('smoke-windows.py')),
             '--exe', str(packaged / 'YunYueManager.exe')])
    (packaged / 'THIRD-PARTY-NOTICES.txt').write_text(
        '包含 Python/pywebview、Node.js、Git for Windows、GitHub CLI 与 Next.js。\n'
        'Python 及其依赖许可证见 licenses/python；其他运行时许可证见 _internal/runtime 与对应软件发行目录。\n'
        'Next.js 与网关依赖许可证保留在各 node_modules 软件目录；博客主题与素材沿用原项目署名。\n', encoding='utf-8')
    output = release / 'artifacts'
    output.mkdir(exist_ok=True)
    command([options.iscc, '/Q', f'/DAppVersion={options.version}', f'/DPackageDir={packaged}', f'/DOutputDir={output}',
             str(Path(__file__).with_name('windows-installer.iss'))])
    artifact = output / f'YunYueManager-{options.version}-Setup.exe'
    (output / 'SHA256SUMS.txt').write_text(hashlib.sha256(artifact.read_bytes()).hexdigest() + '  ' + artifact.name + '\n')
    print(f'安装包已生成：{artifact}', flush=True)

def audit_package(root):
    forbidden = {'workspace', '.git', '.vercel', 'logs'}
    for file in root.rglob('*'):
        relative = file.relative_to(root)
        if any(part in forbidden for part in relative.parts) or file.name in ('backend_config.json', 'deploy_config.json', 'window_config.json'):
            raise RuntimeError(f'发布包包含本机数据：{relative}')
        if file.name.startswith('.env'):
            raise RuntimeError(f'发布包包含环境文件：{relative}')

def copy_python_licenses(packaged):
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name
    licenses = packaged / 'licenses/python'
    licenses.mkdir(parents=True, exist_ok=True)
    python_license = Path(os.sys.base_prefix) / 'LICENSE.txt'
    if not python_license.exists():
        raise RuntimeError('Python 运行时许可证缺失')
    shutil.copy2(python_license, licenses / 'Python-LICENSE.txt')
    pending = [Requirement(line) for line in (MANAGER / 'requirements.txt').read_text().splitlines() if line.strip()]
    seen = set()
    notices = []
    while pending:
        requested = pending.pop()
        name = requested.name
        identity = (canonicalize_name(name), tuple(sorted(requested.extras)))
        if identity in seen:
            continue
        seen.add(identity)
        distribution = importlib.metadata.distribution(name)
        notices.append(f'{distribution.metadata["Name"]} {distribution.version}')
        for file in distribution.files or []:
            if any(word in str(file).lower() for word in ('license', 'copying', 'notice')) and '.dist-info' in str(file):
                target = licenses / name / Path(str(file)).name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(distribution.locate_file(file), target)
        for dependency in distribution.requires or []:
            requirement = Requirement(dependency)
            if requirement.marker is None or any(requirement.marker.evaluate({'extra': extra}) for extra in requested.extras or {''}):
                pending.append(requirement)
    (licenses / 'PACKAGES.txt').write_text('\n'.join(sorted(set(notices))) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
