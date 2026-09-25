@echo off
REM ============================================================
REM  QDII 额度监控台 · 一键启动 Web UI
REM  双击运行，然后在浏览器打开 http://127.0.0.1:8787
REM ============================================================
cd /d "%~dp0.."

echo.
echo   QDII 申购限额监控台
echo   ----------------------------------------
echo   启动中… 浏览器访问 http://127.0.0.1:8787
echo   按 Ctrl+C 停止
echo.

REM 若还没有数据，先采集一次
if not exist "data\latest.json" (
  echo   未检测到数据，先执行首次采集…
  node src\cli.js collect
  echo.
)

node src\server.js
pause
