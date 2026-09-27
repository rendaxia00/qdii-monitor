# QDII Cloudflare 定时触发器

这个 Worker 只负责准时触发 GitHub Actions，采集、长图生成、历史保存和
ntfy 推送仍由 `pages.yml` 完成。

## 时间

- 每天北京时间 09:37：采集、部署并发送每日额度长图。
- 工作日北京时间 14:37：再次采集、部署，额度变化时发送通知。

Cron Trigger 使用 UTC。为适配 Cloudflare 免费账户的触发器数量限制，两个时间
合并成一条 `37 1,6 * * *`；Worker 会自动跳过周末 06:37 UTC 的下午任务。

## Secrets

- `GITHUB_TOKEN`：仅授权本仓库 Actions 读写权限的 fine-grained PAT。
- `TRIGGER_SECRET`：保护手动 `/trigger` 接口的随机密钥。
- `NTFY_URL`：可选；触发 GitHub 失败时发送最高优先级告警的完整主题 URL。

## 部署

```powershell
npm install
npx wrangler login
gh auth token | npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TRIGGER_SECRET
npx wrangler secret put NTFY_URL
npx wrangler deploy
```

生产环境应优先使用仅限 `rendaxia00/qdii-monitor` 且只有 Actions 读写权限的
fine-grained PAT，不建议长期复用 GitHub CLI 的宽权限令牌。
