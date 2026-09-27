// The free Cloudflare plan counts cron expressions, so one expression covers
// both times. It also creates two cross-product occurrences, which the handler
// ignores. All values are UTC: 03:15 = 11:15 CST, 07:30 = 15:30 CST.
const SCHEDULE_CRON = '15,30 3,7 * * *';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function notifyFailure(env, message) {
  if (!env.NTFY_URL) return;
  try {
    await fetch(env.NTFY_URL, {
      method: 'POST',
      headers: {
        Title: encodeURIComponent('QDII 云端定时触发失败'),
        Priority: '5',
        Tags: 'warning,cloud',
      },
      body: message,
    });
  } catch (error) {
    console.error('Failed to publish ntfy alert:', error);
  }
}

async function dispatchWorkflow(env, { dailySummary, source }) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret is missing');

  const endpoint = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'qdii-cloudflare-scheduler',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        test_notification: false,
        send_daily_summary: Boolean(dailySummary),
      },
    }),
  });

  if (response.status !== 204) {
    const detail = await response.text();
    throw new Error(`GitHub dispatch failed (${response.status}): ${detail}`);
  }

  const result = {
    ok: true,
    source,
    dailySummary: Boolean(dailySummary),
    dispatchedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result));
  return result;
}

async function runAndAlert(env, options) {
  try {
    return await dispatchWorkflow(env, options);
  } catch (error) {
    const message = `${error?.stack || error}\n来源：${options.source}\n时间：${new Date().toISOString()}`;
    console.error(message);
    await notifyFailure(env, message);
    throw error;
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const scheduledAt = new Date(controller.scheduledTime);
    const utcHour = scheduledAt.getUTCHours();
    const utcMinute = scheduledAt.getUTCMinutes();
    const utcDay = scheduledAt.getUTCDay();
    const isDaily = utcHour === 3 && utcMinute === 15;
    const isAfternoon = utcHour === 7 && utcMinute === 30;

    // Ignore the cross-product times (03:30/07:15 UTC), and skip the
    // afternoon refresh on Saturday and Sunday.
    if ((!isDaily && !isAfternoon) || (isAfternoon && (utcDay === 0 || utcDay === 6))) {
      console.log(JSON.stringify({ ok: true, skipped: 'non-target-occurrence', scheduledAt }));
      return;
    }

    ctx.waitUntil(runAndAlert(env, {
      dailySummary: isDaily,
      source: `cron:${controller.cron}`,
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: 'qdii-github-scheduler',
        repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
        workflow: env.GITHUB_WORKFLOW,
        schedules: {
          cron: `${SCHEDULE_CRON} (UTC)`,
          daily: '北京时间每天 11:15',
          afternoon: '北京时间工作日 15:30（周末由代码跳过）',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/trigger') {
      if (!env.TRIGGER_SECRET || request.headers.get('authorization') !== `Bearer ${env.TRIGGER_SECRET}`) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
      }
      const dailySummary = url.searchParams.get('daily') === 'true';
      try {
        return json(await runAndAlert(env, {
          dailySummary,
          source: 'manual-http',
        }));
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error) }, 502);
      }
    }

    return json({ ok: false, error: 'Not found' }, 404);
  },
};
