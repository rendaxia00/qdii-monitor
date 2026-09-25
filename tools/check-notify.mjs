#!/usr/bin/env node
/** 通知通道验证：本地 mock 服务器接收 webhook，逐个检查各平台 URL/payload 组装 */
import http from 'node:http';
import { notify } from '../src/notify.js';

let got = null;
const srv = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    got = { url: req.url, headers: req.headers, body: b };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 200, ok: true }));
  });
});
await new Promise((r) => srv.listen(18923, '127.0.0.1', r));

console.log('=== 1. generic 通道实际发送 ===');
const r1 = await notify(
  { channels: ['webhook'], webhookKind: 'generic', webhookToken: 'http://127.0.0.1:18923/hook' },
  '测试标题',
  '测试内容\n第二行'
);
console.log('返回:', JSON.stringify(r1));
console.log('服务端收到 URL:', got.url);
console.log('服务端收到 Content-Type:', got.headers['content-type']);
console.log('服务端收到 body:', got.body);

console.log('\n=== 2. 各平台 URL 与 payload 组装 ===');
for (const kind of ['bark', 'serverchan', 'dingtalk', 'feishu', 'wecom']) {
  const r = await notify({ channels: ['webhook'], webhookKind: kind, webhookToken: 'TOKEN123' }, '标题', '内容');
  const info = JSON.stringify(r[0]);
  // 因跨域/域名不真实，这里主要看它是否发出了请求（网络错误说明 URL 已正确构造并尝试连接）
  console.log(`${kind.padEnd(11)} ${info.slice(0, 170)}`);
}

console.log('\n=== 3. ntfy 通道实际发送 ===');
const rn = await notify(
  {
    channels: ['ntfy'],
    ntfy: {
      server: 'http://127.0.0.1:18923',
      topic: 'qdii-test',
      token: 'NTFY_TOKEN',
      priority: 4,
      tags: 'chart_with_upwards_trend,moneybag',
    },
  },
  'QDII 额度变化',
  '040046：5 元 → 10 元'
);
console.log('返回:', JSON.stringify(rn));
console.log('服务端收到 URL:', got.url);
console.log('服务端收到 Authorization:', got.headers.authorization);
console.log('服务端收到 Priority/Tags:', got.headers.priority, '/', got.headers.tags);
console.log('服务端收到 body:', got.body);

console.log('\n=== 4. 邮件通道缺配置时的行为 ===');
const r3 = await notify({ channels: ['email'], email: { host: '', user: '', to: [] } }, 't', 'c');
console.log('返回:', JSON.stringify(r3));
console.log('（应报“SMTP 未完整配置”，属预期）');

console.log('\n=== 5. 多通道并发 ===');
const r4 = await notify({ channels: ['console', 'email'], email: { host: '', user: '', to: [] } }, '多通道', '测试');
console.log('通道数:', r4.length, '| 结果:', JSON.stringify(r4.map((x) => ({ c: x.channel, ok: x.ok }))));

srv.close();
console.log('\n验证完成');
