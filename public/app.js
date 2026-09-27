/* QDII 申购限额监控台 · 前端逻辑 */

const state = {
  snap: null,
  changes: [],
  staticMode: false,
  filter: { search: '', index: '', status: '', sort: 'limit_desc', quick: 'all' },
  page: 1,
  pageSize: 80,
  controlsReady: false,
  returnChannel: null,
  lastFocus: null,
  cachedOffline: false,
};

/** 本地服务优先；GitHub Pages 上回退到构建时生成的静态 JSON。 */
async function fetchJson(primaryUrl, staticPath, options) {
  if (!state.staticMode) {
    try {
      const res = await fetch(primaryUrl, options);
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('application/json')) {
        state.cachedOffline = res.headers.get('x-qdii-offline') === '1';
        updateNetworkStatus();
        return await res.json();
      }
    } catch {}
  }
  const fallback = new URL(staticPath, document.baseURI);
  const res = await fetch(fallback);
  if (!res.ok) throw new Error(`静态数据加载失败：${res.status}`);
  state.cachedOffline = res.headers.get('x-qdii-offline') === '1';
  updateNetworkStatus();
  return res.json();
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  return n;
};

/* ---------------- 主题 ---------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#101416' : '#f5f7f8';
  const toggle = $('#themeToggle');
  if (toggle) toggle.setAttribute('aria-label', theme === 'dark' ? '切换为浅色' : '切换为深色');
}

(function initTheme() {
  try {
    const saved = localStorage.getItem('qdii-theme');
    if (saved) applyTheme(saved);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      applyTheme('dark');
  } catch {}
})();

/* ---------------- 格式化 ---------------- */
function fmtAmount(v) {
  if (v === null || v === undefined) return { text: '—', cls: 'num-none' };
  if (v >= 1e8) return { text: `${+(v / 1e8).toFixed(4)} 亿`, cls: '' };
  if (v >= 1e4) return { text: `${+(v / 1e4).toFixed(2)} 万`, cls: '' };
  if (v === 0) return { text: '0 元', cls: 'num-warn' };
  return { text: `${v.toLocaleString('zh-CN')} 元`, cls: '' };
}

const INDEX_LABEL = {
  nasdaq100: '纳斯达克100',
  sp500: '标普500',
  'hsi-tech': '恒生科技',
  dow: '道琼斯',
  japan: '日本股市',
  germany: '德国DAX',
  france: '法国CAC40',
  uk: '英国富时100',
  india: '印度',
  vietnam: '越南',
  saudi: '沙特',
  apac: '亚太精选',
  other: '其他',
};

const STATUS_TONE = {
  开放申购: 'open',
  限大额: 'limited',
  暂停申购: 'suspended',
};

