@echo off
REM ============================================================
REM  QDII 额度监控 · 每交易日采集并按需推送变动
REM  用途：注册到计划任务，交易日 09:30 与 14:30 各跑一次
REM ============================================================
cd /d "%~dp0.."

REM ---- 通知配置（按需取消注释并填写）----
set QDII_NOTIFY=console
REM set QDII_NOTIFY=console,webhook
REM set QDII_WEBHOOK_KIND=bark
REM set QDII_WEBHOOK_TOKEN=你的token
REM set QDII_NOTIFY=console,email
REM set QDII_SMTP_HOST=smtp.qq.com
REM set QDII_SMTP_PORT=465
REM set QDII_SMTP_USER=you@example.com
REM set QDII_SMTP_PASS=授权码
REM set QDII_MAIL_TO=you@example.com

set QDII_INDEXES=nasdaq100,sp500
set QDII_CONCURRENCY=5

node src\cli.js collect >> logs\collect.log 2>&1
