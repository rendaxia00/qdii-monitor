/**
 * 直销口径采集器（无第三方聚合站依赖）。
 *
 * - 基金范围和主题来自本地 data/fund-catalog.json。
 * - 增量变更来自天天基金销售类公告列表与东方财富公告正文接口。
 * - 只有能高置信解析、且已到生效日的公告才覆盖迁移基线；其余保留原值。
 */
import { fetchRaw, parseAmount } from './collectors.js';
import { readJson, writeJson, todayStr } from './store.js';

const ANN_LIST = 'https://api.fund.eastmoney.com/f10/JJGG';
const ANN_CONTENT = 'https://np-cnotice-stock.eastmoney.com/api/content/ann';
const FUND_DIRECTORY = 'https://fund.eastmoney.com/js/fundcode_search.js';
const FUND_REFERER = 'https://fundf10.eastmoney.com/';

const htmlText = (value) =>
  String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const announcementId = (url) => (String(url || '').match(/(AN\d{12,})/) || [])[1] || null;

function isoDate(y, m, d) {
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(m) - 1 || dt.getDate() !== Number(d)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 从公告正文提取业务生效日。 */
export function extractEffectiveDate(text, fallback = null) {
  const t = htmlText(text);
  const date = '(20\\d{2})\\s*[年\\-/]\\s*(\\d{1,2})\\s*[月\\-/]\\s*(\\d{1,2})\\s*日?';
  const labels = [
    '调整大额申购起始日',
    '暂停大额申购起始日',
    '暂停申购起始日',
    '恢复申购起始日',
    '恢复申购日',
    '恢复大额申购起始日',
  ];
  for (const label of labels) {
    const m = t.match(new RegExp(`${label}[^\\d]{0,30}${date}`));
    if (m) return isoDate(m[1], m[2], m[3]);
  }
  const from = t.match(new RegExp(`自\\s*${date}\\s*起`));
  return from ? isoDate(from[1], from[2], from[3]) : fallback;
}

function moneyCandidates(text, offset = 0) {
  const out = [];
  const re = /([\d,]+(?:\.\d+)?)\s*(亿|万)?\s*(?:元|人民币)/g;
  let m;
  while ((m = re.exec(text))) {
    const amount = parseAmount(`${m[1]}${m[2] || ''}元`);
    if (typeof amount === 'number') out.push({ amount, index: offset + m.index, raw: m[0] });
  }
  return out;
}

function amountNearChannel(text, channelRe, otherChannelRe) {
  let best = null;
  const re = new RegExp(channelRe.source, 'g');
  let hit;
  while ((hit = re.exec(text))) {
    const start = hit.index;
    const window = text.slice(start, start + 420);
    for (const c of moneyCandidates(window, start)) {
      const local = text.slice(Math.max(start, c.index - 150), c.index + c.raw.length + 20);
      const beforeAmount = text.slice(start, c.index);
      let score = 4;
      if (/单日|每日/.test(local)) score += 4;
      if (/累计/.test(local)) score += 4;
      if (/不超过|不得超过|上限|限制金额|超过/.test(local)) score += 5;
      if (/个人投资者/.test(local)) score += 2;
      if (/机构投资者/.test(local) && !/个人投资者/.test(local)) score -= 1;
      if (/单笔/.test(local) && !/累计/.test(local)) score -= 2;
      if (/美元|美金/.test(local)) score -= 8;
      if (new RegExp(otherChannelRe.source).test(beforeAmount)) score -= 7;
      if (!best || score > best.score || (score === best.score && c.index < best.index)) {
        best = { ...c, score };
      }
    }
  }
  return best && best.score >= 8 ? best.amount : null;
}

function genericDailyAmount(text) {
  const patterns = [
    /单日[^。；]{0,100}?(?:累计[^。；]{0,80}?)?(?:不超过|不得超过|超过)\s*([\d,]+(?:\.\d+)?)\s*(亿|万)?\s*元/,
    /每一类基金份额单日[^。；]{0,100}?限制金额(?:调整为)?\s*([\d,]+(?:\.\d+)?)\s*(亿|万)?\s*元/,
    /限制申购金额[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(亿|万)?/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseAmount(`${m[1]}${m[2] || ''}元`);
  }
  return null;
}

/**
 * 将一篇销售公告解析为可应用的增量补丁。
 * 返回 null 表示公告相关但语义不足，不覆盖已有可靠数据。
 */
export function parseSalesAnnouncement({ title = '', content = '', publishDate = null, id = null } = {}) {
  const text = htmlText(`${title} ${content}`);
  if (!text || !/申购/.test(text)) return null;

  const isFullSuspend = /暂停(?:办理)?(?:本基金(?:的)?|基金)?申购/.test(text) && !/暂停大额申购/.test(title);
  const isUnlimited = /恢复(?:办理)?大额申购|取消(?:大额)?申购限制|恢复正常办理大额申购/.test(title);
  const isLimited = /大额申购|限制大额申购|限制申购金额|限额申购/.test(text);

  let status = null;
  if (isFullSuspend) status = '暂停申购';
  else if (isUnlimited && !/限制大额申购|同时限制|及限制/.test(title)) status = '开放申购';
  else if (isLimited) status = '限大额';

  const direct = amountNearChannel(text, /直销/g, /代销|销售机构/g);
  const distribution = amountNearChannel(text, /代销|销售机构/g, /直销/g);
  const generic = genericDailyAmount(text);
  const hasDirectWording = /直销/.test(text);
  const hasDistributionWording = /代销|销售机构/.test(text);

  let directAmount = direct;
  let distributionAmount = distribution;
  let directSpecified = direct !== null;
  let distributionSpecified = distribution !== null;
  let genericSpecified = false;

  if (generic !== null && direct === null && distribution === null) {
    directAmount = generic;
    distributionAmount = generic;
    directSpecified = true;
    distributionSpecified = true;
    genericSpecified = true;
  } else if (generic !== null) {
    // 表格总限额可作为未明确渠道的一侧回退，但不能覆盖正文里的渠道专属值。
    if (!directSpecified && !hasDirectWording) { directAmount = generic; directSpecified = true; }
    if (!distributionSpecified && !hasDistributionWording) { distributionAmount = generic; distributionSpecified = true; }
  }

  if (status === '限大额' && !directSpecified && !distributionSpecified) return null;
  if (!status) return null;

  const effectiveDate = extractEffectiveDate(text, publishDate);
  const channelSplit = directSpecified && distributionSpecified && directAmount !== distributionAmount;
  return {
    id,
    title,
    publish_date: publishDate,
    effective_date: effectiveDate,
    status,
    direct_amount: directAmount,
    distribution_amount: distributionAmount,
    direct_specified: directSpecified,
    distribution_specified: distributionSpecified,
    generic_specified: genericSpecified,
    channel_split: channelSplit,
    channel_ratio:
      channelSplit && typeof directAmount === 'number' && typeof distributionAmount === 'number' && distributionAmount !== 0
        ? +(directAmount / distributionAmount).toFixed(4)
        : null,
    confidence: 'high',
  };
}

function relevantTitle(title) {
  const t = String(title || '');
  if (!/申购/.test(t)) return false;
  if (/销售机构.*(?:终止|新增|变更)|节假日|境外.*(?:休市|假期)/.test(t)) return false;
  return /大额申购|暂停申购|恢复申购|申购.*(?:限制|限额)|(?:限制|调整).*申购/.test(t);
}

/** 只匹配本项目原有的12个明确主题，避免把“纳斯达克科技”等相邻指数误收进来。 */
export function inferTopicFromName(name) {
  const n = String(name || '');
  if (/恒生科技/.test(n)) return '恒生科技';
  if (/纳斯达克\s*100|纳指\s*100/.test(n)) return '纳斯达克100';
  if (/标普\s*500/i.test(n)) return '标普500';
  if (/德国.*DAX|DAX.*德国|德国ETF/.test(n)) return '德国DAX';
  if (/法国.*CAC|CAC\s*40|法国ETF/.test(n)) return '法国CAC40';
  if (/道琼斯/.test(n)) return '道琼斯';
  if (/印度/.test(n)) return '印度';
  if (/富时\s*100/.test(n)) return '英国富时100';
  if (/越南/.test(n)) return '越南';
  if (/日经|日本东证/.test(n)) return '日本股市';
  if (/亚太精选/.test(n)) return '亚太精选';
  if (/沙特/.test(n)) return '沙特';
  return null;
}

async function discoverFunds(opts) {
  const { text } = await fetchRaw(FUND_DIRECTORY, { ...opts, referer: 'https://fund.eastmoney.com/' });
  const raw = text.replace(/^\uFEFF?\s*var\s+r\s*=\s*/, '').replace(/;\s*$/, '');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('基金目录格式异常');
  return rows.flatMap((row) => {
    const [code, , name, type] = row;
    const topic = inferTopicFromName(name);
    if (!topic || !/QDII|海外/.test(String(type))) return [];
    if (/美元|美钞|美元现汇|美汇|后端/.test(name) || /纯债|债券/.test(String(type))) return [];
    const onExchange = /ETF/.test(name) && !/联接/.test(name) && /^(15|51|52)/.test(code);
    return [{
      code,
      name,
      topic,
      on_exchange: onExchange,
      status: onExchange ? '场内交易' : null,
      distribution_limit_amount: null,
      direct_limit_amount: null,
      channel_split: false,
      channel_ratio: null,
      channel_note: null,
      announcement_url: null,
      announcement_date: null,
      verified_by_announcement: false,
      discovered_at: todayStr(),
    }];
  });
}

async function fetchAnnouncementList(code, opts) {
  const url = `${ANN_LIST}?fundcode=${encodeURIComponent(code)}&pageIndex=1&pageSize=30&type=5`;
  const { text } = await fetchRaw(url, { ...opts, referer: `${FUND_REFERER}jjgg_${code}.html` });
  const json = JSON.parse(text);
  if (json?.ErrCode !== 0 || !Array.isArray(json?.Data)) throw new Error(json?.ErrMsg || '公告列表格式异常');
  return json.Data;
}

async function fetchAnnouncementContent(id, opts) {
  const url = `${ANN_CONTENT}?art_code=${encodeURIComponent(id)}&client_source=web&page_index=1`;
  const { text } = await fetchRaw(url, { ...opts, referer: 'https://fund.eastmoney.com/' });
  const json = JSON.parse(text);
  const content = json?.data?.notice_content;
  if (!content) throw new Error('公告正文为空');
  return content;
}

function applyPatch(fund, patch) {
  const next = { ...fund };
  if (patch.status) next.status = patch.status;

  if (patch.status === '开放申购' || patch.status === '暂停申购') {
    // 明确恢复正常或暂停全部申购时，该公告覆盖两侧数值。
    next.direct_limit_amount = null;
    next.distribution_limit_amount = null;
  } else {
    if (patch.direct_specified) next.direct_limit_amount = patch.direct_amount;
    if (patch.distribution_specified) next.distribution_limit_amount = patch.distribution_amount;
  }

  if (patch.direct_specified && patch.distribution_specified) {
    next.channel_split = patch.channel_split;
    next.channel_ratio = patch.channel_ratio;
    next.channel_note = patch.channel_split
      ? `公告原文：代销 ${patch.distribution_amount}元；直销 ${patch.direct_amount}元`
      : null;
  }
  next.announcement_url = `https://fund.eastmoney.com/gonggao/${fund.code},${patch.id}.html`;
  next.announcement_date = patch.publish_date;
  next.verified_by_announcement = true;
  return next;
}

function buildDeclared(funds) {
  const status = (name) => funds.filter((f) => f.status === name).length;
  return {
    declared_tracked: funds.length,
    // 保持旧字段语义：可申购口径指场外基金份额总数，包含当前暂停申购者。
    declared_buyable: funds.filter((f) => !f.on_exchange).length,
    declared_open: status('开放申购'),
    declared_limited: status('限大额'),
    declared_suspended: status('暂停申购'),
    declared_on_exchange: funds.filter((f) => f.on_exchange).length,
    declared_channel_mismatch: funds.filter((f) => f.channel_split).length,
    declared_total_daily_limit: null,
    declared_prev_date: null,
    declared_prev_changes: null,
  };
}

/** 使用有限并发处理任务，避免公告接口被瞬时打满。 */
async function runPool(items, concurrency, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
}

/**
 * @param {object} opts
 * @param {string} opts.catalogFile
 * @param {string} opts.stateFile
 */
export async function collectOfficialDirect(opts = {}) {
  const {
    catalogFile,
    stateFile,
    refresh = true,
    discover = true,
    concurrency = 4,
    retries = 3,
    timeoutMs = 20000,
    jitterMs = 100,
    asOf = todayStr(),
  } = opts;

  const catalog = readJson(catalogFile, null);
  if (!catalog?.funds?.length) throw new Error(`基金目录不存在或为空: ${catalogFile}`);
  const baseline = catalog.baseline_as_of || asOf;
  const state = readJson(stateFile, { version: 1, announcements: {} });
  state.version = 1;
  state.baseline_as_of = baseline;
  state.announcements ||= {};
  state.discovered_funds ||= [];
  const existingAnnouncementIds = new Set(Object.keys(state.announcements));

  const errors = [];
  const contentMemo = new Map();
  let scanned = 0;
  let parsed = 0;
  let discovered = 0;

  if (refresh && discover) {
    try {
      const remoteFunds = await discoverFunds({ retries, timeoutMs, jitterMs });
      const known = new Set([...catalog.funds, ...state.discovered_funds].map((f) => f.code));
      const additions = remoteFunds.filter((f) => !known.has(f.code));
      if (additions.length) {
        state.discovered_funds.push(...additions);
        discovered = additions.length;
      }
    } catch (e) {
      errors.push({ stage: 'fund-directory', error: e.message });
    }
  }

  const fundMap = new Map();
  for (const fund of [...catalog.funds, ...state.discovered_funds]) fundMap.set(fund.code, fund);
  const baseFunds = [...fundMap.values()];

  if (refresh) {
    const scanFunds = baseFunds.filter((f) => !f.on_exchange);
    await runPool(scanFunds, concurrency, async (fund) => {
      try {
        const rows = await fetchAnnouncementList(fund.code, { retries, timeoutMs, jitterMs });
        scanned++;
        const baselineId = announcementId(fund.announcement_url);
        const candidates = rows
          .filter((a) => relevantTitle(a.TITLE))
          .filter((a) => {
            const date = String(a.PUBLISHDATEDesc || a.PUBLISHDATE || '').slice(0, 10);
            return date >= baseline || (a.ID === baselineId && date >= baseline);
          })
          .slice(0, 6);

        for (const ann of candidates) {
          if (state.announcements[ann.ID]?.parsed_at) {
            state.announcements[ann.ID].fund_codes = [
              ...new Set([...(state.announcements[ann.ID].fund_codes || []), fund.code]),
            ];
            continue;
          }
          try {
            let promise = contentMemo.get(ann.ID);
            if (!promise) {
              promise = fetchAnnouncementContent(ann.ID, { retries, timeoutMs, jitterMs });
              contentMemo.set(ann.ID, promise);
            }
            const content = await promise;
            const patch = parseSalesAnnouncement({
              id: ann.ID,
              title: ann.TITLE,
              publishDate: String(ann.PUBLISHDATEDesc || ann.PUBLISHDATE || '').slice(0, 10),
              content,
            });
            state.announcements[ann.ID] = {
              parsed_at: new Date().toISOString(),
              fund_codes: [...new Set([...(state.announcements[ann.ID]?.fund_codes || []), fund.code])],
              patch,
            };
          } catch (e) {
            errors.push({ stage: 'announcement-content', code: fund.code, announcement_id: ann.ID, error: e.message });
          }
        }
      } catch (e) {
        errors.push({ stage: 'announcement-list', code: fund.code, error: e.message });
      }
    });
    parsed = Object.keys(state.announcements).filter((id) => !existingAnnouncementIds.has(id)).length;
  }

  const funds = baseFunds.map((base) => {
    let current = { ...base };
    const applicable = Object.values(state.announcements)
      .filter((entry) => entry?.patch && entry.fund_codes?.includes(base.code))
      .map((entry) => entry.patch)
      .filter((p) => p.confidence === 'high' && p.effective_date && p.effective_date <= asOf)
      // 迁移基线以前已经生效的公告已体现在目录中，不重复解释，避免格式差异覆盖可靠基线。
      .filter((p) => p.publish_date > baseline || p.effective_date > baseline)
      .sort((a, b) => `${a.effective_date}:${a.publish_date}:${a.id}`.localeCompare(`${b.effective_date}:${b.publish_date}:${b.id}`));
    for (const patch of applicable) current = applyPatch(current, patch);
    return current;
  });

  state.updated_at = new Date().toISOString();
  state.last_scan = { as_of: asOf, scanned, parsed, discovered, errors: errors.length };
  writeJson(stateFile, state);

  return {
    as_of: asOf,
    baseline_as_of: baseline,
    funds,
    source_errors: errors,
    scan_stats: state.last_scan,
    ...buildDeclared(funds),
  };
}

