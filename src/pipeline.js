import { config } from './config.js';
import { collectDistribution } from './collectors.js';
import { collectOfficialDirect } from './official-direct.js';
import { diffSnapshots, fmtAmount, summarize } from './diff.js';
import { appendJsonl, ensureDir, nowStr, readJson, todayStr, writeJson } from './store.js';
import { notify } from './notify.js';

/** 从本地基金目录的主题标签推断指数分组 */
function topicToIndex(topic) {
  if (!topic) return null;
  if (/纳斯达克|纳指/.test(topic)) return 'nasdaq100';
  if (/标普/.test(topic)) return 'sp500';
  if (/恒生/.test(topic)) return 'hsi-tech';
  if (/日本|日经/.test(topic)) return 'japan';
  if (/德国|DAX/.test(topic)) return 'germany';
  if (/法国|CAC/.test(topic)) return 'france';
  if (/英国|富时/.test(topic)) return 'uk';
  if (/印度/.test(topic)) return 'india';
  if (/越南/.test(topic)) return 'vietnam';
  if (/沙特/.test(topic)) return 'saudi';
  if (/道琼斯/.test(topic)) return 'dow';
  if (/亚太/.test(topic)) return 'apac';
  return 'other';
}

/**
 * 合并双口径。
 * 骨架用本地基金目录（含迁移时的公告口径基线），
 * 再把天天基金的实时代销字段合并进去。
 * 注意：同一只基金可能同时有 A/C/I 等多个份额，状态通常一致但限额可能不同，故按份额各自成行。
 */
