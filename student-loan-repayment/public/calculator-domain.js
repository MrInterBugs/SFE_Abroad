(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SFECalculatorDomain = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MONTHS_PER_YEAR = 12;
  const PLAN_RULES = Object.freeze({
    plan1: Object.freeze({
      key: 'plan1',
      label: 'Plan 1',
      primary: true,
      repaymentRate: 0.09,
      writeOffYears: 25,
      thresholdField: 'Earnings threshold (GBP)',
    }),
    plan2: Object.freeze({
      key: 'plan2',
      label: 'Plan 2',
      primary: true,
      repaymentRate: 0.09,
      writeOffYears: 30,
      thresholdField: 'Lower earnings threshold (GBP)',
      upperThresholdField: 'Upper earnings threshold (GBP)',
    }),
    plan4: Object.freeze({
      key: 'plan4',
      label: 'Plan 4',
      primary: true,
      repaymentRate: 0.09,
      writeOffYears: 30,
      thresholdField: 'Earnings threshold (GBP)',
    }),
    plan5: Object.freeze({
      key: 'plan5',
      label: 'Plan 5',
      primary: true,
      repaymentRate: 0.09,
      writeOffYears: 40,
      thresholdField: 'Earnings threshold (GBP)',
    }),
    planPg: Object.freeze({
      key: 'planPg',
      label: 'Postgraduate Loan',
      primary: false,
      repaymentRate: 0.06,
      writeOffYears: 30,
      thresholdField: 'Earnings threshold (GBP)',
    }),
  });

  const PRIMARY_PLAN_KEYS = Object.freeze(
    Object.keys(PLAN_RULES).filter((key) => PLAN_RULES[key].primary)
  );
  const CACHE_PLAN_KEYS = Object.freeze([...PRIMARY_PLAN_KEYS, 'planPg']);
  const PLAN_LABELS = Object.freeze(Object.fromEntries(
    Object.entries(PLAN_RULES).map(([key, rule]) => [key, rule.label])
  ));
  const WRITE_OFF_YEARS = Object.freeze(Object.fromEntries(
    Object.entries(PLAN_RULES).map(([key, rule]) => [key, rule.writeOffYears])
  ));

  function planRule(plan) {
    return PLAN_RULES[plan] || null;
  }

  function repaymentRateForPlan(plan) {
    const rule = planRule(plan);
    return rule ? rule.repaymentRate : null;
  }

  function thresholdFieldForPlan(plan) {
    const rule = planRule(plan);
    return rule ? rule.thresholdField : null;
  }

  function upperThresholdFieldForPlan(plan) {
    const rule = planRule(plan);
    return rule ? rule.upperThresholdField || null : null;
  }

  function availablePlansForYear(urlsByYear, year) {
    const configured = urlsByYear && urlsByYear[year];
    if (Array.isArray(configured)) return configured.slice();
    return configured ? Object.keys(configured) : CACHE_PLAN_KEYS.slice();
  }

  function primaryPlansForYear(urlsByYear, year) {
    const available = new Set(availablePlansForYear(urlsByYear, year));
    return PRIMARY_PLAN_KEYS.filter((plan) => available.has(plan));
  }

  function isPlanAvailableForYear(urlsByYear, plan, year) {
    return Boolean(urlsByYear && urlsByYear[year] && urlsByYear[year][plan]);
  }

  return {
    MONTHS_PER_YEAR,
    PLAN_RULES,
    PRIMARY_PLAN_KEYS,
    CACHE_PLAN_KEYS,
    PLAN_LABELS,
    WRITE_OFF_YEARS,
    planRule,
    repaymentRateForPlan,
    thresholdFieldForPlan,
    upperThresholdFieldForPlan,
    availablePlansForYear,
    primaryPlansForYear,
    isPlanAvailableForYear,
  };
});
