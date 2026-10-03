#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractEffectiveDate, inferTopicFromName, parseSalesAnnouncement } from '../src/official-direct.js';
import { mergeSnapshot } from '../src/pipeline.js';

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

// 回归：万家公告同时包含代销 10 元、直销 100 元、24 亿元总规模，
// 以及“后续可能暂停申购”的说明。总规模不能误识别为直销额度，
// 风险提示也不能把当前状态误判为暂停申购。
const wanjia = parseSalesAnnouncement({
  id: 'AN202609231829774454',
  title: '关于万家纳斯达克100指数型发起式证券投资基金(QDII)调整大额申购业务金额限制并调整总规模上限的公告',
  publishDate: '2026-09-23',
  content: `
    暂停大额申购起始日 2026年9月23日。
    A类份额和C类份额代销渠道单日单个基金账户累计金额限制调整为10元
    （A类、C类份额合并计算）；直销渠道单日单个基金账户累计金额限制仍为100元
    （A类、C类份额合并计算）。基金总规模上限调整为人民币24亿元。
    后续可调整申购金额或暂停本基金的申购业务。
  `,
});
assert.equal(wanjia.status, '限大额');
assert.equal(wanjia.distribution_amount, 10);
assert.equal(wanjia.direct_amount, 100);
assert.equal(wanjia.channel_ratio, 10);
assert.equal(wanjia.combined_share_limit, true);

const directOutside = parseSalesAnnouncement({
  id: 'AN_TEST_DIRECT_OUTSIDE',
  title: '关于某基金调整大额申购和定投业务金额限制的公告',
  publishDate: '2026-09-24',
  content: `
    自2026年9月24日起，在本公司直销渠道以外限额2万元，
    在本公司直销渠道限额5万元，各类基金份额的申请金额每类单独计算。
  `,
});
assert.equal(directOutside.distribution_amount, 20000);
assert.equal(directOutside.direct_amount, 50000);
assert.equal(directOutside.combined_share_limit, false);

const combinedAci = parseSalesAnnouncement({
  id: 'AN_TEST_ACI_GROUP',
  title: '某基金调整大额申购业务的公告',
  publishDate: '2026-09-22',
  content: '自2026年9月22日起，单日累计申购限额调整为5元（A、C、I份额合并计算）。',
});
assert.equal(combinedAci.direct_amount, 5);
assert.equal(combinedAci.distribution_amount, 5);
assert.equal(combinedAci.combined_share_limit, true);

const generalWithDirectOverride = parseSalesAnnouncement({
  id: 'AN_TEST_GENERAL_DIRECT_OVERRIDE',
  title: '某基金暂停大额申购、定期定额投资公告',
  publishDate: '2026-08-19',
  content: `
    自2026年8月20日起，人民币份额投资者单日单个基金账户单笔或多笔累计高于10元的申购业务进行限制；
    针对在本公司直销渠道投资A类、C类人民币份额的情况，累计高于50元的部分有权拒绝。
  `,
});
assert.equal(generalWithDirectOverride.distribution_amount, 10);
assert.equal(generalWithDirectOverride.direct_amount, 50);

const sharedQuotaFunds = ['019441', '019442'].map((code) => ({
  code,
  name: `万家纳斯达克100 ${code}`,
  topic: '纳斯达克100',
  status: '限大额',
  distribution_limit_amount: 10,
  direct_limit_amount: 100,
  limit_group: 'AN202609231829774454',
  on_exchange: false,
}));
const groupedSnapshot = mergeSnapshot(
  {
    as_of: '2026-09-23',
    funds: sharedQuotaFunds,
  },
  sharedQuotaFunds.map((f) => ({
    code: f.code,
    name: f.name,
    status: '限大额',
    limit_amount: 10,
    purchasable: true,
  }))
);
assert.equal(groupedSnapshot.stats.sum_us_distribution_limit_actual, 10);
assert.equal(groupedSnapshot.stats.sum_us_direct_limit_actual, 100);

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
