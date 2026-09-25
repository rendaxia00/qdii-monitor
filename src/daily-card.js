import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const money = (value) => Number(value || 0).toLocaleString('zh-CN');

const shortName = (name, max = 25) => {
  const value = String(name || '未命名基金');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

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
  const width = 1200;
  const topHeight = 445;
  const sectionHeadHeight = 110;
  const columnHeadHeight = 52;
  const rowHeight = 66;
  const sectionGap = 30;
  const footerHeight = 105;
  const tableHeight = summary.sections.reduce(
    (sum, section) => sum + sectionHeadHeight + columnHeadHeight + section.funds.length * rowHeight + sectionGap,
    0
  );
  const height = topHeight + tableHeight + footerHeight;

  let cursorY = topHeight;
  const sectionMarkup = summary.sections.map((section, sectionIndex) => {
    const sectionY = cursorY;
    const headY = sectionY;
    const columnsY = headY + sectionHeadHeight;
    const rowsY = columnsY + columnHeadHeight;
    const accent = sectionIndex === 0 ? '#55a7df' : '#edc958';
    const rows = section.funds.map((fund, index) => {
      const y = rowsY + index * rowHeight;
      const fill = index % 2 === 0 ? '#142941' : '#10243a';
      const distColor = fund.distributionText === '关闭' ? '#687e94' : '#c1d4e6';
      const directColor = fund.directText === '关闭' ? '#687e94' : '#e0c987';
      return `
        <rect x="70" y="${y}" width="1060" height="${rowHeight}" fill="${fill}"/>
        <line x1="70" y1="${y + rowHeight}" x2="1130" y2="${y + rowHeight}" stroke="#29435d"/>
        <text x="100" y="${y + 42}" fill="#8ea3b8" font-size="20" font-family="IBM Plex Mono, Consolas, monospace">${esc(fund.code)}</text>
        <text x="235" y="${y + 42}" fill="#eef4f9" font-size="21">${esc(shortName(fund.name))}</text>
        <text x="825" y="${y + 42}" fill="${distColor}" font-size="21">${esc(fund.distributionText)}</text>
        <text x="1000" y="${y + 42}" fill="${directColor}" font-size="21">${esc(fund.directText)}</text>`;
    }).join('');
    cursorY = rowsY + section.funds.length * rowHeight + sectionGap;
    return `
      <rect x="70" y="${headY}" width="1060" height="${sectionHeadHeight}" rx="20" fill="#172d46" stroke="#36516c"/>
      <rect x="70" y="${headY}" width="10" height="${sectionHeadHeight}" rx="5" fill="${accent}"/>
      <text x="105" y="${headY + 46}" fill="#ffffff" font-size="30" font-weight="700">${esc(section.label)}</text>
      <text x="105" y="${headY + 82}" fill="#8fa4b8" font-size="19">共 ${section.funds.length} 只可申购份额</text>
      <text x="1130" y="${headY + 46}" text-anchor="end" fill="#b9cad9" font-size="20">代销 ${esc(channelLine(section.distribution))}</text>
      <text x="1130" y="${headY + 80}" text-anchor="end" fill="#d8c58d" font-size="20">直销 ${esc(channelLine(section.direct))}</text>
      <rect x="70" y="${columnsY}" width="1060" height="${columnHeadHeight}" fill="#0d2034"/>
      <text x="100" y="${columnsY + 34}" fill="#667e96" font-size="17">代码</text>
      <text x="235" y="${columnsY + 34}" fill="#667e96" font-size="17">基金名称</text>
      <text x="825" y="${columnsY + 34}" fill="#667e96" font-size="17">代销额度/日</text>
      <text x="1000" y="${columnsY + 34}" fill="#8d805f" font-size="17">直销额度/日</text>
      ${rows}`;
  }).join('');

  const footerY = height - footerHeight;
  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
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
    <rect width="${width}" height="${height}" rx="44" fill="url(#bg)"/>
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

      ${sectionMarkup}

      <line x1="70" y1="${footerY + 22}" x2="1130" y2="${footerY + 22}" stroke="#34506b"/>
      <text x="70" y="${footerY + 67}" fill="#71869c" font-size="19">每日 09:30 自动更新 · “关闭”表示该渠道当前不可申购</text>
      <text x="1130" y="${footerY + 67}" text-anchor="end" fill="#d8b85a" font-size="19">点击通知查看完整监控站</text>
    </g>
  </svg>`;

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(outputFile);
  return outputFile;
}

