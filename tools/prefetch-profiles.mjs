#!/usr/bin/env node
/** 为静态站点准备完整基金概况；缓存有效期由 QDII_PROFILE_CACHE_MS 控制。 */
import { config } from '../src/config.js';
import { getFundProfile } from '../src/fund-profile.js';
import { readJson } from '../src/store.js';

const snapshot = readJson(config.latestFile, null);
if (!snapshot?.funds?.length) throw new Error('缺少 data/latest.json，请先执行采集');

const codes = [...new Set(snapshot.funds.map((f) => String(f.code)))];
const concurrency = Math.max(1, Math.min(Number(process.env.QDII_PROFILE_CONCURRENCY || 4), 8));
let cursor = 0;
let ok = 0;
const errors = [];

async function worker() {
  while (cursor < codes.length) {
    const code = codes[cursor++];
    try {
      await getFundProfile(code);
      ok++;
    } catch (e) {
      errors.push({ code, error: e.message });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, worker));
console.log(`基金概况缓存：成功 ${ok}，失败 ${errors.length}`);
for (const e of errors.slice(0, 20)) console.error(`  ${e.code}: ${e.error}`);
if (errors.length > Math.max(10, codes.length * 0.2)) process.exitCode = 1;