function fmtPercent(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/* ---------------- 渲染：顶栏 ---------------- */
function renderHeader() {
  const s = state.snap;
  $('#asOf').textContent = s.as_of || '—';
  $('#generatedAt').textContent = (s.generated_at || '').slice(5, 16).replace('T', ' ') || '—';

  const d = s.declared || {};
  const st = s.stats;
  const parts = [
    `监控 <strong>${st.total}</strong> 只`,
    `可申购 <strong>${(st.open || 0) + (st.limited || 0)}</strong>`,
    `暂停 <strong>${st.suspended}</strong>`,
    `场内 <strong>${st.on_exchange || 0}</strong>`,
  ];
  if (d.total_daily_limit != null)
    parts.push(`源站声明今日可购合计 <strong>${d.total_daily_limit} 元</strong>`);
  if (d.prev_changes != null)
    parts.push(`上一交易日变动 <strong>${d.prev_changes}</strong> 处（${d.prev_date || ''}）`);
  $('#ticker').innerHTML = parts.join('　·　');
}

/* ---------------- 渲染：Hero ---------------- */
function renderHero() {
  const st = state.snap.stats;
  const distSum = st.sum_us_distribution_limit_actual ?? st.sum_us_daily_limit_actual ?? st.sum_us_daily_limit;
  const distN = st.n_us_distribution_buyable_actual ?? st.n_us_buyable_actual ?? st.n_us_buyable;
  const directSum = st.sum_us_direct_limit_actual ?? st.sum_us_direct_limit;
  const directN = st.n_us_direct_buyable_actual ?? st.n_us_direct_buyable;

  $('#distributionLimit').textContent = distSum != null ? distSum.toLocaleString('zh-CN') : '—';
  $('#directLimit').textContent = directSum != null ? directSum.toLocaleString('zh-CN') : '—';
  $('#distributionNote').textContent = `${distN ?? 0} 只 · 已剔除暂停申购和购买入口关闭`;
  $('#directNote').textContent = `${directN ?? 0} 只 · 按已生效基金公司公告统计`;

  const stats = [
    { num: st.open, label: '开放', tone: 'open' },
    { num: st.limited, label: '限额', tone: 'limited' },
    { num: st.suspended, label: '暂停', tone: 'suspended' },
    { num: st.total, label: '全部', tone: '' },
  ];
  const wrap = $('#heroStats');
  wrap.innerHTML = '';
  for (const s of stats) {
    const d = el('div', 'stat');
    if (s.tone) d.dataset.tone = s.tone;
    d.append(el('span', 'stat-num', String(s.num ?? '—')), el('span', 'stat-label', s.label));
    wrap.append(d);
  }
}

function renderFocusMarkets() {
  const wrap = $('#focusMarkets');
  wrap.innerHTML = '';
  const source = state.snap.funds || [];

  for (const indexKey of ['nasdaq100', 'sp500']) {
    const funds = source.filter((fund) => fund.index_key === indexKey && !fund.on_exchange);
    const distribution = funds.filter(
      (fund) =>
        typeof fund.limit_amount === 'number' &&
        fund.status !== '暂停申购' &&
        fund.purchasable !== false
    );
    const direct = funds.filter(
      (fund) => typeof fund.direct_limit_amount === 'number' && fund.direct_status !== '暂停申购'
    );
    const distributionTotal = distribution.reduce((sum, fund) => sum + fund.limit_amount, 0);
    const directTotal = direct.reduce((sum, fund) => sum + fund.direct_limit_amount, 0);

    const row = el('button', 'focus-market');
    row.type = 'button';
    row.dataset.index = indexKey;
    row.setAttribute('aria-label', `筛选${INDEX_LABEL[indexKey]}基金`);

    const identity = el('span', 'focus-identity');
    identity.append(el('span', `focus-glyph is-${indexKey}`, indexKey === 'nasdaq100' ? 'N' : 'S'));
    const name = el('span', 'focus-name');
    name.append(el('strong', null, INDEX_LABEL[indexKey]), el('small', null, `${funds.length} 只场外份额`));
    identity.append(name);

    const channelA = el('span', 'focus-channel');
    channelA.append(el('small', null, `代销 · ${distribution.length} 只可买`), el('strong', null, `${distributionTotal.toLocaleString('zh-CN')} 元`));
    const channelB = el('span', 'focus-channel');
    channelB.append(el('small', null, `直销 · ${direct.length} 只可买`), el('strong', null, `${directTotal.toLocaleString('zh-CN')} 元`));
    const action = el('span', 'focus-action', '查看基金');
    action.append(el('b', null, '→'));
    row.append(identity, channelA, channelB, action);
    row.addEventListener('click', () => {
      state.filter.quick = indexKey;
      state.filter.index = '';
      state.page = 1;
      syncFilterControls();
      renderTable();
      $('#funds').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wrap.append(row);
  }
}

/* ---------------- 渲染：状态条 ---------------- */
function renderBars() {
  const st = state.snap.stats;
  const rows = [
    { name: '开放申购', value: st.open, color: 'var(--open)' },
    { name: '限大额', value: st.limited, color: 'var(--limited)' },
    { name: '暂停申购', value: st.suspended, color: 'var(--suspended)' },
    { name: '场内交易 / 封闭期', value: st.closed, color: 'var(--other)' },
  ];
  const total = st.total || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const wrap = $('#barChart');
  wrap.innerHTML = '';
  for (const r of rows) {
    const row = el('div', 'bar-row');
    const label = el('div', 'bar-label');
    label.innerHTML = `${r.name} <small>${((r.value / total) * 100).toFixed(1)}%</small>`;
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.background = r.color;
    fill.style.width = '0%';
    track.append(fill);
    row.append(label, track, el('div', 'bar-value', String(r.value)));
    wrap.append(row);
    requestAnimationFrame(() => {
      fill.style.width = `${(r.value / max) * 100}%`;
    });
  }

  const legend = $('#legend');
  legend.innerHTML = '';
  for (const r of rows) {
    const item = el('span', 'legend-item');
    const sw = el('span', 'legend-swatch');
    sw.style.background = r.color;
    item.append(sw, document.createTextNode(r.name));
    legend.append(item);
  }
}

/* ---------------- 过滤与排序 ---------------- */
function currentRows() {
  const { search, index, status, sort, quick } = state.filter;
  let rows = (state.snap.funds || []).slice();

  if (search) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(
      (f) => String(f.code).includes(q) || String(f.name).toLowerCase().includes(q)
    );
  }
  if (index) rows = rows.filter((f) => f.index_key === index);
  if (status) rows = rows.filter((f) => f.status === status);
  if (quick === 'buyable')
    rows = rows.filter((f) => !f.on_exchange && f.status !== '暂停申购' && f.purchasable !== false && typeof f.limit_amount === 'number');
  if (quick === 'nasdaq100' || quick === 'sp500') rows = rows.filter((f) => f.index_key === quick);
  if (quick === 'channel_split')
    rows = rows.filter((f) => typeof f.direct_limit_amount === 'number' && typeof f.limit_amount === 'number' && f.direct_limit_amount > f.limit_amount);
  if (quick === 'low_drag') rows = rows.filter((f) => f.fee_drag?.first_year_annual_rate <= 0.6);

  const numOr = (v) => (typeof v === 'number' ? v : -1);
  const cmp = {
    limit_desc: (a, b) => numOr(b.limit_amount) - numOr(a.limit_amount),
    limit_asc: (a, b) => numOr(a.limit_amount) - numOr(b.limit_amount),
    direct_desc: (a, b) => numOr(b.direct_limit_amount) - numOr(a.direct_limit_amount),
    ratio_desc: (a, b) => numOr(b.channel_ratio) - numOr(a.channel_ratio),
    tracking_asc: (a, b) => {
      const av = typeof a.tracking_error === 'number' ? a.tracking_error : Number.POSITIVE_INFINITY;
      const bv = typeof b.tracking_error === 'number' ? b.tracking_error : Number.POSITIVE_INFINITY;
      return av - bv || String(a.code).localeCompare(String(b.code));
    },
    fee_asc: (a, b) => {
      const av = a.fee_drag?.first_year_annual_rate ?? Number.POSITIVE_INFINITY;
      const bv = b.fee_drag?.first_year_annual_rate ?? Number.POSITIVE_INFINITY;
      return av - bv || String(a.code).localeCompare(String(b.code));
    },
    code_asc: (a, b) => String(a.code).localeCompare(String(b.code)),
  }[sort];
  return rows.sort(cmp);
}

/* ---------------- 渲染：表格 ---------------- */
function renderTable() {
  const rows = currentRows();
  const shown = rows.slice(0, state.page * state.pageSize);
  const hasFilters = Boolean(
    state.filter.search || state.filter.index || state.filter.status || state.filter.quick !== 'all'
  );

  $('#tableMeta').textContent = hasFilters
    ? `找到 ${rows.length} 只基金${shown.length < rows.length ? ` · 当前显示 ${shown.length} 只` : ''}`
    : `共收录 ${state.snap.funds.length} 只基金份额`;
  $('#clearFilters').hidden = !hasFilters;

  const body = $('#fundBody');
  const mobile = $('#fundListMobile');
  body.innerHTML = '';
  mobile.innerHTML = '';

  if (!shown.length) {
    const tr = el('tr');
    const td = el('td', 'empty-state');
    td.append(el('span', 'empty-icon', '⌕'), el('strong', null, '没有找到匹配的基金'), el('p', null, '换一个名称、代码或筛选条件试试。'));
    td.colSpan = 10;
    tr.append(td);
    body.append(tr);
    const mobileEmpty = el('div', 'empty-state');
    mobileEmpty.append(el('span', 'empty-icon', '⌕'), el('strong', null, '没有找到匹配的基金'), el('p', null, '换一个名称、代码或筛选条件试试。'));
    mobile.append(mobileEmpty);
    $('#moreBtn').classList.add('hidden');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const f of shown) {
    const tr = el('tr', 'is-clickable');
    if (f.status === '暂停申购') tr.classList.add('row-suspended');
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `查看 ${f.name} 详情`);

    // 代码
    tr.append(el('td', 'col-code', f.code));

    // 名称
    const tdName = el('td', 'col-name');
    const nm = el('span', 'fund-name');
    nm.append(document.createTextNode(f.name));
    if (f.channel_split) nm.append(el('span', 'tag', '渠道差'));
    tdName.append(nm);
    if (f.track_target) tdName.append(el('span', 'fund-track', f.track_target));
    tr.append(tdName);

    // 方向
    tr.append(el('td', 'col-topic', INDEX_LABEL[f.index_key] || '—'));

    // 年化跟踪偏差：数值越低，通常表示基金走势越贴近跟踪标的。
    const tdTrack = el('td', 'col-track');
    if (typeof f.tracking_error === 'number' && Number.isFinite(f.tracking_error)) {
      const tone = f.tracking_error <= 1.5 ? 'is-low' : f.tracking_error <= 3 ? 'is-mid' : 'is-high';
      const badge = el('span', `tracking-badge ${tone}`, `${f.tracking_error.toFixed(2)}%`);
      badge.title = `年化跟踪误差 ${f.tracking_error.toFixed(2)}%；数值越低通常表示越贴近跟踪标的`;
      tdTrack.append(badge);
    } else {
      const empty = el('span', 'tracking-none', '—');
      empty.title = '暂无年化跟踪误差数据';
      tdTrack.append(empty);
    }
    tr.append(tdTrack);

    // 长期持有显性年费：管理费 + 托管费 + 首年销售服务费。
    const tdFee = el('td', 'col-fee');
    if (f.fee_drag) {
      const rate = f.fee_drag.first_year_annual_rate;
      const tone = rate <= 0.6 ? 'is-low' : rate <= 1 ? 'is-mid' : 'is-high';
      const badge = el('span', `fee-drag-badge ${tone}`, `${rate.toFixed(2)}%`);
      badge.title = `首年：管理 ${f.fee_drag.management_fee.toFixed(2)}% + 托管 ${f.fee_drag.custody_fee.toFixed(2)}% + 销售服务 ${f.fee_drag.sales_service_fee.toFixed(2)}%`;
      tdFee.append(badge);
      if (f.fee_drag.sales_service_fee > 0) {
        tdFee.append(el('small', 'fee-long-rate', `1年后 ${f.fee_drag.long_term_annual_rate.toFixed(2)}%`));
      }
    } else {
      tdFee.append(el('span', 'fee-drag-none', '待补充'));
    }
    tr.append(tdFee);

    // 状态
    const tdSt = el('td', 'col-status');
    const pill = el('span', 'pill', f.status || '—');
    pill.dataset.s = f.status || '';
    tdSt.append(pill);
    tr.append(tdSt);

    // 代销限额
    const tdL = el('td', 'col-num');
    const a = fmtAmount(f.limit_amount);
    const spanA = el('span', `num ${a.cls}`, a.text);
    tdL.append(spanA);
    tr.append(tdL);

    // 直销限额
    const tdD = el('td', 'col-num');
    const b = fmtAmount(f.direct_limit_amount);
    const spanB = el('span', `num ${b.cls}`, b.text);
    if (
      typeof f.limit_amount === 'number' &&
      typeof f.direct_limit_amount === 'number' &&
      f.direct_limit_amount > f.limit_amount
    ) {
      spanB.style.color = 'var(--gold)';
      spanB.style.fontWeight = '600';
    }
    tdD.append(spanB);
    tr.append(tdD);

    // 倍数
    const tdR = el('td', 'col-ratio');
    if (f.channel_ratio) tdR.append(el('span', 'ratio-badge', `${f.channel_ratio}×`));
    else tdR.append(el('span', 'ratio-none', '—'));
    tr.append(tdR);

    // 赎回
    tr.append(el('td', 'col-redeem', f.redeem || '—'));

    tr.addEventListener('click', () => openDrawer(f));
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDrawer(f);
      }
    });
    frag.append(tr);

    const item = el('button', 'fund-list-item');
    item.type = 'button';
    item.setAttribute('aria-label', `查看 ${f.name} 详情`);
    const head = el('span', 'fund-list-head');
    const identity = el('span', 'fund-list-identity');
    identity.append(el('code', null, f.code), el('strong', null, f.name));
    const status = el('span', 'pill', f.status || '—');
    status.dataset.s = f.status || '';
    head.append(identity, status);
    const meta = el('span', 'fund-list-meta');
    meta.append(el('span', null, INDEX_LABEL[f.index_key] || '—'));
    if (typeof f.tracking_error === 'number') meta.append(el('span', null, `偏差 ${f.tracking_error.toFixed(2)}%`));
    if (f.fee_drag) meta.append(el('span', null, `磨损 ${f.fee_drag.first_year_annual_rate.toFixed(2)}%`));
    const limits = el('span', 'fund-list-limits');
    const dist = el('span');
    dist.append(el('small', null, '代销'), el('strong', null, fmtAmount(f.limit_amount).text));
    const direct = el('span');
    direct.append(el('small', null, '直销'), el('strong', null, fmtAmount(f.direct_limit_amount).text));
    limits.append(dist, direct, el('b', null, '›'));
    item.append(head, meta, limits);
    item.addEventListener('click', () => openDrawer(f));
    mobile.append(item);
  }
  body.append(frag);

  const more = $('#moreBtn');
  if (shown.length < rows.length) more.classList.remove('hidden');
  else more.classList.add('hidden');
}

