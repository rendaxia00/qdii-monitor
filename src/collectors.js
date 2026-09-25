/**
 * QDII 代销口径采集器
 *
 * 代销口径 (distribution): 天天基金单只基金页，字段“交易状态: 限大额 (单日累计购买上限10.00元)”
 * 直销公告采集与解析见 official-direct.js。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带重试与超时的抓取；返回 Buffer 以便按需解码 */
export async function fetchRaw(url, { retries = 3, timeoutMs = 20000, referer, jitterMs = 0 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9',
          ...(referer ? { referer } : {}),
        },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (jitterMs) await sleep(jitterMs * Math.random());
      return { status: res.status, buf, text: buf.toString('utf8') };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(400 * attempt + jitterMs * Math.random());
    }
  }
  throw lastErr;
}

/** GBK 解码（天天基金部分页面为非 UTF-8） */
export function decodeGbk(buf) {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

const stripTags = (h) =>
  String(h)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const numberAfterLabel = (html, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(html).match(
    new RegExp(`${escaped}[：:]?<\\/span>\\s*<span[^>]*>([-+]?\\d+(?:\\.\\d+)?)%`, 'i')
  );
  return m ? Number(m[1]) : null;
};

/**
 * 解析基金主页上的阶段收益和规模。收益单位均为百分比。
 * 字段来自页面 dataOfFund / infoOfFund 区块，不依赖页面脚本执行。
 */
export function parseEastmoneyPerformance(html) {
  const scale = String(html).match(/>规模<\/a>[：:]\s*([\d.]+)亿元[（(]([\d-]+)[）)]/);
  const netDate = String(html).match(/>单位净值<\/a><\/span>\s*[（(]<\/span>([\d-]+)[）)]/);
  return {
    one_month: numberAfterLabel(html, '近1月'),
    three_months: numberAfterLabel(html, '近3月'),
    six_months: numberAfterLabel(html, '近6月'),
    one_year: numberAfterLabel(html, '近1年'),
    three_years: numberAfterLabel(html, '近3年'),
    since_inception: numberAfterLabel(html, '成立来'),
    as_of: netDate?.[1] || null,
    scale_billion: scale ? Number(scale[1]) : null,
    scale_as_of: scale?.[2] || null,
  };
}

/* ------------------------------------------------------------------ *
 * 一、代销口径：天天基金单只基金页
 * ------------------------------------------------------------------ */

/** 把 “10.00元 / 1万元 / 1,000元 / 5亿” 解析成数字（元）；不限返回 null */
export function parseAmount(text) {
  if (!text) return null;
  const t = String(text).replace(/,/g, '').replace(/\s/g, '');
  if (/无限额|不限|暂无限制/.test(t)) return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(亿|万)?\s*元?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === '亿' ? n * 1e8 : m[2] === '万' ? n * 1e4 : n;
}

/**
 * 解析天天基金基金页的交易状态区块。
 * 实测结构：
 *   <span class="itemTit">交易状态：</span>
 *   <span class="staticCell">限大额 (<span>单日累计购买上限10.00元</span>)</span>
 *   <span class="staticCell">开放赎回</span>
 */
export function parseEastmoneyPage(html, code) {
  const blockRe =
    /<span class="itemTit">交易状态：<\/span>\s*<span class="staticCell">([\s\S]*?)<\/span>\s*<span class="staticCell">([\s\S]*?)<\/span>/;
  const m = html.match(blockRe);
  if (!m) return null;

  const statusRaw = stripTags(m[1]);
  const redeemRaw = stripTags(m[2]);

  // 状态取括号前的部分：“限大额 (单日累计购买上限10.00元)” -> “限大额”
  const status = (statusRaw.match(/^([^（(]+)/) || [])[1]?.trim() || statusRaw;
  const limitText = (statusRaw.match(/单日累计购买上限([\d.,]+\s*[万亿]?元?)/) || [])[1] || null;
  const limit_amount = parseAmount(limitText);

  // 状态标称“限大额”但渠道实际关闭的情况：页面出现“暂不开放购买”
  const purchasable = !/暂不开放购买|暂不可购买/.test(html);

  // 名称与其它档案字段
  const name = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.split('(')[0]?.trim() || null;
  const trackTarget = (html.match(/跟踪标的：<\/a>\s*([^|<]+)/) || [])[1]?.trim() || null;
  const trackErr = (html.match(/年化跟踪误差：<\/a>\s*([\d.]+)%/) || [])[1] || null;
  const performance = parseEastmoneyPerformance(html);

  return {
    code,
    name,
    status,
    redeem: redeemRaw || null,
    limit_amount,
    limit_text: limitText,
    purchasable,
    track_target: trackTarget,
    tracking_error: trackErr ? Number(trackErr) : null,
    performance,
    scale_billion: performance.scale_billion,
    scale_as_of: performance.scale_as_of,
    source: 'eastmoney-fund-page',
    source_url: `https://fund.eastmoney.com/${code}.html`,
  };
}

/** 并发抓取多只基金的代销口径 */
export async function collectDistribution(codes, opts = {}) {
  const { concurrency = 5, timeoutMs = 20000, retries = 3, jitterMs = 150 } = opts;
  const results = [];
  const errors = [];
  let cursor = 0;

  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      try {
        const { text } = await fetchRaw(`https://fund.eastmoney.com/${code}.html`, {
          retries,
          timeoutMs,
          referer: 'https://fund.eastmoney.com/',
          jitterMs,
        });
        const parsed = parseEastmoneyPage(text, code);
        if (parsed) results.push(parsed);
        else errors.push({ code, error: '交易状态区块未匹配' });
      } catch (e) {
        errors.push({ code, error: e.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, worker));
  return { results, errors };
}

