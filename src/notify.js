/**
 * 通知通道。默认 console，可选 webhook（Bark / Server酱 / 钉钉 / 飞书 / 企业微信 / 通用）、ntfy
 * 与邮件（SMTP，走 node:net + node:tls 手写，避免引入依赖）。
 */
import net from 'node:net';
import tls from 'node:tls';

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();

  // 国内 IM 的机器人 webhook 常见行为：HTTP 200 但响应体内带错误码。
  // 只信 HTTP 状态会把“token 失效/被限流”误判为成功，故解析响应体。
  let businessOk = res.ok;
  let hint = '';
  try {
    const j = JSON.parse(text);
    const code = j.errcode ?? j.code ?? j.statusCode;
    if (code !== undefined && code !== null) {
      const okCode = code === 0 || code === 200;
      if (!okCode) {
        businessOk = false;
        hint = j.errmsg || j.msg || j.message || `code=${code}`;
      }
    }
  } catch {
    // 非 JSON 响应，以 HTTP 状态为准
  }

  return { ok: businessOk, status: res.status, text: text.slice(0, 300), hint };
}

/** ntfy 的 HTTP Header 可能包含中文标题，按 RFC 2047 编码以兼容 Node fetch。 */
const encodeHeaderUtf8 = (value) => `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;

async function sendNtfy(cfg, title, content) {
  if (!cfg?.topic) return { ok: false, channel: 'ntfy', error: 'ntfy topic 未配置' };
  const server = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${encodeURIComponent(cfg.topic)}`;
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    title: encodeHeaderUtf8(title),
    priority: String(cfg.priority || 3),
    tags: cfg.tags || 'chart_with_upwards_trend,moneybag',
  };
  // ntfy 官方 Click 头：用户点按通知时直接打开监控站点。
  if (cfg.click) headers.click = cfg.click;
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;

  const res = await fetch(url, { method: 'POST', headers, body: content });
  const text = await res.text();
  return {
    ok: res.ok,
    channel: 'ntfy',
    status: res.status,
    text: text.slice(0, 300),
    ...(!res.ok ? { error: `HTTP ${res.status}` } : {}),
  };
}

function buildWebhookPayload(kind, token, title, content) {
  switch (kind) {
    case 'bark':
      return {
        url: `https://api.day.app/${token}`,
        body: { title, body: content, group: 'QDII限额' },
      };
    case 'serverchan':
      return {
        url: `https://sctapi.ftqq.com/${token}.send`,
        body: { title, desp: content },
      };
    case 'dingtalk':
      return {
        url: `https://oapi.dingtalk.com/robot/send?access_token=${token}`,
        body: { msgtype: 'text', text: { content: `${title}\n\n${content}` } },
      };
    case 'feishu':
      return {
        url: `https://open.feishu.cn/open-apis/bot/v2/hook/${token}`,
        body: { msg_type: 'text', content: { text: `${title}\n\n${content}` } },
      };
    case 'wecom':
      return {
        url: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${token}`,
        body: { msgtype: 'text', text: { content: `${title}\n\n${content}` } },
      };
    default:
      return { url: token || '', body: { title, content } };
  }
}

/** 极简 SMTP 客户端：EHLO -> AUTH LOGIN -> MAIL FROM -> RCPT TO -> DATA */
async function sendMail(cfg, subject, text) {
  if (!cfg.host || !cfg.user || !cfg.to.length) {
    return { ok: false, channel: 'email', error: 'SMTP 未完整配置' };
  }
  return new Promise((resolve) => {
    const socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });

    let buffer = '';
    const steps = [];
    let finished = false;

    const finish = (ok, error) => {
      if (finished) return;
      finished = true;
      try { socket.end(); } catch {}
      resolve({ ok, channel: 'email', error });
    };

    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const body = [
      `From: ${cfg.from || cfg.user}`,
      `To: ${cfg.to.join(', ')}`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text).replace(/(.{76})/g, '$1\r\n'),
      '.',
    ].join('\r\n');

    const pipeline = [
      { expect: /^220/, send: `EHLO qdii-monitor\r\n` },
      { expect: /^250/, send: `AUTH LOGIN\r\n` },
      { expect: /^334/, send: `${b64(cfg.user)}\r\n` },
      { expect: /^334/, send: `${b64(cfg.pass)}\r\n` },
      { expect: /^235/, send: `MAIL FROM:<${cfg.from || cfg.user}>\r\n` },
      { expect: /^250/, send: `RCPT TO:<${cfg.to[0]}>\r\n` },
      { expect: /^250/, send: `DATA\r\n` },
      { expect: /^354/, send: body + '\r\n' },
      { expect: /^250/, send: `QUIT\r\n`, done: true },
    ];

    let idx = 0;
    const advance = () => {
      if (idx >= pipeline.length) return finish(true);
      const step = pipeline[idx];
      const line = buffer;
      buffer = '';
      if (step.expect && !step.expect.test(line)) {
        return finish(false, `SMTP 期望 ${step.expect} 收到 ${line.trim().slice(0, 80)}`);
      }
      idx++;
      socket.write(step.send);
      if (step.done) return finish(true);
    };

    socket.setTimeout(20000);
    socket.on('data', (d) => {
      buffer += d.toString('utf8');
      // 多行响应（250-xxx）等待最后一行
      if (/^\d{3}-/m.test(buffer.split('\r\n').filter(Boolean).pop() || '')) return;
      if (buffer.includes('\r\n')) advance();
    });
    socket.on('error', (e) => finish(false, e.message));
    socket.on('timeout', () => finish(false, 'SMTP 超时'));
    socket.on('connect', () => {});
    if (cfg.secure) socket.on('secureConnect', () => {});
  });
}

/**
 * 发送通知
 * @param {object} cfg        config.notify
 * @param {string} title
 * @param {string} content
 */
export async function notify(cfg, title, content) {
  const results = [];
  for (const ch of cfg.channels) {
    try {
      if (ch === 'console') {
        console.log('\n' + '='.repeat(56));
        console.log(title);
        console.log('='.repeat(56));
        console.log(content);
        console.log('='.repeat(56) + '\n');
        results.push({ ok: true, channel: 'console' });
      } else if (ch === 'webhook') {
        const { url, body } = buildWebhookPayload(cfg.webhookKind, cfg.webhookToken || cfg.webhookUrl, title, content);
        if (!url) { results.push({ ok: false, channel: 'webhook', error: '未配置 URL' }); continue; }
        const r = await postJson(url, body);
        results.push({ ok: r.ok, channel: 'webhook', status: r.status, text: r.text, ...(r.hint ? { error: r.hint } : {}) });
      } else if (ch === 'email') {
        results.push(await sendMail(cfg.email, title, content));
      } else if (ch === 'ntfy') {
        results.push(await sendNtfy(cfg.ntfy, title, content));
      } else {
        results.push({ ok: false, channel: ch, error: '未知通道' });
      }
    } catch (e) {
      results.push({ ok: false, channel: ch, error: e.message });
    }
  }
  return results;
}