/* ---------------- 渲染：变动时间线 ---------------- */
function renderChanges() {
  const list = state.changes || [];
  $('#changeCount').textContent = String(list.length);
  const wrap = $('#timeline');
  wrap.innerHTML = '';

  if (!list.length) {
    wrap.append(el('div', 'empty', '暂无变动记录。第一次采集会建立基线，之后每次采集检测到的额度变化都会记录在这里。'));
    return;
  }

  const SEV = { high: '状态变更', medium: '额度调整', low: '其他' };
  const frag = document.createDocumentFragment();

  for (const c of list) {
    const item = el('div', 'tl-item');
    item.append(el('div', 'tl-date', (c.detected_at || '').slice(5, 16)));

    const body = el('div', 'tl-body');
    const head = el('div', 'tl-head');
    head.append(el('span', 'tl-name', c.name), el('span', 'tl-code', c.code));
    const sev = el('span', `sev-tag sev-${c.severity || 'low'}`, SEV[c.severity] || '变动');
    head.append(sev);
    body.append(head);

    const fields = el('div', 'tl-fields');
    for (const fd of c.fields || []) {
      const row = el('div', 'tl-field');
      row.append(el('span', 'tl-field-label', fd.label));
      row.append(el('span', 'tl-arrow', `${fd.old_text} →`));
      const cls = fd.direction === 'up' ? 'delta-up' : fd.direction === 'down' ? 'delta-down' : 'delta-flat';
      row.append(el('span', `delta ${cls}`, fd.new_text));
      if (fd.direction && typeof fd.old_val === 'number' && typeof fd.new_val === 'number') {
        const diff = fd.new_val - fd.old_val;
        const sign = diff > 0 ? '+' : '';
        row.append(el('span', `delta ${cls}`, `${sign}${diff.toLocaleString('zh-CN')}`));
      }
      fields.append(row);
    }
    body.append(fields);
    item.append(body);
    frag.append(item);
  }
  wrap.append(frag);
}

