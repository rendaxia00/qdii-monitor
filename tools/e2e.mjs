#!/usr/bin/env node
/**
 * 端到端演练：
 *  1) 用当前 latest.json 造一份“前一日基线”，人为改动几只基金的额度/状态
 *  2) 调 diffSnapshots 验证能精确检出
 *  3) 调 notify 验证通知通道真的能发出
 * 不改动真实数据文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSnapshots, summarize, fmtAmount } from '../src/diff.js';
import { notify } from '../src/notify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const latest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/latest.json'), 'utf8'));

console.log('=== 基线 ===');
console.log(`${latest.stats.total} 只 · as_of ${latest.as_of}`);

// 造基线：把当前值当作“昨日”
const baseline = JSON.parse(JSON.stringify(latest));

// 造今日：模拟真实场景里的三类变动
const today = JSON.parse(JSON.stringify(latest));
const picks = [];

// 1) 限额上调（放开一点额度）
const up = today.funds.find((f) => f.status === '限大额' && f.limit_amount === 10);
if (up) {
  up.limit_amount = 100;
  if (typeof up.direct_limit_amount === 'number') up.direct_limit_amount = 1000;
  picks.push(['额度上调', up.code, up.name]);
}

// 2) 暂停 → 限大额（恢复申购，最高优先级）
const reopen = today.funds.find((f) => f.status === '暂停申购' && f.limit_amount === 10);
if (reopen) {
  reopen.status = '限大额';
  picks.push(['恢复申购', reopen.code, reopen.name]);
}

// 3) 限大额 → 暂停（关门）
const shut = today.funds.find((f) => f.status === '限大额' && f.limit_amount === 5);
if (shut) {
  shut.status = '暂停申购';
  picks.push(['暂停申购', shut.code, shut.name]);
}

// 4) 赎回状态变化
const redeem = today.funds.find((f) => f.redeem === '开放赎回');
if (redeem) {
  redeem.redeem = '暂停赎回';
  picks.push(['赎回变化', redeem.code, redeem.name]);
}

console.log('\n=== 人为制造 4 类变动 ===');
picks.forEach(([kind, code, name]) => console.log(`  ${kind.padEnd(6)} ${code} ${name}`));

console.log('\n=== diff 检测结果 ===');
const diff = diffSnapshots(baseline, today, { minNotifyDelta: 0 });
console.log(`检出 ${diff.changes.length} 处变动（期望 4）`);
let pass = diff.changes.length === 4;
for (const c of diff.changes) {
  console.log(`  [${c.severity}] ${c.code} ${c.name}`);
  for (const fd of c.fields) {
    console.log(`      ${fd.label}: ${fd.old_text} → ${fd.new_text}${fd.direction ? ' (' + fd.direction + ')' : ''}`);
  }
}

// 验证严重级别判定
const sevSet = new Set(diff.changes.map((c) => c.severity));
console.log(`\n严重级别集合: ${[...sevSet].join(', ')}`);
if (!sevSet.has('high')) { console.log('  FAIL 应至少有一处 high（状态变更）'); pass = false; }
if (!sevSet.has('medium')) { console.log('  FAIL 应至少有一处 medium（额度调整）'); pass = false; }

console.log('\n=== 通知内容预览 ===');
const title = `QDII 额度变动 ${diff.changes.length} 处 · ${today.as_of}`;
const content = summarize(diff, { asOf: today.as_of, stats: today.stats });
console.log(title);
console.log(content);

console.log('\n=== 通知通道实测 ===');
const results = await notify({ channels: ['console'] }, title, content);
console.log('通道返回:', JSON.stringify(results));
if (!results.every((r) => r.ok)) { console.log('FAIL 通道异常'); pass = false; }

console.log(`\n=== 结果: ${pass ? '全部通过' : '存在问题'} ===`);
process.exitCode = pass ? 0 : 1;
