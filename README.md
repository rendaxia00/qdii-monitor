# QDII 申购限额监控台

监控场外 QDII 基金的**申购限额**与**申购状态**，每日扫描，额度变动时推送通知。带本地 Web UI。

解决的实际问题：外汇额度紧张时 QDII 基金大面积限购，隔夜就可能从"限购 1 万"变成"全线关门"。更麻烦的是**同一只基金在代销平台和基金公司直销渠道的额度可能差 10 倍**，而多数额度工具只反映代销口径。

## 数据源

双口径设计，这是本项目的核心：

| 口径 | 含义 | 来源 |
|---|---|---|
| 代销 | 天天基金/支付宝等第三方平台可申购额度 | 天天基金基金档案页，逐只实时抓取 |
| 直销 | 基金公司官网/APP 可申购额度 | 东方财富基金销售公告列表与公告正文，按原文区分渠道 |

基金范围与主题基线保存在本地 `data/fund-catalog.json`；程序会从天天基金目录发现12个既有主题的新份额，逐只检查销售类公告，并从公告正文提取 `代销 10元 / 直销 100元 / 10×` 这样的双口径信息。无法高置信解析的公告不会覆盖最近一次已核验值。

实测（2026-09-24）：162 只全部解析成功，检出 9 只渠道额度不一致，最大差距 10 倍（大成标普500等权重：代销 100 元 / 直销 1000 元）。

## 快速开始

```bash
cd qdii-monitor
node --version          # 需要 >= 18，无第三方依赖

# 1. 采集一次（建立基线，不会触发通知）
node src/cli.js collect

# 2. 查看摘要
node src/cli.js report

# 3. 启动 Web 监控台
node src/server.js      # http://127.0.0.1:8787
```

## 命令

```bash
node src/cli.js collect            # 采集 + 比对变动 + 按需通知
node src/cli.js collect --dry-run  # 只采集打印，不发通知、不写基线
node src/cli.js collect --force    # 采集并覆盖基线，跳过比对
node src/cli.js report             # 打印最近快照摘要
node src/server.js                 # Web UI + API
node src/scheduler.js              # 常驻调度（交易日 09:30 / 14:30）
node src/scheduler.js 09:35 14:55  # 自定义时刻
```

## 通知配置

全部通过环境变量，见 `.env.example`。可多通道并行。

```bash
# macOS / Linux
export QDII_NOTIFY=console,webhook
export QDII_WEBHOOK_KIND=bark        # bark|serverchan|dingtalk|feishu|wecom|generic
export QDII_WEBHOOK_TOKEN=你的token
node src/cli.js collect

# Windows
set QDII_NOTIFY=console,webhook
set QDII_WEBHOOK_KIND=bark
set QDII_WEBHOOK_TOKEN=你的token
node src\cli.js collect
```

邮件通道：

```bash
export QDII_NOTIFY=email
export QDII_SMTP_HOST=smtp.qq.com
export QDII_SMTP_PORT=465
export QDII_SMTP_USER=you@example.com
export QDII_SMTP_PASS=授权码
export QDII_MAIL_TO=you@example.com
```

ntfy 通道（官方 `ntfy.sh` 或自建服务均可）：

```bash
export QDII_NOTIFY=console,ntfy
export QDII_NTFY_SERVER=https://ntfy.sh
export QDII_NTFY_TOPIC=qdii-my-private-topic
export QDII_NTFY_TOKEN=                    # 私有主题需要时填写
export QDII_NTFY_PRIORITY=3                # 1-5
export QDII_NTFY_TAGS=chart_with_upwards_trend,moneybag
```

只关心纳指和标普方向：

```bash
export QDII_INDEXES=nasdaq100,sp500
```

## 定时执行

Windows 计划任务（每交易日 09:30、14:30 各一次）：

```powershell
schtasks /create /tn "QDII监控" /tr "D:\path\to\qdii-monitor\tools\collect.bat" /sc weekly /d MON,TUE,WED,THU,FRI /st 09:30
```

或直接用内置调度器常驻：`node src/scheduler.js`。

## GitHub Actions + GitHub Pages 部署

仓库内已包含 `.github/workflows/pages.yml`。工作流会在工作日北京时间 09:30、14:30 自动采集，发送已配置的通知，生成静态站点并部署到 GitHub Pages；也可在 Actions 页面手动运行。

首次部署：

