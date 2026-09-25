import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { readJson } from './store.js';
import { runCollect } from './pipeline.js';
import { getFundProfile } from './fund-profile.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 采集互斥：避免并发触发把上游打爆
let collecting = null;
let lastCollect = null;

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const json = (res, obj, code = 200) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

function readChanges(limit = 200) {
  try {
    const raw = fs.readFileSync(config.changesFile, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

function listHistory() {
  try {
    return fs
      .readdirSync(config.historyDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 按日期取历史快照，并算出与前一日的变动（用于回溯某天的变化） */
function snapshotByDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return readJson(path.join(config.historyDir, `${date}.json`), null);
}

/** 某只基金的双渠道额度变化节点；只保留状态或额度发生变化的日期。 */
function fundHistory(code) {
  const dates = listHistory().slice().reverse();
  const points = [];
  let lastSignature = null;
  for (const date of dates) {
    const snap = snapshotByDate(date);
    const f = snap?.funds?.find((x) => String(x.code) === code);
    if (!f) continue;
    const point = {
      date: snap.as_of || date,
      status: f.status || null,
      // 旧快照尚未拆分 direct_status 时，以当时的统一状态作为兼容回退。
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
    if (signature !== lastSignature) {
      points.push(point);
      lastSignature = signature;
    }
  }
  if (points.length) points[points.length - 1].current = true;
  return {
    code,
    observed_from: dates.length ? dates[0] : null,
    observed_to: dates.length ? dates[dates.length - 1] : null,
    points: points.reverse(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    /* ---------------- API ---------------- */

    if (p === '/api/snapshot') {
      const snap = readJson(config.latestFile, null);
      if (!snap) return json(res, { ok: false, error: '尚无数据，请先执行一次采集' }, 404);
      return json(res, {
        ok: true,
        snapshot: snap,
        changes: readChanges(80),
        dates: listHistory(),
        collecting: Boolean(collecting),
        last_collect: lastCollect,
      });
    }

    if (p === '/api/changes') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 200), 2000);
      return json(res, { ok: true, changes: readChanges(limit) });
    }

    if (p === '/api/dates') {
      return json(res, { ok: true, dates: listHistory() });
    }

    if (p === '/api/day') {
      const date = url.searchParams.get('date') || '';
      const snap = snapshotByDate(date);
      if (!snap) return json(res, { ok: false, error: `无 ${date} 的快照` }, 404);
      return json(res, { ok: true, snapshot: snap });
    }

    if (p === '/api/fund-history') {
      const code = url.searchParams.get('code') || '';
      if (!/^\d{6}$/.test(code)) return json(res, { ok: false, error: '基金代码格式错误' }, 400);
      return json(res, { ok: true, history: fundHistory(code) });
    }

    if (p === '/api/fund-profile') {
      const code = url.searchParams.get('code') || '';
      if (!/^\d{6}$/.test(code)) return json(res, { ok: false, error: '基金代码格式错误' }, 400);
      const snap = readJson(config.latestFile, null);
      if (!snap?.funds?.some((f) => String(f.code) === code))
        return json(res, { ok: false, error: '该基金不在当前监控范围内' }, 404);
      const profile = await getFundProfile(code, { force: url.searchParams.get('force') === '1' });
      return json(res, { ok: true, profile });
    }

    if (p === '/api/collect' && req.method === 'POST') {
      if (collecting) return json(res, { ok: true, running: true, message: '已有采集任务在执行' }, 202);
      collecting = (async () => {
        try {
          const r = await runCollect({ force: url.searchParams.get('force') === '1' });
          lastCollect = { at: new Date().toISOString(), changes: r.diff.changes.length, total: r.snapshot.stats.total };
          return { ok: true, changes: r.diff.changes.length, total: r.snapshot.stats.total };
        } catch (e) {
          lastCollect = { at: new Date().toISOString(), error: e.message };
          throw e;
        } finally {
          collecting = null;
        }
      })();
      try {
        const out = await collecting;
        return json(res, { ok: true, ...out });
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 500);
      }
    }

    if (p === '/api/health') {
      const snap = readJson(config.latestFile, null);
      return json(res, {
        ok: true,
        has_data: Boolean(snap),
        as_of: snap?.as_of || null,
        generated_at: snap?.generated_at || null,
        collecting: Boolean(collecting),
      });
    }

    /* ---------------- 静态资源 ---------------- */

    let rel = p === '/' ? '/index.html' : p;
    const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      return send(res, 200, fs.readFileSync(filePath), MIME[ext] || 'application/octet-stream');
    }

    // SPA 回退
    return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')), MIME['.html']);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`QDII 额度监控台已启动: http://127.0.0.1:${PORT}`);
  console.log(`数据目录: ${config.dataDir}`);
});
