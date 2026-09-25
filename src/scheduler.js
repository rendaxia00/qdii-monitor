#!/usr/bin/env node
/**
 * 内置调度器：每交易日（周一至周五）在指定时刻自动采集。
 * 相比计划任务的好处：跨平台、可跟随 `node src/scheduler.js` 常驻运行。
 *
 * 用法:
 *   node src/scheduler.js                 # 默认 09:30 / 14:30
 *   node src/scheduler.js 09:30 15:00     # 自定义时刻
 */
import { runCollect } from './pipeline.js';
import { nowStr, todayStr } from './store.js';

const AT = process.argv.slice(2).filter((a) => /^\d{1,2}:\d{2}$/.test(a));
const TIMES = AT.length ? AT : ['09:30', '14:30'];

const pad = (n) => String(n).padStart(2, '0');
let lastRun = '';

/** 交易日判断：周一至周五。如需排除法定节假日，在此接入节假日表。 */
function isTradingDay(d = new Date()) {
  const w = d.getDay();
  return w >= 1 && w <= 5;
}

function tick() {
  const d = new Date();
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const stamp = `${todayStr(d)} ${hhmm}`;

  if (!TIMES.includes(hhmm) || lastRun === stamp) return;
  if (!isTradingDay(d)) {
    console.log(`[${nowStr()}] ${hhmm} 非交易日，跳过`);
    lastRun = stamp;
    return;
  }

  lastRun = stamp;
  console.log(`[${nowStr()}] 触发采集…`);
  runCollect({})
    .then((r) => {
      console.log(
        `[${nowStr()}] 完成：${r.snapshot.stats.total} 只，变动 ${r.diff.changes.length} 处`
      );
    })
    .catch((e) => console.error(`[${nowStr()}] 采集失败: ${e.message}`));
}

console.log(`调度器已启动，采集时刻：${TIMES.join(' / ')}（仅交易日执行）`);
console.log('按 Ctrl+C 退出');
tick();
setInterval(tick, 30 * 1000);
