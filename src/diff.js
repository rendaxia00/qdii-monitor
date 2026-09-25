/**
 * 变动检测：对比本次采集结果与上一次基线，产出结构化变更列表。
 *
 * 只追踪 4 个真正影响“今天能不能买、能买多少”的字段：
 *   status                 申购状态（开放/限大额/暂停）
 *   limit_amount           代销日累计限额
 *   direct_limit_amount    直销日累计限额
 *   redeem                 赎回状态
 */

const TRACKED = ['status', 'limit_amount', 'direct_limit_amount', 'redeem'];

const FIELD_LABEL = {
  status: '申购状态',
  limit_amount: '代销日累计限额',
  direct_limit_amount: '直销日累计限额',
  redeem: '赎回状态',
};

/** 限额格式化成人类可读 */
export function fmtAmount(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e8) return `${+(v / 1e8).toFixed(4)} 亿`;
  if (v >= 1e4) return `${+(v / 1e4).toFixed(2)} 万`;
  return `${v} 元`;
}

function isLimitField(f) {
  return f === 'limit_amount' || f === 'direct_limit_amount';
}

/** 判断两个字段值是否构成“有意义的变动” */
function changed(field, prev, next, minNotifyDelta) {
  if (prev === next) return false;
  if (isLimitField(field)) {
    // 限额：都是数字且差值为 0 视为未变（规避 null/0 抖动）
    const a = prev === null || prev === undefined ? null : Number(prev);
    const b = next === null || next === undefined ? null : Number(next);
    if (a === b) return false;
    if (a !== null && b !== null && Math.abs(a - b) < minNotifyDelta) return false;
    return true;
  }
  return true;
}

/**
 * @param {object} prev  上一次快照 { funds: [...] }
 * @param {object} curr  本次快照 { funds: [...] }
 * @param {object} opts  { minNotifyDelta }
 * @returns {{ changes: object[], added: object[], removed: object[] }}
 */
export function diffSnapshots(prev, curr, opts = {}) {
  const { minNotifyDelta = 0 } = opts;
  const changes = [];
  const added = [];
  const removed = [];

  const prevMap = new Map((prev?.funds || []).map((f) => [f.code, f]));
  const currMap = new Map((curr?.funds || []).map((f) => [f.code, f]));

  for (const [code, c] of currMap) {
    const p = prevMap.get(code);
    if (!p) {
      added.push({ code, name: c.name, status: c.status, limit_amount: c.limit_amount });
      continue;
    }
    const fields = [];
    for (const field of TRACKED) {
      const pv = p[field] ?? null;
      const cv = c[field] ?? null;
      if (!changed(field, pv, cv, minNotifyDelta)) continue;
      fields.push({
        field,
        label: FIELD_LABEL[field],
        old_val: pv,
        new_val: cv,
        old_text: isLimitField(field) ? fmtAmount(pv) : pv,
        new_text: isLimitField(field) ? fmtAmount(cv) : cv,
        direction:
          isLimitField(field) && pv !== null && cv !== null
            ? cv > pv
              ? 'up'
              : 'down'
            : null,
      });
    }
    if (fields.length) {
      changes.push({
        code,
        name: c.name,
        topic: c.topic || null,
        status: c.status,
        limit_amount: c.limit_amount,
        direct_limit_amount: c.direct_limit_amount,
        fields,
        severity: judgeSeverity(fields),
      });
    }
  }

  for (const [code, p] of prevMap) {
    if (!currMap.has(code)) removed.push({ code, name: p.name });
  }

  return { changes, added, removed };
}

/** 分级：影响可买性的排前面 */
function judgeSeverity(fields) {
  const f = new Set(fields.map((x) => x.field));
  if (f.has('status')) return 'high';
  if (f.has('limit_amount') || f.has('direct_limit_amount')) return 'medium';
  return 'low';
}

/** 生成纯文本摘要，供通知通道使用 */
export function summarize(diff, meta = {}) {
  const { changes, added, removed } = diff;
  const lines = [];
  lines.push(`QDII 额度监控 · ${meta.asOf || ''}`);
  if (meta.stats) {
    const s = meta.stats;
    lines.push(
      `共 ${s.total} 只｜限大额 ${s.limited}｜暂停申购 ${s.suspended}｜开放申购 ${s.open}｜封闭期 ${s.closed}`
    );
  }
  lines.push(`变动 ${changes.length} 处`);
  lines.push('');

  const high = changes.filter((c) => c.severity === 'high');
  const rest = changes.filter((c) => c.severity !== 'high');

  for (const c of [...high, ...rest].slice(0, 40)) {
    const tags = c.fields.map((f) => `${f.label} ${f.old_text} → ${f.new_text}`).join('；');
    lines.push(`· ${c.name}（${c.code}）${tags}`);
  }
  if (changes.length > 40) lines.push(`… 其余 ${changes.length - 40} 处见完整数据`);

  if (added.length) lines.push(`\n新增收录 ${added.length} 只：${added.slice(0, 5).map((a) => a.code).join(', ')}`);
  if (removed.length) lines.push(`\n移出收录 ${removed.length} 只：${removed.slice(0, 5).map((a) => a.code).join(', ')}`);

  return lines.join('\n');
}