```bash
git init -b main
git add .
git commit -m "Initial QDII monitor"
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

随后在 GitHub 仓库完成两项设置：

1. `Settings → Pages → Build and deployment → Source` 选择 **GitHub Actions**。
2. `Settings → Actions → General → Workflow permissions` 选择 **Read and write permissions**。

如需 ntfy，在 `Settings → Secrets and variables → Actions` 添加：

| Secret | 示例 |
|---|---|
| `QDII_NOTIFY` | `console,ntfy` |
| `QDII_NTFY_SERVER` | `https://ntfy.sh` |
| `QDII_NTFY_TOPIC` | 自己的私有主题名 |
| `QDII_NTFY_TOKEN` | 私有主题需要时填写 |

第一次在 Actions 页面手动运行时保留 `test_notification=true`，工作流会在采集和部署前先发送一条测试通知；后续定时任务只在检测到真实变化时发送通知。若本地 `.env` 设置 `QDII_NOTIFY_STARTUP_TEST=true`，本地 Web 服务每次启动后也会自动测试一次通知。

工作流会把 `data/` 的最新快照、历史和基金概况缓存提交回仓库，以便下一次任务继续做变动对比。Pages 版本为只读站点，“由 Actions 更新”按钮会打开仓库 Actions 页面；本地 Node 版本仍保留“立即采集”。

本地预览静态构建：

```bash
node tools/prefetch-profiles.mjs
node tools/build-pages.mjs
# 输出目录：dist/
```

## Web UI

`node src/server.js` 后访问 `http://127.0.0.1:8787`。

- 顶部并列展示：纳指100 + 标普500 方向的代销实际可投总额与直销公告口径总额；点击任一渠道可展开逐只基金及可购买金额
- 状态分布条形图 + 全市场 162 只明细表（搜索、按方向/状态筛选、多种排序）
- 点任意一行看详情：双口径额度对照、近1月/3月/6月/1年/3年/成立以来收益、成立日、基金规模、管理费率与托管费率
- 单只基金展示双渠道额度变化节点；历史从本站开始留存每日快照之日起持续积累
- 额度变动时间线，按严重级别分组（状态变更 / 额度调整）
- 右上角"立即采集"按钮可手动触发

API：`/api/snapshot`、`/api/changes`、`/api/dates`、`/api/day?date=`、`/api/fund-history?code=`、`/api/fund-profile?code=`、`/api/health`、`POST /api/collect`。

## 变动检测

只追踪 4 个真正影响"今天能不能买、能买多少"的字段：

| 字段 | 说明 | 级别 |
|---|---|---|
| `status` | 申购状态（开放/限大额/暂停） | high |
| `limit_amount` | 代销日累计限额 | medium |
| `direct_limit_amount` | 直销日累计限额 | medium |
| `redeem` | 赎回状态 | low |

低于 `QDII_MIN_DELTA` 的额度变动不通知。通知只在有变动时发出，无变动静默。

## 数据文件

```
data/
  latest.json        最近一次快照（Web UI 读它）
  state.json         运行状态
  changes.jsonl      变动流水，逐行 JSON，只增不改
  profiles/          按需缓存的阶段收益、规模与费率资料（12 小时）
  history/
    2026-09-24.json  每日快照归档，可用于回溯任意一天
```

## 校验

```bash
node tools/check-ui.mjs       # UI 静态一致性（DOM id 引用、类名、语法）
node tools/check-notify.mjs   # 通知通道（本地 mock 收包 + 各平台组装）
node tools/e2e.mjs            # 端到端：造变动 → diff 检出 → 通知发出
node tools/check-official-direct.mjs # 官方公告日期、渠道和额度解析
```

## 已知限制

- 源站声明"今日可申购总额度 725 元"无法用单一口径复现：按公告口径的代销合计为 1275 元，按天天基金实时口径为 695 元。差异源于两源的申购状态判定不一致（部分基金东财标"暂停申购"、公告表标"限大额"），且场内份额是否计入的口径不同。UI 因此同时展示名义额度与实际可购两个口径，不做强行对齐。
- 直销公告措辞并不统一。采集器只在高置信解析且公告已到生效日时更新；无法确定时沿用目录基线，并把失败记入 `collect_errors`。
- `data/fund-catalog.json` 是监控范围的本地基线。程序只自动接纳能明确归入既有12个主题的人民币份额；名称含糊的新指数需审核后补入，可用 `node tools/build-catalog.mjs` 从确认过的快照重建。
- 天天基金对高频访问敏感。默认并发 5、带 150ms 抖动、失败重试 3 次。请勿调高并发。
- 调度器按周一至周五判断交易日，未接入法定节假日表。
- 数据源自公开渠道，仅供个人参考，不构成投资建议。
