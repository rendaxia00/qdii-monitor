#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractEffectiveDate, inferTopicFromName, parseSalesAnnouncement } from '../src/official-direct.js';

const split = parseSalesAnnouncement({
  id: 'AN_TEST_SPLIT',
  title: '关于某基金调整大额申购的公告',
  publishDate: '2026-09-25',
  content: `
    调整大额申购起始日 2026年9月26日。
    投资人通过本公司直销渠道单日累计申购金额应不超过100元人民币；
    投资人通过各代销机构单日累计申购金额应不超过10元人民币。
  `,
});
assert.equal(split.status, '限大额');
assert.equal(split.effective_date, '2026-09-26');
assert.equal(split.direct_amount, 100);
assert.equal(split.distribution_amount, 10);
assert.equal(split.channel_ratio, 10);

const layered = parseSalesAnnouncement({
  id: 'AN_TEST_LAYERED',
  title: '关于某基金调整大额申购及定期定额投资业务的公告',
  publishDate: '2026-09-25',
  content: `
    自2026年9月28日起，个人投资者在直销机构单日累计申购不得超过2000元。
    机构投资者在直销机构、投资者在代销机构单日累计申购不得超过1000元。
  `,
});
assert.equal(layered.effective_date, '2026-09-28');
assert.equal(layered.direct_amount, 2000);
assert.equal(layered.distribution_amount, 1000);

const generic = parseSalesAnnouncement({
  id: 'AN_TEST_GENERIC',
  title: '某基金调整大额申购业务限制金额的公告',
  publishDate: '2026-09-25',
  content: '暂停大额申购起始日2026年9月28日。每一类基金份额单日累计申购金额应不超过10元。',
});
assert.equal(generic.direct_amount, 10);
assert.equal(generic.distribution_amount, 10);
assert.equal(generic.channel_split, false);

const suspended = parseSalesAnnouncement({
  id: 'AN_TEST_SUSPEND',
  title: '关于某基金暂停申购、定期定额投资业务的公告',
  publishDate: '2026-09-25',
  content: '暂停申购起始日2026年9月26日。自2026年9月26日起暂停本基金申购业务。',
});
assert.equal(suspended.status, '暂停申购');
assert.equal(suspended.effective_date, '2026-09-26');

assert.equal(extractEffectiveDate('自 2026 年 10 月 2 日起调整限额'), '2026-10-02');
assert.equal(inferTopicFromName('某某纳斯达克100ETF联接(QDII)A'), '纳斯达克100');
assert.equal(inferTopicFromName('某某纳斯达克生物科技ETF联接(QDII)A'), null);
assert.equal(inferTopicFromName('某某恒生科技ETF联接(QDII)C'), '恒生科技');

console.log('官方公告解析测试：全部通过');