/* ---------------- 抽屉详情 ---------------- */
function renderPerformanceSection(section, f, profile) {
  section.innerHTML = '';
  section.append(el('h4', null, '阶段表现 · 最新净值口径'));
  const p = profile?.performance || f.performance || {};
  const metrics = [
    ['近1月', p.one_month],
    ['近3月', p.three_months],
    ['近6月', p.six_months],
    ['近1年', p.one_year],
    ['近3年', p.three_years],
    ['成立以来', p.since_inception],
  ];
  const grid = el('div', 'perf-grid');
  for (const [label, value] of metrics) {
    const card = el('div', 'perf-card');
    const tone = value > 0 ? ' is-up' : value < 0 ? ' is-down' : '';
    card.append(el('span', 'perf-label', label), el('strong', `perf-value${tone}`, fmtPercent(value)));
    grid.append(card);
  }
  section.append(grid);

  if (profile) {
    const facts = el('dl', 'profile-facts');
    const rows = [
      ['成立日', profile.inception_date || '—'],
      ['基金规模', profile.scale_billion != null ? `${profile.scale_billion} 亿元` : '—'],
      ['管理费率 / 年', profile.management_fee != null ? `${profile.management_fee}%` : '—'],
      ['托管费率 / 年', profile.custody_fee != null ? `${profile.custody_fee}%` : '—'],
      ['销售服务费率 / 年', profile.sales_service_fee != null ? `${profile.sales_service_fee}%` : '—'],
      ['基金类型', profile.fund_type || '—'],
    ];
    for (const [k, v] of rows) {
      const item = el('div', 'profile-fact');
      item.append(el('dt', null, k), el('dd', null, v));
      facts.append(item);
    }
    section.append(facts);
  }
  const asOf = p.as_of ? `业绩截至 ${p.as_of}` : '业绩以源站最新净值为准';
  const scaleAsOf = profile?.scale_as_of || p.scale_as_of;
  section.append(el('p', 'dw-note', `${asOf}${scaleAsOf ? ` · 规模截至 ${scaleAsOf}` : ''}。过往业绩不预示未来表现。`));
}

function calculateFeeDrag(profile) {
  const management = profile?.management_fee == null ? Number.NaN : Number(profile.management_fee);
  const custody = profile?.custody_fee == null ? Number.NaN : Number(profile.custody_fee);
  if (!Number.isFinite(management) || !Number.isFinite(custody)) return null;
  const rawSales = profile?.sales_service_fee == null ? Number.NaN : Number(profile.sales_service_fee);
  const sales = Number.isFinite(rawSales) ? rawSales : 0;
  const baseAnnual = management + custody;
  const firstYearAnnual = baseAnnual + sales;
  const monthlyContribution = 1000;
  const simulations = [1, 3, 5, 10].map((years) => {
    const months = years * 12;
    let estimatedValue = 0;
    for (let month = 0; month < months; month += 1) {
      const holdingMonths = months - month;
      const baseFactor = (1 - baseAnnual / 100) ** (holdingMonths / 12);
      const salesFactor = (1 - sales / 100) ** (Math.min(holdingMonths, 12) / 12);
      estimatedValue += monthlyContribution * baseFactor * salesFactor;
    }
    const contributed = monthlyContribution * months;
    const estimatedCost = contributed - estimatedValue;
    return {
      years,
      contributed,
      estimated_cost: Math.round(estimatedCost),
      estimated_cost_rate: +((estimatedCost / contributed) * 100).toFixed(2),
    };
  });
  return {
    management_fee: management,
    custody_fee: custody,
    sales_service_fee: sales,
    first_year_annual_rate: firstYearAnnual,
    long_term_annual_rate: baseAnnual,
    monthly_contribution: monthlyContribution,
    simulations,
  };
}

