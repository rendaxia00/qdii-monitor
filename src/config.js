import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 本地开发自动读取项目根目录 .env；系统环境变量和 GitHub Actions Secrets 优先。
const envFile = path.join(ROOT, '.env');
try {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
} catch {}

const DATA_DIR = process.env.QDII_DATA_DIR || path.join(ROOT, 'data');

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  dataDir: DATA_DIR,
  latestFile: path.join(DATA_DIR, 'latest.json'),
  stateFile: path.join(DATA_DIR, 'state.json'),
  catalogFile: process.env.QDII_CATALOG_FILE || path.join(ROOT, 'data', 'fund-catalog.json'),
  directStateFile: path.join(DATA_DIR, 'direct-state.json'),
  profileDir: path.join(DATA_DIR, 'profiles'),
  historyDir: path.join(DATA_DIR, 'history'),
  changesFile: path.join(DATA_DIR, 'changes.jsonl'),

  // 采集参数：东财对高频访问敏感，并发压到 5、每请求间留抖动
  concurrency: num(process.env.QDII_CONCURRENCY, 5),
  timeoutMs: num(process.env.QDII_TIMEOUT, 20000),
  retries: num(process.env.QDII_RETRIES, 3),
  jitterMs: num(process.env.QDII_JITTER, 150),
  profileCacheMs: num(process.env.QDII_PROFILE_CACHE_MS, 12 * 60 * 60 * 1000),
  announcementConcurrency: num(process.env.QDII_ANNOUNCEMENT_CONCURRENCY, 4),
  refreshAnnouncements: (process.env.QDII_REFRESH_ANNOUNCEMENTS || 'true') !== 'false',
  discoverFunds: (process.env.QDII_DISCOVER_FUNDS || 'true') !== 'false',

  userAgent:
    process.env.QDII_UA ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  sources: {
    // 代销渠道口径：单只基金页面（实测验通）
    eastmoneyFund: (code) => `https://fund.eastmoney.com/${code}.html`,
    eastmoneyReferer: 'https://fund.eastmoney.com/',
    // 直销渠道口径：东方财富销售公告列表 + 公告正文（基金范围由本地目录提供）
    eastmoneyAnnouncements: 'https://fund.eastmoney.com/gonggao/',
  },

  // 只监控这些方向；留空数组表示全部
  watchIndexes: (process.env.QDII_INDEXES || 'nasdaq100,sp500').split(',').map((s) => s.trim()).filter(Boolean),

  // 关注的额度变动阈值：低于此值的变动不通知（元）
  minNotifyDelta: num(process.env.QDII_MIN_DELTA, 0),

  notify: {
    channels: (process.env.QDII_NOTIFY || 'console').split(',').map((s) => s.trim()).filter(Boolean),
    startupTest: (process.env.QDII_NOTIFY_STARTUP_TEST || 'false') === 'true',
    webhookUrl: process.env.QDII_WEBHOOK_URL || '',
    webhookKind: process.env.QDII_WEBHOOK_KIND || 'generic', // generic|bark|serverchan|dingtalk|feishu|wecom
    webhookToken: process.env.QDII_WEBHOOK_TOKEN || '',
    ntfy: {
      server: process.env.QDII_NTFY_SERVER || 'https://ntfy.sh',
      topic: process.env.QDII_NTFY_TOPIC || '',
      token: process.env.QDII_NTFY_TOKEN || '',
      priority: num(process.env.QDII_NTFY_PRIORITY, 5),
      tags: process.env.QDII_NTFY_TAGS || 'chart_with_upwards_trend,moneybag',
      // 点击手机/桌面通知后打开的站点地址
      click: process.env.QDII_NTFY_CLICK || '',
    },
    email: {
      host: process.env.QDII_SMTP_HOST || '',
      port: num(process.env.QDII_SMTP_PORT, 465),
      secure: (process.env.QDII_SMTP_SECURE || 'true') === 'true',
      user: process.env.QDII_SMTP_USER || '',
      pass: process.env.QDII_SMTP_PASS || '',
      from: process.env.QDII_MAIL_FROM || '',
      to: (process.env.QDII_MAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
  },
};
