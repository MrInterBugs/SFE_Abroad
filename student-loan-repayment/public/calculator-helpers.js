(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SFECalculatorHelpers = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const WRITE_OFF_YEARS = { plan1: 25, plan2: 30, plan4: 30, plan5: 40, planPg: 30 };
  const FALLBACK_AVAILABLE_PLANS = ['plan1', 'plan2', 'plan4', 'plan5', 'planPg'];
  const PLAN_LABELS = { plan1: 'Plan 1', plan2: 'Plan 2', plan4: 'Plan 4', plan5: 'Plan 5', planPg: 'Postgraduate Loan' };

  function availablePlansForYear(availablePlansByYear, year) {
    const configured = availablePlansByYear[year];
    return Array.isArray(configured) ? configured : FALLBACK_AVAILABLE_PLANS;
  }

  function plan2InterestThresholds(result) {
    if (!result || result.selectedPlan !== 'plan2') return null;
    const lower = parseFloat(result.plan2LowerThresholdGbp || result.thresholdGbp);
    const upper = parseFloat(result.plan2UpperThresholdGbp);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;
    return { lower, upper };
  }

  function calcPlan2Surcharge(salaryGbp, thresholds) {
    if (!thresholds) return 0;
    if (salaryGbp <= thresholds.lower) return 0;
    if (salaryGbp >= thresholds.upper) return 3;
    return ((salaryGbp - thresholds.lower) / (thresholds.upper - thresholds.lower)) * 3;
  }

  function calcWriteOff(graduationDate, plan) {
    const years = WRITE_OFF_YEARS[plan];
    if (!years || !graduationDate) return null;
    const [gradYear, gradMonth] = graduationDate.split('-').map(Number);
    const firstRepayYear = gradMonth <= 3 ? gradYear : gradYear + 1;
    return { writeOffYear: firstRepayYear + years, firstRepayYear, years, plan };
  }

  function timeUntilApril(targetYear) {
    const now = new Date();
    const totalMonths = (targetYear - now.getFullYear()) * 12 + (4 - (now.getMonth() + 1));
    const clipped = Math.max(0, totalMonths);
    const yrs = Math.floor(clipped / 12);
    const mos = clipped % 12;
    if (yrs === 0) return `${mos} month${mos !== 1 ? 's' : ''}`;
    if (mos === 0) return `${yrs} year${yrs !== 1 ? 's' : ''}`;
    return `${yrs} year${yrs !== 1 ? 's' : ''} and ${mos} month${mos !== 1 ? 's' : ''}`;
  }

  function fmt(n) {
    const val = parseFloat(n);
    if (val === 0) return '£0';
    return '£' + Math.floor(val).toLocaleString('en-GB');
  }

  function fmtShort(n) {
    return '£' + Math.round(parseFloat(n)).toLocaleString('en-GB');
  }

  function buildBalanceOverTime(startBalance, annualRatePct, maxYears, payRisePct, initialSalaryGbp, thresholdGbp, repaymentRate, thresholdRisePct = 0) {
    const monthlyRate = annualRatePct / 100 / 12;
    let balance = startBalance;
    const data = [parseFloat(startBalance.toFixed(2))];
    let totalPaid = 0;
    let paidOff = false;
    let payoffYear = null;
    for (let yr = 1; yr <= maxYears; yr++) {
      if (!paidOff) {
        const salary = initialSalaryGbp * Math.pow(1 + payRisePct / 100, yr - 1);
        const effectiveThreshold = thresholdGbp * Math.pow(1 + thresholdRisePct / 100, yr - 1);
        const monthlyPayment = Math.max(0, (salary - effectiveThreshold) * repaymentRate / 12);
        for (let m = 0; m < 12; m++) {
          const interest = balance * monthlyRate;
          const newBalance = Math.max(0, balance + interest - monthlyPayment);
          totalPaid += balance + interest - newBalance;
          balance = newBalance;
          if (balance === 0 && !paidOff) { paidOff = true; payoffYear = yr; }
        }
        balance = parseFloat(balance.toFixed(2));
      }
      data.push(paidOff ? 0 : balance);
    }
    const finalBalance = paidOff ? 0 : balance;
    const totalInterest = Math.max(0, totalPaid + finalBalance - startBalance);
    return { data, totalPaid: Math.round(totalPaid), totalInterest: Math.round(totalInterest), paidOff, payoffYear };
  }

  return {
    WRITE_OFF_YEARS,
    PLAN_LABELS,
    availablePlansForYear,
    plan2InterestThresholds,
    calcPlan2Surcharge,
    calcWriteOff,
    timeUntilApril,
    fmt,
    fmtShort,
    buildBalanceOverTime,
  };
});
