const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value, digits = 2) => {
  const base = 10 ** digits;
  return Math.round((value + Number.EPSILON) * base) / base;
};

/**
 * 估算长期定投的显性费率磨损。
 *
 * - 管理费、托管费按整个持有期计提。
 * - 根据 2026 年实施的基金销售费用规定，非货币基金每笔份额持有超过一年后
 *   不再收取销售服务费，因此每笔月投仅计算前 12 个月的销售服务费。
 * - 模拟固定每月 1,000 元、投资收益为 0，用于不同基金之间横向比较。
 * - 不包含申购/赎回费、平台折扣、交易成本、税费、汇率和跟踪偏离。
 */
export function calculateCostDrag(profile, { monthlyContribution = 1000 } = {}) {
  const management = num(profile?.management_fee);
  const custody = num(profile?.custody_fee);
  if (management === null || custody === null) return null;

  // 费率页未列示销售服务费时，按该份额不收取（0%）处理并保留推断标记。
  const rawSales = num(profile?.sales_service_fee);
  const sales = rawSales ?? 0;
  const baseAnnual = management + custody;
  const firstYearAnnual = baseAnnual + sales;

  const estimate = (years) => {
    const months = years * 12;
    const baseRate = baseAnnual / 100;
    const salesRate = sales / 100;
    let estimatedValue = 0;

    for (let month = 0; month < months; month += 1) {
      const holdingMonths = months - month;
      const baseFactor = (1 - baseRate) ** (holdingMonths / 12);
      const salesFactor = (1 - salesRate) ** (Math.min(holdingMonths, 12) / 12);
      estimatedValue += monthlyContribution * baseFactor * salesFactor;
    }

    const contributed = monthlyContribution * months;
    const estimatedCost = contributed - estimatedValue;
    return {
      years,
      contributed,
      estimated_cost: round(estimatedCost, 0),
      estimated_cost_rate: round((estimatedCost / contributed) * 100, 2),
    };
  };

  return {
    management_fee: round(management),
    custody_fee: round(custody),
    sales_service_fee: round(sales),
    sales_fee_assumed_zero: rawSales === null,
    first_year_annual_rate: round(firstYearAnnual),
    long_term_annual_rate: round(baseAnnual),
    monthly_contribution: monthlyContribution,
    simulations: [1, 3, 5, 10].map(estimate),
  };
}
