import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('D:/deepseek/workspace/nasidake/qdii-monitor/data/latest.json', 'utf8'));
const F = s.funds;
const NAMES = {nasdaq100:'纳斯达克100',sp500:'标普500','hsi-tech':'恒生科技',dow:'道琼斯',japan:'日本股市',germany:'德国DAX',france:'法国CAC40',uk:'英国富时100',india:'印度',vietnam:'越南',saudi:'沙特',apac:'亚太精选',other:'其他'};
const amt = (v) => v === null || v === undefined ? '—' : v >= 1e4 ? (v/1e4).toFixed(v%1e4===0?0:2)+'万' : v+'元';
const pad = (str, n) => { let w=0; for(const c of String(str)) w += /[\u4e00-\u9fa5（）：]/.test(c)?2:1; let r=String(str); while(w<n){r+=' ';w++;} return r; };

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  美股方向可申购明细（纳指100 + 标普500，场外，已剔除暂停）                  ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');
console.log(pad('代码',8)+pad('基金名称',40)+pad('代销额度',12)+pad('直销额度',12)+'倍数');
console.log('─'.repeat(88));
const us = F.filter(f => ['nasdaq100','sp500'].includes(f.index_key) && !f.on_exchange && f.status !== '暂停申购')
  .sort((a,b)=>(b.limit_amount??-1)-(a.limit_amount??-1));
for (const f of us) {
  console.log(pad(f.code,8)+pad(f.name.slice(0,19),40)+pad(amt(f.limit_amount),12)+pad(amt(f.direct_limit_amount),12)+(f.channel_ratio?f.channel_ratio+'×':'—'));
}
console.log('─'.repeat(88));
console.log('小计 '+us.length+' 只   代销合计 '+us.reduce((a,f)=>a+(f.limit_amount||0),0)+'元   直销合计 '+us.reduce((a,f)=>a+(f.direct_limit_amount||0),0)+'元');

console.log('');
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  渠道额度差异榜（直销比代销能多买）                                         ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');
const gap = F.filter(f => f.channel_split).sort((a,b)=>b.channel_ratio-a.channel_ratio);
console.log(pad('代码',8)+pad('基金名称',38)+pad('代销',12)+pad('直销',12)+'倍数');
console.log('─'.repeat(88));
for (const f of gap) {
  console.log(pad(f.code,8)+pad(f.name.slice(0,18),38)+pad(amt(f.limit_amount),12)+pad(amt(f.direct_limit_amount),12)+f.channel_ratio+'×');
}
console.log('─'.repeat(88));
console.log('共 '+gap.length+' 只存在渠道差异（源站声明 9 只）');

console.log('');
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  开放申购的 33 只（不受限，按额度排序）                                     ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');
const opens = F.filter(f=>f.status==='开放申购').sort((a,b)=>(b.limit_amount??-1)-(a.limit_amount??-1));
console.log(pad('代码',8)+pad('基金名称',40)+pad('方向',12)+pad('代销额度',12)+'直销额度');
console.log('─'.repeat(88));
for (const f of opens) {
  console.log(pad(f.code,8)+pad(f.name.slice(0,19),40)+pad(NAMES[f.index_key]||'—',12)+pad(amt(f.limit_amount),12)+amt(f.direct_limit_amount));
}