export function mergeSnapshot(direct, distribution) {
  const distMap = new Map(distribution.map((d) => [d.code, d]));
  const funds = [];
  const seen = new Set();

  for (const f of direct.funds) {
    const d = distMap.get(f.code);
    seen.add(f.code);

    // 代销限额：优先天天基金实时值；否则用公告口径的代销列
    const distLimit = d?.limit_amount ?? f.distribution_limit_amount ?? null;
    const distSource = d?.limit_amount != null
      ? 'eastmoney'
      : f.distribution_limit_amount != null
        ? 'eastmoney-announcement'
        : null;

    funds.push({
      code: f.code,
      name: f.name,
      topic: f.topic,
      index_key: topicToIndex(f.topic),
      status: normalizeStatus(d?.status || f.status),
      direct_status: normalizeStatus(f.status),
      redeem: d?.redeem || null,
      limit_amount: distLimit,
      limit_source: distSource,
      // purchasable=false 表示状态标称限大额、但渠道实际关闭（如“暂不开放购买”）
      purchasable: d?.purchasable ?? null,
      direct_limit_amount: f.direct_limit_amount ?? null,
      direct_limit_source: f.direct_limit_amount != null ? 'eastmoney-announcement' : null,
      channel_split: f.channel_split,
      channel_ratio: f.channel_ratio,
      channel_note: f.channel_note,
      on_exchange: f.on_exchange,
      tracking_error: d?.tracking_error ?? null,
      track_target: d?.track_target ?? null,
      performance: d?.performance ?? null,
      scale_billion: d?.scale_billion ?? null,
      scale_as_of: d?.scale_as_of ?? null,
      announcement_url: f.announcement_url,
      announcement_date: f.announcement_date,
      verified_by_announcement: f.verified_by_announcement,
      fund_url: `https://fund.eastmoney.com/${f.code}.html`,
    });
  }

  // 只在代销源出现、公告表未收录的基金（如新成立份额）
  for (const d of distribution) {
    if (seen.has(d.code)) continue;
    funds.push({
      code: d.code,
      name: d.name,
      topic: null,
      index_key: null,
      status: normalizeStatus(d.status),
      direct_status: null,
      redeem: d.redeem,
      limit_amount: d.limit_amount,
      limit_source: 'eastmoney',
      purchasable: d.purchasable ?? null,
      direct_limit_amount: null,
      direct_limit_source: null,
      channel_split: false,
      channel_ratio: null,
      channel_note: null,
      on_exchange: false,
      tracking_error: d.tracking_error,
      track_target: d.track_target,
      performance: d.performance ?? null,
      scale_billion: d.scale_billion ?? null,
      scale_as_of: d.scale_as_of ?? null,
      announcement_url: null,
      announcement_date: null,
      verified_by_announcement: false,
      fund_url: d.source_url,
    });
  }

  funds.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const byIndex = {};
  for (const f of funds) {
    const k = f.index_key || 'other';
    byIndex[k] = (byIndex[k] || 0) + 1;
  }

  // 额度合计分两个口径：
  //   nominal  名义额度——状态为限大额、场外、且有数字，不考虑渠道是否真的开门
  //   actual   实际可购——再剔除 purchasable=false（页面标“暂不开放购买”）
  // 场内份额不占用场外申购额度，一律不计入。
  const isOffExchangeLimited = (f) => f.status === '限大额' && !f.on_exchange;
  const pick = (f, actualOnly) => isOffExchangeLimited(f) && (!actualOnly || f.purchasable !== false);

  const agg = (list) => {
    let sumDist = 0, sumDirect = 0, nDist = 0, nDirect = 0;
    for (const f of list) {
      if (typeof f.limit_amount === 'number') { sumDist += f.limit_amount; nDist++; }
      if (typeof f.direct_limit_amount === 'number') { sumDirect += f.direct_limit_amount; nDirect++; }
    }
    return { sum_dist: sumDist, sum_direct: sumDirect, n_dist: nDist, n_direct: nDirect };
  };

  const nominal = agg(funds.filter((f) => pick(f, false)));
  const actual = agg(funds.filter((f) => pick(f, true)));

  // 官方“今日可申购总额度”口径：纳指100 + 标普500，场外，可申购
  const usList = (actualOnly) =>
    funds.filter(
      (f) =>
        ['nasdaq100', 'sp500'].includes(f.index_key) &&
        !f.on_exchange &&
        f.status !== '暂停申购' &&
        (!actualOnly || f.purchasable !== false) &&
        typeof f.limit_amount === 'number'
    );
  const usNominalList = usList(false);
  const usActualList = usList(true);
  // 直销口径不使用天天基金的 purchasable 标记；该标记只代表代销购买入口。
  // 直销是否可投以公告状态和有效直销限额为准。
  const usDirectList = funds.filter(
    (f) =>
      ['nasdaq100', 'sp500'].includes(f.index_key) &&
      !f.on_exchange &&
      f.direct_status !== '暂停申购' &&
      typeof f.direct_limit_amount === 'number'
  );

  return {
    generated_at: nowStr(),
    as_of: direct.as_of || todayStr(),
    sources: {
      direct: { name: '东方财富基金公告 + 本地基金目录', url: config.sources.eastmoneyAnnouncements, as_of: direct.as_of },
      distribution: { name: '天天基金 基金档案页', url: 'https://fund.eastmoney.com/', as_of: todayStr() },
    },
    declared: {
      tracked: direct.declared_tracked,
      buyable: direct.declared_buyable,
      open: direct.declared_open,
      limited: direct.declared_limited,
      suspended: direct.declared_suspended,
      on_exchange: direct.declared_on_exchange,
      channel_mismatch: direct.declared_channel_mismatch,
      total_daily_limit: direct.declared_total_daily_limit,
      prev_date: direct.declared_prev_date,
      prev_changes: direct.declared_prev_changes,
    },
    stats: {
      total: funds.length,
      open: funds.filter((f) => f.status === '开放申购').length,
      limited: funds.filter((f) => f.status === '限大额').length,
      suspended: funds.filter((f) => f.status === '暂停申购').length,
      closed: funds.filter((f) => !['开放申购', '限大额', '暂停申购'].includes(f.status)).length,
      on_exchange: funds.filter((f) => f.on_exchange).length,
      // 名义口径
      sum_distribution_limit: nominal.sum_dist,
      sum_direct_limit: nominal.sum_direct,
      n_distribution_limited: nominal.n_dist,
      n_direct_limited: nominal.n_direct,
      // 实际可购口径
      sum_distribution_limit_actual: actual.sum_dist,
      sum_direct_limit_actual: actual.sum_direct,
      n_distribution_limited_actual: actual.n_dist,
      n_direct_limited_actual: actual.n_direct,
      // 美股方向（与官方口径对齐）
      sum_us_daily_limit: usNominalList.reduce((a, f) => a + f.limit_amount, 0),
      n_us_buyable: usNominalList.length,
      sum_us_daily_limit_actual: usActualList.reduce((a, f) => a + f.limit_amount, 0),
      n_us_buyable_actual: usActualList.length,
      // 明确命名的双渠道口径；旧字段继续作为代销别名，兼容历史前端/API。
      sum_us_distribution_limit: usNominalList.reduce((a, f) => a + f.limit_amount, 0),
      n_us_distribution_buyable: usNominalList.length,
      sum_us_distribution_limit_actual: usActualList.reduce((a, f) => a + f.limit_amount, 0),
      n_us_distribution_buyable_actual: usActualList.length,
      sum_us_direct_limit: usDirectList.reduce((a, f) => a + f.direct_limit_amount, 0),
      n_us_direct_buyable: usDirectList.length,
      sum_us_direct_limit_actual: usDirectList.reduce((a, f) => a + f.direct_limit_amount, 0),
      n_us_direct_buyable_actual: usDirectList.length,
      by_index: byIndex,
    },
    funds,
  };
}

