import path from 'node:path';
import { config } from './config.js';
import { fetchRaw, parseEastmoneyPage, parseEastmoneyPerformance } from './collectors.js';
import { nowStr, readJson, writeJson } from './store.js';

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const cell = (html, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(html).match(new RegExp(`<th>${escaped}<\\/th><td>([\\s\\S]*?)<\\/td>`));
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : null;
};

/** 解析基金 F10 基本概况页。 */
export function parseFundOverview(html) {
  const established = cell(html, '成立日期/规模') || '';
  const assets = cell(html, '净资产规模') || '';
  const management = cell(html, '管理费率') || '';
  const custody = cell(html, '托管费率') || '';
  const service = cell(html, '销售服务费率') || '';
  const type = cell(html, '基金类型');

  return {
    inception_date: (established.match(/(\d{4})年?(\d{2})月?(\d{2})日?/) || []).slice(1, 4).join('-') || null,
    inception_size_billion_shares: n((established.match(/\/\s*([\d.]+)亿份/) || [])[1]),
    scale_billion: n((assets.match(/([\d.]+)亿元/) || [])[1]),
    scale_as_of: (assets.match(/(\d{4})年?(\d{2})月?(\d{2})日?/) || []).slice(1, 4).join('-') || null,
    management_fee: n((management.match(/([\d.]+)%/) || [])[1]),
    custody_fee: n((custody.match(/([\d.]+)%/) || [])[1]),
    sales_service_fee: n((service.match(/([\d.]+)%/) || [])[1]),
    fund_type: type,
  };
}

const cacheFile = (code) => path.join(config.profileDir, `${code}.json`);

/**
 * 按需抓取基金业绩和基本概况。缓存 12 小时，避免用户反复展开时重复访问上游。
 */
export async function getFundProfile(code, { force = false } = {}) {
  const file = cacheFile(code);
  const cached = readJson(file, null);
  const age = cached?.fetched_at_ms ? Date.now() - cached.fetched_at_ms : Infinity;
  if (!force && cached && age < config.profileCacheMs) return cached;

  const [main, overview] = await Promise.all([
    fetchRaw(`https://fund.eastmoney.com/${code}.html`, {
      retries: config.retries,
      timeoutMs: config.timeoutMs,
      referer: 'https://fund.eastmoney.com/',
    }),
    fetchRaw(`https://fundf10.eastmoney.com/jbgk_${code}.html`, {
      retries: config.retries,
      timeoutMs: config.timeoutMs,
      referer: `https://fund.eastmoney.com/${code}.html`,
    }),
  ]);

  const parsedMain = parseEastmoneyPage(main.text, code);
  const profile = {
    code,
    name: parsedMain?.name || null,
    performance: parsedMain?.performance || parseEastmoneyPerformance(main.text),
    ...parseFundOverview(overview.text),
    purchase_fee: n((main.text.match(/var\s+fund_Rate\s*=\s*["']([\d.]+)["']/) || [])[1]),
    fetched_at: nowStr(),
    fetched_at_ms: Date.now(),
    sources: {
      performance: `https://fund.eastmoney.com/${code}.html`,
      overview: `https://fundf10.eastmoney.com/jbgk_${code}.html`,
    },
  };
  // 主页面规模通常更新更直接；F10 未解析到时才回退。
  profile.scale_billion ??= profile.performance?.scale_billion ?? null;
  profile.scale_as_of ||= profile.performance?.scale_as_of || null;
  writeJson(file, profile);
  return profile;
}
