@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

:: 让解释器直接比较版本，避免 CMD 括号内变量提前展开和版本字符串误解析。
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto use_py
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if not errorlevel 1 goto use_python

echo [错误] 未找到 Python 3.10 或更高版本，请安装并添加到 PATH。
goto failed

:use_py
py -3 run_me.py
if errorlevel 1 goto failed
goto done

:use_python
python run_me.py
if errorlevel 1 goto failed
goto done

:failed
echo [错误] 启动失败，请查看上方错误信息。
pause
exit /b 1

:done
echo [状态] 启动准备完成。
exit /b 0
