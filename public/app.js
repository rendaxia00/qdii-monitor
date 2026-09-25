/* QDII 申购限额监控台 · 前端逻辑 */

const state = {
  snap: null,
  changes: [],
  staticMode: false,
  filter: { search: '', index: '', status: '', sort: 'limit_desc' },
  page: 1,
  pageSize: 80,
};

/** 本地服务优先；GitHub Pages 上回退到构建时生成的静态 JSON。 */
async function fetchJson(primaryUrl, staticPath, options) {
  if (!state.staticMode) {
    try {
      const res = await fetch(primaryUrl, options);
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('application/json')) return await res.json();
    } catch {}
  }
  const fallback = new URL(staticPath, document.baseURI);
  const res = await fetch(fallback);
  if (!res.ok) throw new Error(`静态数据加载失败：${res.status}`);
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
(function initTheme() {
  try {
    const saved = localStorage.getItem('qdii-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', 'dark');
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
  $('#generatedAt').textContent = (s.generated_at || '').slice(5) || '—';

  const d = s.declared || {};
  const st = s.stats;
  const parts = [
    `收录 <strong>${st.total}</strong> 只`,
    `开放申购 <strong>${st.open}</strong>`,
    `限大额 <strong>${st.limited}</strong>`,
    `暂停申购 <strong>${st.suspended}</strong>`,
    `场内份额 <strong>${st.on_exchange || 0}</strong>`,
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
    { num: st.total, label: '收录基金份额', tone: '' },
    { num: st.open, label: '开放申购', tone: 'open' },
    { num: st.limited, label: '限大额', tone: 'limited' },
    { num: st.suspended, label: '暂停申购', tone: 'suspended' },
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
  const { search, index, status, sort } = state.filter;
  let rows = (state.snap.funds || []).slice();

  if (search) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(
      (f) => String(f.code).includes(q) || String(f.name).toLowerCase().includes(q)
    );
  }
  if (index) rows = rows.filter((f) => f.index_key === index);
  if (status) rows = rows.filter((f) => f.status === status);

  const numOr = (v) => (typeof v === 'number' ? v : -1);
  const cmp = {
    limit_desc: (a, b) => numOr(b.limit_amount) - numOr(a.limit_amount),
    limit_asc: (a, b) => numOr(a.limit_amount) - numOr(b.limit_amount),
    direct_desc: (a, b) => numOr(b.direct_limit_amount) - numOr(a.direct_limit_amount),
    ratio_desc: (a, b) => numOr(b.channel_ratio) - numOr(a.channel_ratio),
    code_asc: (a, b) => String(a.code).localeCompare(String(b.code)),
  }[sort];
  return rows.sort(cmp);
}

/* ---------------- 渲染：表格 ---------------- */
function renderTable() {
  const rows = currentRows();
  const shown = rows.slice(0, state.page * state.pageSize);

  $('#tableMeta').textContent = `共 ${rows.length} 条匹配 · 显示前 ${shown.length} 条 · 共收录 ${state.snap.funds.length} 只`;

  const body = $('#fundBody');
  body.innerHTML = '';

  if (!shown.length) {
    const tr = el('tr');
    const td = el('td', 'empty', '没有匹配的基金，试试调整筛选条件');
    td.colSpan = 8;
    tr.append(td);
    body.append(tr);
    $('#moreBtn').classList.add('hidden');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const f of shown) {
    const tr = el('tr', 'is-clickable');
    if (f.status === '暂停申购') tr.classList.add('row-suspended');

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
    frag.append(tr);
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

/* ---------------- 渲染：来源 ---------------- */
function renderSources() {
  const s = state.snap;
  const d = s.declared || {};
  const wrap = $('#sources');
  wrap.innerHTML = '';

  const cards = [
    {
      title: '直销口径 · 基金销售公告',
      desc: '从东方财富基金销售公告列表及公告正文提取直销/代销渠道额度；基金范围和主题由本地目录维护。无法高置信解析时沿用最近一次已核验值。',
      url: s.sources?.direct?.url,
      meta: `数据日期 ${s.sources?.direct?.as_of || '—'}`,
    },
    {
      title: '代销口径 · 天天基金',
      desc: '基金档案页的实时“交易状态 / 单日累计购买上限”，代表第三方平台（支付宝等）可申购额度。',
      url: s.sources?.distribution?.url,
      meta: `采集于 ${s.generated_at || '—'}`,
    },
    {
      title: '采集统计',
      desc: `成功解析 ${s.stats.total} 只基金份额，其中 ${s.stats.on_exchange || 0} 只为场内交易份额（不占用场外申购额度）。直销与代销渠道不一致 ${d.channel_mismatch ?? '—'} 只。`,
      url: null,
      meta: s.collect_errors?.length ? `采集失败 ${s.collect_errors.length} 只` : '全部解析成功',
    },
  ];

  for (const c of cards) {
    const card = el('div', 'src-card');
    card.append(el('h3', null, c.title), el('p', null, c.desc));
    if (c.url) {
      const a = el('a', null, c.url);
      a.href = c.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      card.append(a);
    }
    card.append(el('span', 'src-meta', c.meta));
    wrap.append(card);
  }
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

async function loadFundExtras(code, f, performanceSection, historySection) {
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
    renderPerformanceSection(performanceSection, f, profileResult.value.profile);
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

function openDrawer(f) {
  const drawer = $('#drawer');
  const body = $('#drawerBody');
  body.innerHTML = '';
  drawer.dataset.fundCode = f.code;

  body.append(el('h3', 'dw-title', f.name));
  body.append(el('p', 'dw-sub', `${f.code} · ${INDEX_LABEL[f.index_key] || '未分类'}`));

  // 双口径额度对比
  const sec1 = el('div', 'dw-section');
  sec1.append(el('h4', null, '单日申购限额 · 双口径对照'));
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
  body.append(sec1);

  // 阶段收益及费率资料：先展示快照里已有的值，再按需刷新完整概况。
  const perfSec = el('div', 'dw-section');
  if (f.performance) renderPerformanceSection(perfSec, f, null);
  else {
    perfSec.append(el('h4', null, '阶段表现 · 最新净值口径'));
    perfSec.append(el('p', 'dw-note loading-line', '正在加载近1月、近1年、近3年和成立以来表现…'));
  }
  body.append(perfSec);

  // 基础信息
  const sec2 = el('div', 'dw-section');
  sec2.append(el('h4', null, '基础信息'));
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
  body.append(sec2);

  const historySec = el('div', 'dw-section');
  historySec.append(el('h4', null, '额度变化历史 · 双渠道'));
  historySec.append(el('p', 'dw-note loading-line', '正在读取本站留存的每日额度快照…'));
  body.append(historySec);

  // 链接
  const sec3 = el('div', 'dw-section');
  sec3.append(el('h4', null, '原始数据'));
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
  body.append(sec3);

  drawer.hidden = false;
  drawer.querySelector('.drawer-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  loadFundExtras(f.code, f, perfSec, historySec).catch(console.error);
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer').dataset.fundCode = '';
  document.body.style.overflow = '';
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
  drawer.dataset.fundCode = '';
  const body = $('#drawerBody');
  body.innerHTML = '';

  body.append(el('h3', 'dw-title', isDirect ? '直销渠道可投基金' : '代销渠道可投基金'));
  body.append(
    el(
      'p',
      'dw-sub',
      `纳指100 + 标普500 · ${funds.length} 只 · 单日合计 ${total.toLocaleString('zh-CN')} 元`
    )
  );

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
      row.addEventListener('click', () => openDrawer(f));
      list.append(row);
    }
    sec.append(list);
    body.append(sec);
  }

  body.append(el('p', 'dw-note quota-footnote', '点击任意基金，可继续查看代销/直销额度对照及公告原文。'));
  drawer.hidden = false;
  drawer.querySelector('.drawer-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

/* ---------------- 筛选控件 ---------------- */
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
  $('#moreBtn').addEventListener('click', () => {
    state.page += 1;
    renderTable();
  });
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  document.querySelectorAll('.channel-total').forEach((card) => {
    card.onclick = () => openChannelBreakdown(card.dataset.channel);
  });

  // Pages 构建会移除管理员采集入口；本地服务仍保留“立即采集”。
  $('#collectBtn')?.addEventListener('click', runCollect);
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
async function load() {
  const data = await fetchJson('/api/snapshot', 'data/snapshot.json');

  if (!data.ok) {
    $('#ticker').textContent = data.error || '尚无数据';
    $('#heroStats').innerHTML = '';
    $('#fundBody').innerHTML = '';
    $('#timeline').innerHTML = '';
    const tr = el('tr');
    const td = el('td', 'empty', `${data.error || '尚无数据'}。点击右上角“立即采集”开始首次扫描。`);
    td.colSpan = 8;
    tr.append(td);
    $('#fundBody').append(tr);
    return;
  }

  state.snap = data.snapshot;
  state.changes = data.changes || [];
  state.staticMode = Boolean(data.static_mode);

  renderHeader();
  renderHero();
  renderBars();
  renderTable();
  renderChanges();
  renderSources();
  initControls();

}

load().catch((e) => {
  console.error(e);
  $('#ticker').textContent = '加载失败：' + e.message;
});
