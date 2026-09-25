import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const money = (value) => Number(value || 0).toLocaleString('zh-CN');

const channelLine = (stats) => {
  const extra = stats.unlimited ? ` · 另有 ${stats.unlimited} 只额度未标明` : '';
  return `${stats.count} 只 · ${money(stats.amount)} 元${extra}`;
};

/** 将每日额度摘要渲染为适合手机通知预览的 PNG 卡片。 */
export async function generateDailyQuotaCard(summary, outputFile) {
  const nasdaq = summary.sections.find((x) => x.key === 'nasdaq100');
  const sp500 = summary.sections.find((x) => x.key === 'sp500');
  if (!nasdaq || !sp500) throw new Error('每日摘要缺少纳指100或标普500数据');

  const totalDist = summary.totals.distribution;
  const totalDirect = summary.totals.direct;
  const svg = `
  <svg width="1200" height="900" viewBox="0 0 1200 900" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b182a"/>
        <stop offset="1" stop-color="#162c48"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#d6ad4a"/>
        <stop offset="1" stop-color="#f0d47b"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#020812" flood-opacity="0.35"/>
      </filter>
    </defs>
    <rect width="1200" height="900" rx="44" fill="url(#bg)"/>
    <circle cx="1080" cy="85" r="230" fill="#d6ad4a" opacity="0.045"/>
    <circle cx="75" cy="820" r="190" fill="#4d91c8" opacity="0.055"/>

    <g font-family="Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">
      <text x="70" y="82" fill="#d8b85a" font-size="24" font-weight="700" letter-spacing="5">QDII DAILY LIMIT</text>
      <text x="70" y="145" fill="#ffffff" font-size="48" font-weight="700">每日可申购额度</text>
      <text x="1130" y="92" text-anchor="end" fill="#9eafc3" font-size="24">${esc(summary.asOf || '—')}</text>
      <text x="1130" y="130" text-anchor="end" fill="#70849b" font-size="18">纳指100 · 标普500</text>

      <g filter="url(#shadow)">
        <rect x="70" y="190" width="510" height="215" rx="26" fill="#1c3049" stroke="#38516d"/>
        <rect x="620" y="190" width="510" height="215" rx="26" fill="#223548" stroke="#8a7240"/>
      </g>
      <text x="110" y="242" fill="#aebdce" font-size="25" font-weight="600">代销渠道</text>
      <text x="110" y="332" fill="#ffffff" font-size="72" font-weight="700">${money(totalDist.amount)}</text>
      <text x="390" y="332" fill="#aebdce" font-size="27">元/日</text>
      <text x="110" y="375" fill="#8195aa" font-size="22">实际可购 ${totalDist.count} 只</text>

      <text x="660" y="242" fill="#c8bd9f" font-size="25" font-weight="600">直销渠道</text>
      <text x="660" y="332" fill="#ffffff" font-size="72" font-weight="700">${money(totalDirect.amount)}</text>
      <text x="965" y="332" fill="#c8bd9f" font-size="27">元/日</text>
      <text x="660" y="375" fill="#9e9378" font-size="22">实际可购 ${totalDirect.count} 只${totalDirect.unlimited ? ` · ${totalDirect.unlimited} 只额度未标明` : ''}</text>

      <rect x="70" y="450" width="1060" height="145" rx="22" fill="#13263d" stroke="#2c4765"/>
      <rect x="70" y="450" width="10" height="145" rx="5" fill="#4d91c8"/>
      <text x="110" y="500" fill="#ffffff" font-size="29" font-weight="700">纳斯达克100</text>
      <text x="110" y="550" fill="#aebdce" font-size="23">代销  ${esc(channelLine(nasdaq.distribution))}</text>
      <text x="655" y="550" fill="#d6c69c" font-size="23">直销  ${esc(channelLine(nasdaq.direct))}</text>

      <rect x="70" y="625" width="1060" height="145" rx="22" fill="#13263d" stroke="#2c4765"/>
      <rect x="70" y="625" width="10" height="145" rx="5" fill="url(#gold)"/>
      <text x="110" y="675" fill="#ffffff" font-size="29" font-weight="700">标普500</text>
      <text x="110" y="725" fill="#aebdce" font-size="23">代销  ${esc(channelLine(sp500.distribution))}</text>
      <text x="655" y="725" fill="#d6c69c" font-size="23">直销  ${esc(channelLine(sp500.direct))}</text>

      <line x1="70" y1="815" x2="1130" y2="815" stroke="#34506b"/>
      <text x="70" y="858" fill="#71869c" font-size="19">每日 09:30 自动更新 · 金额按当前可申购基金份额加总</text>
      <text x="1130" y="858" text-anchor="end" fill="#d8b85a" font-size="19">rendaxia00.github.io/qdii-monitor</text>
    </g>
  </svg>`;

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(outputFile);
  return outputFile;
}

