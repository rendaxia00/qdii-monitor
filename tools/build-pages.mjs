#!/usr/bin/env node
/** 把动态 Node 应用导出为 GitHub Pages 可托管的静态站点。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
};

const snapshot = read(path.join(DATA, 'latest.json'));
if (!snapshot?.funds?.length) throw new Error('缺少 data/latest.json，请先执行 node src/cli.js collect');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUBLIC, DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');

// GitHub Pages 项目站点通常部署在 /<repo>/，静态资源必须使用相对路径。
const indexFile = path.join(DIST, 'index.html');
const index = fs
  .readFileSync(indexFile, 'utf8')
  .replace('href="/styles.css"', 'href="./styles.css"')
  .replace('src="/app.js"', 'src="./app.js"');
fs.writeFileSync(indexFile, index, 'utf8');

let changes = [];
try {
  changes = fs
    .readFileSync(path.join(DATA, 'changes.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .slice(-200)
    .reverse();
} catch {}

const historyDir = path.join(DATA, 'history');
const dates = fs.existsSync(historyDir)
  ? fs.readdirSync(historyDir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).map((x) => x.slice(0, -5)).sort()
  : [];
const historySnapshots = dates.map((date) => ({ date, snapshot: read(path.join(historyDir, `${date}.json`)) }));
const repositoryUrl = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : null;

write(path.join(DIST, 'data', 'snapshot.json'), {
  ok: true,
  static_mode: true,
  repository_url: repositoryUrl,
  snapshot,
  changes,
  dates: dates.slice().reverse(),
  collecting: false,
  last_collect: null,
});

for (const fund of snapshot.funds) {
  const code = String(fund.code);
  const points = [];
  let previous = null;
  for (const row of historySnapshots) {
    const f = row.snapshot?.funds?.find((x) => String(x.code) === code);
    if (!f) continue;
    const point = {
      date: row.snapshot.as_of || row.date,
      status: f.status || null,
      direct_status: f.direct_status || f.status || null,
      distribution_limit: f.limit_amount ?? null,
      direct_limit: f.direct_limit_amount ?? null,
      purchasable: f.purchasable ?? null,
    };
    const signature = JSON.stringify([
      point.status,
      point.direct_status,
      point.distribution_limit,
      point.direct_limit,
      point.purchasable,
    ]);
    if (signature !== previous) {
      points.push(point);
      previous = signature;
    }
  }
  if (points.length) points[points.length - 1].current = true;
  write(path.join(DIST, 'data', 'fund-history', `${code}.json`), {
    ok: true,
    history: {
      code,
      observed_from: dates[0] || null,
      observed_to: dates[dates.length - 1] || null,
      points: points.reverse(),
    },
  });

  const cached = read(path.join(DATA, 'profiles', `${code}.json`), {});
  const profile = {
    code,
    name: cached.name || fund.name,
    ...cached,
    // 阶段收益每天随主采集更新，优先于低频概况缓存。
    performance: fund.performance || cached.performance || null,
    scale_billion: fund.scale_billion ?? cached.scale_billion ?? null,
    scale_as_of: fund.scale_as_of || cached.scale_as_of || null,
  };
  write(path.join(DIST, 'data', 'profiles', `${code}.json`), { ok: true, profile });
}

console.log(`Pages 构建完成：${snapshot.funds.length} 只基金，${dates.length} 个历史快照 → ${DIST}`);
