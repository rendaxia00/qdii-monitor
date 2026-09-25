#!/usr/bin/env node
import { config } from './config.js';
import { runCollect } from './pipeline.js';
import { readJson } from './store.js';
import { fmtAmount } from './diff.js';

const [cmd = 'collect', ...rest] = process.argv.slice(2);
const has = (f) => rest.includes(f);

async function main() {
  switch (cmd) {
    case 'collect': {
      const { snapshot, diff, notification } = await runCollect({
        dryRun: has('--dry-run') || has('--quiet'),
        force: has('--force'),
      });
      if (!has('--quiet')) {
        console.log(`\n快照: ${snapshot.stats.total} 只 | as_of ${snapshot.as_of}`);
        console.log(`输出: ${config.latestFile}`);
        if (notification.length) console.log('通知:', JSON.stringify(notification));
      }
      break;
    }

    case 'report': {
      const snap = readJson(config.latestFile, null);
      if (!snap) {
        console.error('无快照，请先运行 collect');
        process.exitCode = 1;
        return;
      }
      const s = snap.stats;
      console.log(`QDII 额度快照 · ${snap.as_of}（生成于 ${snap.generated_at}）`);
      console.log(`合计 ${s.total} 只 | 开放申购 ${s.open} | 限大额 ${s.limited} | 暂停申购 ${s.suspended} | 其他 ${s.closed}`);
      console.log(`限大额基金单日额度合计：代销 ${fmtAmount(s.sum_distribution_limit)} | 直销 ${fmtAmount(s.sum_direct_limit)}`);
      console.log('分方向: ' + Object.entries(s.by_index).map(([k, v]) => `${k} ${v}`).join(' | '));
      console.log('\n可申购（开放+限大额）明细:');
      const buyable = snap.funds.filter((f) => f.status === '开放申购' || f.status === '限大额');
      for (const f of buyable.slice(0, 60)) {
        console.log(
          `  ${f.code} ${String(f.name).slice(0, 30).padEnd(32)} ${f.status.padEnd(6)} 代销=${fmtAmount(f.limit_amount).padEnd(10)} 直销=${fmtAmount(f.direct_limit_amount)}`
        );
      }
      if (buyable.length > 60) console.log(`  … 共 ${buyable.length} 只`);
      break;
    }

    default:
      console.log(`用法: node src/cli.js <command>

命令:
  collect [--dry-run] [--force] [--quiet]   采集并比对变动（默认触发通知）
  report                                    打印最近一次快照摘要

环境变量（全部可选，见 .env.example）:
  QDII_NOTIFY=console,webhook,email
  QDII_WEBHOOK_KIND=bark|serverchan|dingtalk|feishu|wecom|generic
  QDII_WEBHOOK_TOKEN=<token>
  QDII_INDEXES=nasdaq100,sp500
  QDII_CONCURRENCY=5`);
  }
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exitCode = 1;
});