/** 归一化状态：公告表用“正常申购”“场内交易”，统一到与天天基金一致的取值 */
function normalizeStatus(s) {
  if (!s) return s;
  const t = String(s).trim();
  if (/正常申购|开放申购/.test(t)) return '开放申购';
  if (/限大额|限额申购/.test(t)) return '限大额';
  if (/暂停申购|暂停/.test(t)) return '暂停申购';
  if (/场内/.test(t)) return '场内交易';
  if (/封闭/.test(t)) return '封闭期';
  return t;
}

/**
 * 完整采集流程
 * @returns {{ snapshot: object, diff: object, notification: object[] }}
 */
export async function runCollect(opts = {}) {
  const { dryRun = false, force = false } = opts;

  console.error('[1/5] 更新直销口径（本地基金目录 + 东方财富公告）…');
  const direct = await collectOfficialDirect({
    catalogFile: config.catalogFile,
    stateFile: config.directStateFile,
    refresh: config.refreshAnnouncements,
    discover: config.discoverFunds,
    concurrency: config.announcementConcurrency,
    retries: config.retries,
    timeoutMs: config.timeoutMs,
    jitterMs: config.jitterMs,
  });
  console.error(
    `      得到 ${direct.funds.length} 只，as_of=${direct.as_of}｜新基金 ${direct.scan_stats.discovered} 只｜公告扫描 ${direct.scan_stats.scanned} 只，新增缓存 ${direct.scan_stats.parsed} 篇`
  );

  // 代销口径：优先只抓公告表里出现的代码（覆盖监控范围），失败不影响整体
  const codes = direct.funds.map((f) => f.code);
  console.error(`[2/5] 抓取代销口径（天天基金 ${codes.length} 只，并发 ${config.concurrency}）…`);
  const { results: distribution, errors } = await collectDistribution(codes, {
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    jitterMs: config.jitterMs,
  });
  console.error(`      成功 ${distribution.length} 只，失败 ${errors.length} 只`);

  console.error('[3/5] 合并双口径…');
  const snapshot = mergeSnapshot(direct, distribution);
  snapshot.collect_errors = [
    ...direct.source_errors,
    ...errors.map((e) => ({ stage: 'distribution-page', ...e })),
  ];
  console.error(
    `      合计 ${snapshot.stats.total} 只｜限大额 ${snapshot.stats.limited}｜暂停 ${snapshot.stats.suspended}｜开放 ${snapshot.stats.open}`
  );

  // 监控范围过滤（用于通知，但存档永远保全量）
  let watch = snapshot.funds;
  if (config.watchIndexes.length) {
    watch = snapshot.funds.filter((f) => config.watchIndexes.includes(f.index_key));
  }

  console.error('[4/5] 变动比对…');
  const prev = readJson(config.latestFile, null);
  let diff = { changes: [], added: [], removed: [] };
  if (prev && !force) {
    // 只对监控范围内的基金做通知级比对
    const prevWatch = {
      funds: (prev.funds || []).filter((f) => !config.watchIndexes.length || config.watchIndexes.includes(f.index_key)),
    };
    diff = diffSnapshots(prevWatch, { funds: watch }, { minNotifyDelta: config.minNotifyDelta });
  } else {
    console.error(prev ? '      --force，跳过比对' : '      无历史基线，本次作为基线');
  }
  console.error(`      变动 ${diff.changes.length} 处`);

  console.error('[5/5] 落盘与通知…');
  ensureDir(config.dataDir);
  ensureDir(config.historyDir);
  writeJson(config.latestFile, snapshot);
  writeJson(`${config.historyDir}/${snapshot.as_of}.json`, snapshot);

  if (diff.changes.length) {
    appendJsonl(
      config.changesFile,
      diff.changes.map((c) => ({
        detected_at: nowStr(),
        as_of: snapshot.as_of,
        code: c.code,
        name: c.name,
        severity: c.severity,
        fields: c.fields,
      }))
    );
  }

  let notification = [];
  const shouldNotify = (diff.changes.length > 0 || diff.added.length > 0 || diff.removed.length > 0) && !dryRun;
  if (shouldNotify) {
    const title = `QDII 额度变动 ${diff.changes.length} 处 · ${snapshot.as_of}`;
    const content = summarize(diff, { asOf: snapshot.as_of, stats: snapshot.stats });
    notification = await notify(config.notify, title, content);
  } else if (dryRun) {
    const content = summarize(diff, { asOf: snapshot.as_of, stats: snapshot.stats });
    console.log(content);
  } else {
    console.error('      无变动，静默');
  }

  return { snapshot, diff, notification };
}

export { fmtAmount };