function renderCostDragSection(section, f, profile) {
  section.innerHTML = '';
  section.append(el('h4', null, '长期定投磨损 · 显性费用拆解'));
  const drag = profile?.fee_drag || f.fee_drag || calculateFeeDrag(profile);
  if (!drag) {
    section.append(el('p', 'dw-note', '该基金费率资料尚未补齐，暂时无法估算长期磨损。'));
    return;
  }

  const overview = el('div', 'fee-overview');
  const first = el('div', 'fee-overview-card is-primary');
  first.append(el('span', null, '首年持续费率'), el('strong', null, `${drag.first_year_annual_rate.toFixed(2)}%`));
  const ongoing = el('div', 'fee-overview-card');
  ongoing.append(el('span', null, '单笔持有满1年后'), el('strong', null, `${drag.long_term_annual_rate.toFixed(2)}% / 年`));
  overview.append(first, ongoing);
  section.append(overview);

  const breakdown = el('div', 'fee-breakdown');
  for (const [label, value, note] of [
    ['管理费', drag.management_fee, '持续计提'],
    ['托管费', drag.custody_fee, '持续计提'],
    ['销售服务费', drag.sales_service_fee, drag.sales_service_fee > 0 ? '每笔前1年' : '不收取'],
  ]) {
    const item = el('div', 'fee-breakdown-item');
    item.append(el('span', null, label), el('strong', null, `${value.toFixed(2)}%`), el('small', null, note));
    breakdown.append(item);
  }
  section.append(breakdown);

  const simTitle = el('div', 'fee-sim-title');
  simTitle.append(el('strong', null, '每月定投 1,000 元的累计费用估算'), el('span', null, '假设市场收益为 0'));
  section.append(simTitle);
  const simGrid = el('div', 'fee-sim-grid');
  for (const row of drag.simulations || []) {
    const card = el('div', 'fee-sim-card');
    card.append(
      el('span', null, `${row.years} 年`),
      el('strong', null, `约 ${row.estimated_cost.toLocaleString('zh-CN')} 元`),
      el('small', null, `占累计投入 ${row.estimated_cost_rate.toFixed(2)}%`)
    );
    simGrid.append(card);
  }
  section.append(simGrid);

  const tracking = f.tracking_error != null ? `跟踪误差 ${Number(f.tracking_error).toFixed(2)}% 仅作为稳定性指标，未直接计入费用。` : '';
  section.append(
    el(
      'p',
      'dw-note fee-method-note',
      `估算已计管理费、托管费，并按每笔份额前 1 年计销售服务费；不含申购/赎回费、渠道折扣、基金交易成本、税费及汇率影响。${tracking}`
    )
  );
}

function renderFundHistory(section, history) {
  section.innerHTML = '';
  section.append(el('h4', null, '额度变化历史 · 双渠道'));
  const points = history?.points || [];
  if (!points.length) {
    section.append(el('p', 'dw-note', '暂无历史记录；完成每日采集后会从本站启用之日起持续积累。'));
    return;
  }
  const list = el('div', 'fund-history');
  for (const point of points) {
    const item = el('div', 'fund-history-item');
    const marker = el('span', 'fund-history-dot');
    const content = el('div', 'fund-history-content');
    const head = el('div', 'fund-history-head');
    head.append(el('time', null, point.date), el('strong', null, point.status || '—'));
    if (point.current) head.append(el('span', 'current-tag', '当前'));
    content.append(head);
    const channels = el('div', 'fund-history-channels');
    channels.append(
      el(
        'span',
        null,
        `代销 ${point.purchasable === false ? '入口关闭' : point.status || '—'} · ${fmtAmount(point.distribution_limit).text}`
      ),
      el('span', null, `直销 ${point.direct_status || '—'} · ${fmtAmount(point.direct_limit).text}`)
    );
    content.append(channels);
    item.append(marker, content);
    list.append(item);
  }
  section.append(list);
  section.append(
    el(
      'p',
      'dw-note',
      `本站记录区间 ${history.observed_from || '—'} 至 ${history.observed_to || '—'}；仅展示状态或额度发生变化的节点。`
    )
  );
}

async function loadFundExtras(code, f, costSection, performanceSection, historySection) {
  const [profileResult, historyResult] = await Promise.allSettled([
    fetchJson(
      `/api/fund-profile?code=${encodeURIComponent(code)}`,
      `data/profiles/${encodeURIComponent(code)}.json`
    ),
    fetchJson(
      `/api/fund-history?code=${encodeURIComponent(code)}`,
      `data/fund-history/${encodeURIComponent(code)}.json`
    ),
  ]);
  if ($('#drawer').dataset.fundCode !== code) return;

  if (profileResult.status === 'fulfilled' && profileResult.value.ok) {
    const profile = profileResult.value.profile;
    renderCostDragSection(costSection, f, profile);
    renderPerformanceSection(performanceSection, f, profile);
  } else if (!f.performance) {
    performanceSection.innerHTML = '';
    performanceSection.append(el('h4', null, '阶段表现'));
    performanceSection.append(el('p', 'dw-note', '业绩资料暂时加载失败，请稍后重试。'));
  }

  if (historyResult.status === 'fulfilled' && historyResult.value.ok) {
    renderFundHistory(historySection, historyResult.value.history);
  } else {
    historySection.innerHTML = '';
    historySection.append(el('h4', null, '额度变化历史'));
    historySection.append(el('p', 'dw-note', '历史资料暂时加载失败，请稍后重试。'));
  }
}

