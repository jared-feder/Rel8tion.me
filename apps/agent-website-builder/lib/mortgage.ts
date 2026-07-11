export const DEFAULT_DOWN_PAYMENT_PERCENT = 5
export const DEFAULT_INTEREST_RATE = 6.5
export const DEFAULT_LOAN_TERM_YEARS = 30
export const DEFAULT_ANNUAL_INSURANCE = 2400
export const DEFAULT_MONTHLY_HOA = 0
export const DEFAULT_PMI_RATE = 0.55

export function currency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value || 0)))
}

export function numberValue(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(String(value || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function monthlyPrincipalInterest(loanAmount: number, annualRate: number, years: number) {
  const months = years * 12
  const monthlyRate = annualRate / 100 / 12
  if (!loanAmount || !months) return 0
  if (!monthlyRate) return loanAmount / months
  return loanAmount * (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1)
}

export function estimateMonthlyMortgage({
  price,
  downPaymentPercent = DEFAULT_DOWN_PAYMENT_PERCENT,
  rate = DEFAULT_INTEREST_RATE,
  termYears = DEFAULT_LOAN_TERM_YEARS,
  annualTaxes = 0,
  annualInsurance = DEFAULT_ANNUAL_INSURANCE,
  monthlyHoa = DEFAULT_MONTHLY_HOA,
  pmiRate = DEFAULT_PMI_RATE,
}: {
  price: number
  downPaymentPercent?: number
  rate?: number
  termYears?: number
  annualTaxes?: number
  annualInsurance?: number
  monthlyHoa?: number
  pmiRate?: number
}) {
  const homePrice = numberValue(price)
  const downPercent = Math.min(100, Math.max(0, numberValue(downPaymentPercent)))
  const loanAmount = homePrice * (1 - downPercent / 100)
  const principalInterest = monthlyPrincipalInterest(loanAmount, numberValue(rate), numberValue(termYears))
  const monthlyTaxes = numberValue(annualTaxes) / 12
  const monthlyInsurance = numberValue(annualInsurance) / 12
  const monthlyPmi = downPercent < 20 ? (loanAmount * (numberValue(pmiRate) / 100)) / 12 : 0
  const total = principalInterest + monthlyTaxes + monthlyInsurance + numberValue(monthlyHoa) + monthlyPmi

  return {
    homePrice,
    downAmount: homePrice * downPercent / 100,
    loanAmount,
    principalInterest,
    monthlyTaxes,
    monthlyInsurance,
    monthlyHoa: numberValue(monthlyHoa),
    monthlyPmi,
    total,
  }
}
