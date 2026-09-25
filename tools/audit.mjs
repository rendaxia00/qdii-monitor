import fs from 'node:fs';
import { readJson } from '../src/store.js';
import { diffSnapshots, summarize } from '../src/diff.js';

const latest = readJson('./data/latest.json');
console.log('=== 数据质量校验 ===');
console.log('总数:', latest.funds.length);
console.log('官方声明: tracked=' + latest.declared.tracked + ' buyable=' + latest.declared.buyable + ' totalDaily=' + latest.declared.total_daily_limit);

const s = latest.stats;
console.log('\n状态分布(本系统): 开放=' + s.open + ' 限大额=' + s.limited + ' 暂停=' + s.suspended + ' 其他/场内=' + s.closed);
console.log('分方向:', JSON.stringify(s.by_index));

// 官方: 开放32 限额56 暂停32 场内42
console.log('\n对照官方口径: 开放 32 / 限额 56 / 暂停 32 / 场内 42');
console.log('差异原因: 东财实时页与公告表存在天然滞后差, 且场内份额被归入"其他"');

// 双口径覆盖
const hasDist = latest.funds.filter(f => typeof f.limit_amount === 'number').length;
const hasDirect = latest.funds.filter(f => typeof f.direct_limit_amount === 'number').length;
const bothDiff = latest.funds.filter(f => typeof f.limit_amount === 'number' && typeof f.direct_limit_amount === 'number' && f.limit_amount !== f.direct_limit_amount);
console.log('\n代销额度有值:', hasDist, '| 直销额度有值:', hasDirect);
console.log('代销≠直销 的基金数:', bothDiff.length);
console.log('\n代销/直销 差距最大的 10 只:');
bothDiff.sort((a,b) => (b.direct_limit_amount/Math.max(b.limit_amount,1)) - (a.direct_limit_amount/Math.max(a.limit_amount,1)))
  .slice(0,10).forEach(f => console.log(`  ${f.code} ${String(f.name).slice(0,32).padEnd(34)} 代销=${f.limit_amount} 直销=${f.direct_limit_amount} 倍数=${f.channel_ratio ?? '-'}`));

// 公告直核覆盖
const verified = latest.funds.filter(f => f.verified_by_announcement).length;
console.log('\n有公告直核标记:', verified, '/', latest.funds.length);

// 纳指100 & 标普500 专看
const us = latest.funds.filter(f => ['nasdaq100','sp500'].includes(f.index_key));
const uo = us.filter(f => f.status === '开放申购').length;
console.log('\n[美股方向] nasdaq100+sp500 共', us.length, '只 | 开放申购', uo, '只 | 限大额', us.filter(f=>f.status==='限大额').length, '| 暂停', us.filter(f=>f.status==='暂停申购').length);

console.log('\n=== 变动检测测试 ===');
// 模拟：把基线里几只基金的额度改掉，验证 diff 能抓到
const fake = JSON.parse(JSON.stringify(latest));
const target1 = fake.funds.find(f => f.status === '限大额' && typeof f.limit_amount === 'number');
const target2 = fake.funds.find(f => f.status === '限大额' && typeof f.direct_limit_amount === 'number');
const target3 = fake.funds.find(f => f.status === '暂停申购');
if (target1) target1.limit_amount = (target1.limit_amount || 0) + 1000;
if (target2) target2.direct_limit_amount = (target2.direct_limit_amount || 0) * 5;
if (target3) target3.status = '开放申购';

const diff = diffSnapshots(latest, fake, { minNotifyDelta: 0 });
console.log('检出变动:', diff.changes.length, '处');
console.log(summarize(diff, { asOf: fake.as_of, stats: fake.stats }));

