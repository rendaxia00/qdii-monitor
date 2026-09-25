#!/usr/bin/env node
/**
 * 从现有快照生成不依赖上游聚合站的基金目录。
 *
 * 目录只保存相对稳定的基金元数据，以及迁移时的直销口径基线。
 * 后续公告增量保存在 data/direct-state.json，不会反向污染目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] || path.join(ROOT, 'data', 'latest.json');
const target = process.argv[3] || path.join(ROOT, 'data', 'fund-catalog.json');

const snapshot = JSON.parse(fs.readFileSync(source, 'utf8'));
const catalog = {
  version: 1,
  generated_at: new Date().toISOString(),
  baseline_as_of: snapshot.as_of,
  source_snapshot: path.basename(source),
  funds: (snapshot.funds || []).map((f) => ({
    code: f.code,
    name: f.name,
    topic: f.topic,
    index_key: f.index_key,
    on_exchange: Boolean(f.on_exchange),
    status: f.status,
    distribution_limit_amount: f.limit_amount ?? null,
    direct_limit_amount: f.direct_limit_amount ?? null,
    channel_split: Boolean(f.channel_split),
    channel_ratio: f.channel_ratio ?? null,
    channel_note: f.channel_note && f.channel_note !== '—' ? f.channel_note : null,
    announcement_url: f.announcement_url ?? null,
    announcement_date: f.announcement_date ?? null,
    verified_by_announcement: Boolean(f.verified_by_announcement),
  })),
};

fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n');
console.log(`已写入 ${target}`);
console.log(`基线 ${catalog.baseline_as_of}，${catalog.funds.length} 只基金份额`);
