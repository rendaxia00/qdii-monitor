import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('D:/deepseek/workspace/nasidake/qdii-monitor/data/latest.json', 'utf8'));
const st = s.stats;
const fmt = (v) => v === null || v === undefined ? '—' : v >= 1e4 ? (v/1e4).toFixed(1)+'万' : v + '元';

console.log('════════ QDII 额度快照 ' + s.as_of + ' ════════');
console.log('生成于 ' + s.generated_at);
console.log('');
console.log('【全市场】收录 ' + st.total + ' 只');
console.log('  开放申购 ' + st.open + ' | 限大额 ' + st.limited + ' | 暂停申购 ' + st.suspended + ' | 场内/封闭 ' + st.closed);
console.log('  场内交易份额 ' + st.on_exchange + ' 只（不占场外额度）');
console.log('');
console.log('【额度合计 · 限大额场外】');
console.log('  名义口径  代销 ' + fmt(st.sum_distribution_limit) + ' (' + st.n_distribution_limited + '只) | 直销 ' + fmt(st.sum_direct_limit) + ' (' + st.n_direct_limited + '只)');
console.log('  实际可购  代销 ' + fmt(st.sum_distribution_limit_actual) + ' (' + st.n_distribution_limited_actual + '只) | 直销 ' + fmt(st.sum_direct_limit_actual) + ' (' + st.n_direct_limited_actual + '只)');
console.log('');
console.log('【美股方向 · 纳指100+标普500】');
console.log('  名义 ' + st.sum_us_daily_limit + '元 / ' + st.n_us_buyable + '只   |   实际可购 ' + st.sum_us_daily_limit_actual + '元 / ' + st.n_us_buyable_actual + '只');
console.log('  源站声明今日可购总额度 ' + s.declared.total_daily_limit + ' 元');
console.log('');
console.log('【分方向】');
const names = {nasdaq100:'纳斯达克100',sp500:'标普500','hsi-tech':'恒生科技',dow:'道琼斯',japan:'日本股市',germany:'德国DAX',france:'法国CAC40',uk:'英国富时100',india:'印度',vietnam:'越南',saudi:'沙特',apac:'亚太精选',other:'其他'};
Object.entries(st.by_index).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
  const fs2 = s.funds.filter(f=>f.index_key===k);
  const o = fs2.filter(f=>f.status==='开放申购').length;
  const l = fs2.filter(f=>f.status==='限大额').length;
  const sp = fs2.filter(f=>f.status==='暂停申购').length;
  console.log('  ' + (names[k]||k).padEnd(12) + String(v).padStart(4) + ' 只   开放'+String(o).padStart(3)+' / 限额'+String(l).padStart(3)+' / 暂停'+String(sp).padStart(3));
});
