import { fmtAmount } from './diff.js';

const TARGETS = [
  ['nasdaq100', '纳斯达克100'],
  ['sp500', '标普500'],
];

const BUYABLE = new Set(['开放申购', '限大额']);

const isDistributionBuyable = (f) =>
  !f.on_exchange && BUYABLE.has(f.status) && f.purchasable !== false;

const isDirectBuyable = (f) =>
  !f.on_exchange && BUYABLE.has(f.direct_status);

const shortName = (name, max = 24) => {
  const value = String(name || '未命名基金');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const channelStats = (funds, isBuyable, amountField) => {
  const available = funds.filter(isBuyable);
  const numeric = available.filter((f) => typeof f[amountField] === 'number');
  return {
    count: available.length,
    amount: numeric.reduce((sum, f) => sum + f[amountField], 0),
    unlimited: available.length - numeric.length,
  };
};

const quotaText = (stats) => {
  const parts = [`${stats.count}只`, `限额合计${fmtAmount(stats.amount)}`];
  if (stats.unlimited) parts.push(`${stats.unlimited}只额度未标明`);
  return parts.join('/');
};

const fundQuota = (f, channel) => {
  const direct = channel === 'direct';
  const available = direct ? isDirectBuyable(f) : isDistributionBuyable(f);
  if (!available) return '关闭';
  const value = direct ? f.direct_limit_amount : f.limit_amount;
  return typeof value === 'number' ? fmtAmount(value) : '开放（额度未标明）';
};

/** 生成每天固定发送的“纳指 + 标普”双渠道可申购清单。 */
export function buildDailyPurchaseSummary(snapshot) {
  if (!snapshot?.funds?.length) throw new Error('无基金快照，无法生成每日通知');

  let totalDist = { count: 0, amount: 0, unlimited: 0 };
  let totalDirect = { count: 0, amount: 0, unlimited: 0 };
  const sections = [];

  for (const [key, label] of TARGETS) {
    const funds = snapshot.funds
      .filter((f) => f.index_key === key && !f.on_exchange)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const dist = channelStats(funds, isDistributionBuyable, 'limit_amount');
    const direct = channelStats(funds, isDirectBuyable, 'direct_limit_amount');
    totalDist = {
      count: totalDist.count + dist.count,
      amount: totalDist.amount + dist.amount,
      unlimited: totalDist.unlimited + dist.unlimited,
    };
    totalDirect = {
      count: totalDirect.count + direct.count,
      amount: totalDirect.amount + direct.amount,
      unlimited: totalDirect.unlimited + direct.unlimited,
    };

    const available = funds.filter((f) => isDistributionBuyable(f) || isDirectBuyable(f));
    sections.push({
      key,
      label,
      distribution: dist,
      direct,
      funds: available.map((f) => ({
        code: f.code,
        name: f.name,
        distributionText: fundQuota(f, 'distribution'),
        directText: fundQuota(f, 'direct'),
      })),
    });
  }

  const lines = [
    `QDII 每日额度 · ${snapshot.as_of || '未知日期'}`,
    `代销：${quotaText(totalDist)}`,
    `直销：${quotaText(totalDirect)}`,
    '具体可申购基金与双渠道额度见长图；点击通知打开完整监控站。',
  ];

  return {
    title: `QDII 每日可购｜代销${fmtAmount(totalDist.amount)}｜直销${fmtAmount(totalDirect.amount)}`,
    content: lines.join('\n'),
    totals: { distribution: totalDist, direct: totalDirect },
    sections,
    asOf: snapshot.as_of || null,
    generatedAt: snapshot.generated_at || null,
  };
}