function activateDrawerTab(name, focus = false) {
  const drawer = $('#drawer');
  drawer.querySelectorAll('[role="tab"]').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  drawer.querySelectorAll('.drawer-tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
}

function createDrawerTabs(items) {
  const tabs = el('div', 'drawer-tabs');
  tabs.setAttribute('role', 'tablist');
  items.forEach(([key, label], index) => {
    const tab = el('button', `drawer-tab${index === 0 ? ' is-active' : ''}`, label);
    tab.type = 'button';
    tab.dataset.tab = key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(index === 0));
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener('click', () => activateDrawerTab(key));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = (index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
      activateDrawerTab(items[next][0], true);
    });
    tabs.append(tab);
  });
  return tabs;
}

function openDrawer(f, options = {}) {
  const drawer = $('#drawer');
  const body = $('#drawerBody');
  if (drawer.hidden) state.lastFocus = document.activeElement;
  body.innerHTML = '';
  drawer.dataset.fundCode = f.code;
  state.returnChannel = options.returnChannel || null;
  const back = $('#drawerBack');
  back.hidden = !state.returnChannel;
  back.onclick = state.returnChannel ? () => openChannelBreakdown(state.returnChannel) : null;
  $('.drawer-context').textContent = '基金详情';

  const head = el('header', 'drawer-hero');
  const titleRow = el('div', 'drawer-title-row');
  titleRow.append(el('h3', 'dw-title', f.name));
  const statusPill = el('span', 'pill', f.status || '—');
  statusPill.dataset.s = f.status || '';
  titleRow.append(statusPill);
  head.append(titleRow, el('p', 'dw-sub', `${f.code} · ${INDEX_LABEL[f.index_key] || '未分类'}${f.track_target ? ` · ${f.track_target}` : ''}`));
  body.append(head);

  body.append(
    createDrawerTabs([
      ['overview', '申购概览'],
      ['cost', '费用磨损'],
      ['performance', '阶段表现'],
      ['history', '额度历史'],
    ])
  );

  const panels = el('div', 'drawer-panels');
  const overviewPanel = el('div', 'drawer-tab-panel');
  overviewPanel.dataset.panel = 'overview';
  const costPanel = el('div', 'drawer-tab-panel');
  costPanel.dataset.panel = 'cost';
  costPanel.hidden = true;
  const performancePanel = el('div', 'drawer-tab-panel');
  performancePanel.dataset.panel = 'performance';
  performancePanel.hidden = true;
  const historyPanel = el('div', 'drawer-tab-panel');
  historyPanel.dataset.panel = 'history';
  historyPanel.hidden = true;
  panels.append(overviewPanel, costPanel, performancePanel, historyPanel);
  body.append(panels);

  // 双口径额度对比
  const sec1 = el('div', 'dw-section');
  sec1.append(el('h4', null, '今天可以买多少'));
  const isHigherDirect =
    typeof f.limit_amount === 'number' &&
    typeof f.direct_limit_amount === 'number' &&
    f.direct_limit_amount > f.limit_amount;
  const limits = el('div', 'dw-limits');
  const mk = (label, v, strong) => {
    const box = el('div', `dw-limit${strong ? ' is-strong' : ''}`);
    box.append(el('span', 'dw-limit-label', label));
    const a = fmtAmount(v);
    const val = el('div', 'dw-limit-value', a.text);
    if (a.cls === 'num-none') val.style.color = 'var(--mute-2)';
    box.append(val);
    return box;
  };
  limits.append(mk('代销渠道（天天基金 / 支付宝）', f.limit_amount, false));
  limits.append(mk('直销渠道（基金公司官网 / APP）', f.direct_limit_amount, isHigherDirect));
  sec1.append(limits);

  if (f.channel_ratio) {
    sec1.append(
      el(
        'p',
        'dw-note',
        `同一只基金在直销渠道可买金额是代销渠道的 ${f.channel_ratio} 倍。${f.channel_note || ''}`
      )
    );
  } else if (f.channel_note && f.channel_note !== '—') {
    sec1.append(el('p', 'dw-note', f.channel_note));
  }
  if (f.purchasable === false) {
    const warn = el('p', 'dw-note', '注意：页面标注该基金暂不开放购买，限额数字可能不代表实际可购金额。');
    warn.style.color = 'var(--suspended)';
    sec1.append(warn);
  }
  overviewPanel.append(sec1);

  // 长期定投显性费用磨损。
  const costSec = el('div', 'dw-section');
  if (f.fee_drag) renderCostDragSection(costSec, f, null);
  else {
    costSec.append(el('h4', null, '长期定投磨损 · 显性费用拆解'));
    costSec.append(el('p', 'dw-note loading-line', '正在读取管理费、托管费和销售服务费…'));
  }
  costPanel.append(costSec);

  // 阶段收益及费率资料：先展示快照里已有的值，再按需刷新完整概况。
  const perfSec = el('div', 'dw-section');
  if (f.performance) renderPerformanceSection(perfSec, f, null);
  else {
    perfSec.append(el('h4', null, '阶段表现 · 最新净值口径'));
    perfSec.append(el('p', 'dw-note loading-line', '正在加载近1月、近1年、近3年和成立以来表现…'));
  }
  performancePanel.append(perfSec);

  // 基础信息
  const sec2 = el('div', 'dw-section');
  sec2.append(el('h4', null, '基金与额度信息'));
  const grid = el('dl', 'dw-grid');
  const cells = [
    ['代销申购状态', f.status || '—', f.status === '限大额' || f.status === '开放申购'],
    ['直销公告状态', f.direct_status || '—', f.direct_status === '限大额' || f.direct_status === '开放申购'],
    ['赎回状态', f.redeem || '—', false],
    ['跟踪标的', f.track_target || '—', false],
    ['年化跟踪误差', f.tracking_error != null ? `${f.tracking_error}%` : '—', false],
    ['公告核对日期', f.announcement_date || '—', false],
    ['渠道额度差异', f.channel_split ? '有' : '无', f.channel_split],
  ];
  for (const [k, v, hl] of cells) {
    const box = el('div', 'dw-cell');
    box.append(el('dt', null, k));
    box.append(el('dd', hl ? 'hl' : null, String(v)));
    grid.append(box);
  }
  sec2.append(grid);
  overviewPanel.append(sec2);

  const historySec = el('div', 'dw-section');
  historySec.append(el('h4', null, '额度变化历史 · 双渠道'));
  historySec.append(el('p', 'dw-note loading-line', '正在读取本站留存的每日额度快照…'));
  historyPanel.append(historySec);

  // 链接
  const sec3 = el('div', 'dw-section');
  sec3.append(el('h4', null, '继续核对'));
  const links = el('div', 'dw-links');
  const addLink = (label, url) => {
    if (!url) return;
    const a = el('a', null, label);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.append(a);
  };
  addLink('天天基金档案页 →', f.fund_url);
  addLink('基金基本概况与费率 →', `https://fundf10.eastmoney.com/jbgk_${f.code}.html`);
  addLink('基金公司限额公告原文 →', f.announcement_url);
  addLink('持仓明细 →', `https://fundf10.eastmoney.com/ccmx_${f.code}.html`);
  sec3.append(links);
  if (f.verified_by_announcement) {
    sec3.append(el('p', 'dw-note', '该条限额已由源站对照基金公司公告原文核验（公告直核）。'));
  }
  overviewPanel.append(sec3);

  drawer.hidden = false;
  drawer.querySelector('.drawer-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  loadFundExtras(f.code, f, costSec, perfSec, historySec).catch(console.error);
}

function closeDrawer() {
  const drawer = $('#drawer');
  drawer.classList.remove('is-open');
  drawer.hidden = true;
  drawer.dataset.fundCode = '';
  document.body.style.overflow = '';
  state.returnChannel = null;
  if (state.lastFocus?.focus) state.lastFocus.focus();
}

/** 展示纳指100与标普500方向某一渠道的逐只可投明细。 */
function openChannelBreakdown(channel) {
  const isDirect = channel === 'direct';
  const amountKey = isDirect ? 'direct_limit_amount' : 'limit_amount';
  const funds = state.snap.funds
    .filter(
      (f) =>
        ['nasdaq100', 'sp500'].includes(f.index_key) &&
        !f.on_exchange &&
        typeof f[amountKey] === 'number' &&
        (isDirect
          ? f.direct_status !== '暂停申购'
          : f.status !== '暂停申购' && f.purchasable !== false)
    )
    .sort((a, b) => {
      const topicOrder = { nasdaq100: 0, sp500: 1 };
      return topicOrder[a.index_key] - topicOrder[b.index_key] || b[amountKey] - a[amountKey] || a.code.localeCompare(b.code);
    });

  const total = funds.reduce((sum, f) => sum + f[amountKey], 0);
  const drawer = $('#drawer');
  if (drawer.hidden) state.lastFocus = document.activeElement;
  drawer.dataset.fundCode = '';
  state.returnChannel = null;
  $('#drawerBack').hidden = true;
  $('.drawer-context').textContent = isDirect ? '直销清单' : '代销清单';
  const body = $('#drawerBody');
  body.innerHTML = '';

  const head = el('header', 'drawer-hero');
  head.append(el('h3', 'dw-title', isDirect ? '直销渠道可投基金' : '代销渠道可投基金'));
  head.append(
    el(
      'p',
      'dw-sub',
      `纳指100 + 标普500 · ${funds.length} 只 · 单日合计 ${total.toLocaleString('zh-CN')} 元`
    )
  );
  body.append(head);

  const summary = el('div', `quota-summary${isDirect ? ' is-direct' : ''}`);
  summary.append(el('span', 'quota-summary-label', isDirect ? '基金公司官网 / APP' : '第三方代销平台'));
  const number = el('strong', null, total.toLocaleString('zh-CN'));
  number.append(el('small', null, ' 元 / 日'));
  summary.append(number);
  summary.append(
    el(
      'p',
      null,
      isDirect
        ? '按已生效基金公司公告统计；代销入口关闭不代表直销渠道关闭。'
        : '已剔除暂停申购以及购买入口显示“暂不开放购买”的基金。'
    )
  );
  body.append(summary);

  for (const indexKey of ['nasdaq100', 'sp500']) {
    const group = funds.filter((f) => f.index_key === indexKey);
    if (!group.length) continue;
    const sec = el('div', 'dw-section quota-section');
    const groupTotal = group.reduce((sum, f) => sum + f[amountKey], 0);
    sec.append(el('h4', null, `${INDEX_LABEL[indexKey]} · ${group.length} 只 · ${groupTotal.toLocaleString('zh-CN')} 元`));
    const list = el('div', 'quota-list');
    for (const f of group) {
      const row = el('button', 'quota-row');
      row.type = 'button';
      row.title = '查看该基金双渠道详情';
      const identity = el('span', 'quota-identity');
      identity.append(el('code', null, f.code), el('span', null, f.name));
      const amount = el('strong', 'quota-amount', `${f[amountKey].toLocaleString('zh-CN')} 元`);
      row.append(identity, amount);
      row.addEventListener('click', () => openDrawer(f, { returnChannel: channel }));
      list.append(row);
    }
    sec.append(list);
    body.append(sec);
  }

  body.append(el('p', 'dw-note quota-footnote', '点击任意基金，可继续查看代销/直销额度对照及公告原文。'));
  drawer.hidden = false;
  drawer.querySelector('.drawer-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => drawer.classList.add('is-open'));
}

/* ---------------- 筛选控件 ---------------- */
function syncFilterControls() {
  $('#search').value = state.filter.search;
  $('#indexFilter').value = state.filter.index;
  $('#statusFilter').value = state.filter.status;
  $('#sortBy').value = state.filter.sort;
  document.querySelectorAll('[data-quick]').forEach((chip) => {
    const active = chip.dataset.quick === state.filter.quick;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}

function updateNetworkStatus() {
  const status = $('#networkStatus');
  if (!status) return;
  const offline = !navigator.onLine || state.cachedOffline;
  status.classList.toggle('is-offline', offline);
  const label = status.querySelector('b');
  if (label) label.textContent = offline ? '离线浏览' : '已同步';
}

function initControls() {
  const idxSel = $('#indexFilter');
  const counts = state.snap.stats.by_index || {};
  idxSel.innerHTML = '<option value="">全部方向</option>';
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const o = el('option', null, `${INDEX_LABEL[k] || k}（${v}）`);
    o.value = k;
    idxSel.append(o);
  }

  const stSel = $('#statusFilter');
  stSel.innerHTML = '<option value="">全部状态</option>';
  const st = state.snap.stats;
  for (const [k, v] of [
    ['开放申购', st.open],
    ['限大额', st.limited],
    ['暂停申购', st.suspended],
  ]) {
    const o = el('option', null, `${k}（${v}）`);
    o.value = k;
    stSel.append(o);
  }

  syncFilterControls();
  if (state.controlsReady) return;
  state.controlsReady = true;

  $('#search').addEventListener('input', (e) => {
    state.filter.search = e.target.value;
    state.page = 1;
    renderTable();
  });
  idxSel.addEventListener('change', (e) => {
    state.filter.index = e.target.value;
    state.page = 1;
    renderTable();
  });
  stSel.addEventListener('change', (e) => {
    state.filter.status = e.target.value;
    state.page = 1;
    renderTable();
  });
  $('#sortBy').addEventListener('change', (e) => {
    state.filter.sort = e.target.value;
    state.page = 1;
    renderTable();
  });
  document.querySelectorAll('[data-quick]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter.quick = chip.dataset.quick;
      state.filter.index = '';
      state.page = 1;
      syncFilterControls();
      renderTable();
    });
  });
  $('#clearFilters').addEventListener('click', () => {
    state.filter = { search: '', index: '', status: '', sort: 'limit_desc', quick: 'all' };
    state.page = 1;
    syncFilterControls();
    renderTable();
    $('#search').focus();
  });
  $('#moreBtn').addEventListener('click', () => {
    state.page += 1;
    renderTable();
  });
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => {
    const drawer = $('#drawer');
    if (e.key === '/' && drawer.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      $('#search').focus();
    }
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
    if (e.key === 'Tab' && !drawer.hidden) {
      const focusable = [...drawer.querySelectorAll('button:not([hidden]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.disabled && node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  document.querySelectorAll('.channel-total').forEach((card) => {
    card.onclick = () => openChannelBreakdown(card.dataset.channel);
  });

  // Pages 构建会移除管理员采集入口；本地服务仍保留“立即采集”。
  $('#collectBtn')?.addEventListener('click', runCollect);

  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('qdii-theme', next); } catch {}
  });

  window.addEventListener('online', () => {
    state.cachedOffline = false;
    updateNetworkStatus();
  });
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();

  const navLinks = [...document.querySelectorAll('.nav-link')];
  const sections = navLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`));
    },
    { rootMargin: '-25% 0px -65% 0px', threshold: [0, 0.1, 0.4] }
  );
  sections.forEach((section) => observer.observe(section));
}

/* ---------------- 采集 ---------------- */
async function runCollect() {
  const btn = $('#collectBtn');
  const label = $('#collectLabel');
  btn.disabled = true;
  label.textContent = '采集中…';
  try {
    const res = await fetch('/api/collect', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '采集失败');
    label.textContent = `完成 · ${data.changes} 处变动`;
    await load();
    setTimeout(() => {
      label.textContent = '立即采集';
    }, 2600);
  } catch (e) {
    label.textContent = '采集失败';
    console.error(e);
    setTimeout(() => {
      label.textContent = '立即采集';
    }, 2600);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 加载 ---------------- */
function showAppError(message) {
  const status = $('#appStatus');
  status.hidden = false;
  status.className = 'app-status is-error';
  status.innerHTML = '';
  status.append(el('strong', null, '数据暂时没有加载出来'), el('span', null, message || '请检查网络后重试。'));
  const retry = el('button', 'button button-secondary', '重新加载');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    status.className = 'app-status is-loading';
    status.innerHTML = '<span class="status-loader" aria-hidden="true"></span><span>正在重新读取数据</span>';
    load().catch((error) => showAppError(error.message));
  });
  status.append(retry);
}

async function load() {
  const data = await fetchJson('/api/snapshot', 'data/snapshot.json');

  if (!data.ok) {
    showAppError(data.error || '尚无可用数据');
    $('#ticker').textContent = data.error || '尚无数据';
    $('#heroStats').innerHTML = '';
    $('#fundBody').innerHTML = '';
    $('#timeline').innerHTML = '';
    const tr = el('tr');
    const td = el('td', 'empty', `${data.error || '尚无数据'}。点击右上角“立即采集”开始首次扫描。`);
    td.colSpan = 10;
    tr.append(td);
    $('#fundBody').append(tr);
    return;
  }

  state.snap = data.snapshot;
  state.changes = data.changes || [];
  state.staticMode = Boolean(data.static_mode);

  renderHeader();
  renderHero();
  renderFocusMarkets();
  renderBars();
  renderTable();
  renderChanges();
  initControls();
  $('#appStatus').hidden = true;

}

/* ---------------- 安装为桌面应用（PWA） ---------------- */
let deferredInstallPrompt = null;

function initPwa() {
  const installBtn = $('#pwaInstallBtn');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(new URL('./service-worker.js', document.baseURI))
        .catch((error) => console.warn('Service worker 注册失败：', error));
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
  });

  if (window.matchMedia('(display-mode: standalone)').matches && installBtn) {
    installBtn.hidden = true;
  }
}

initPwa();

load().catch((e) => {
  console.error(e);
  $('#ticker').textContent = '加载失败：' + e.message;
  showAppError(navigator.onLine ? e.message : '当前处于离线状态，且尚未缓存可用数据。');
});
