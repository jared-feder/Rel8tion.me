'use client'

import { useEffect, useMemo, useState } from 'react'
import { Calculator, CalendarDays, DollarSign, Percent, Shield, Home, WalletCards, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_ANNUAL_INSURANCE,
  DEFAULT_DOWN_PAYMENT_PERCENT,
  DEFAULT_INTEREST_RATE,
  DEFAULT_LOAN_TERM_YEARS,
  DEFAULT_MONTHLY_HOA,
  DEFAULT_PMI_RATE,
  currency,
  estimateMonthlyMortgage,
  numberValue,
} from '@/lib/mortgage'

function CalculatorInput({
  id,
  label,
  value,
  onChange,
  icon: Icon,
  suffix,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  icon: LucideIcon
  suffix?: string
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-1.5">
        <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} className="pl-9 pr-12" inputMode="decimal" />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}

export function MortgageCalculator() {
  const [price, setPrice] = useState('750000')
  const [downPayment, setDownPayment] = useState(String(DEFAULT_DOWN_PAYMENT_PERCENT))
  const [rate, setRate] = useState(String(DEFAULT_INTEREST_RATE))
  const [term, setTerm] = useState(String(DEFAULT_LOAN_TERM_YEARS))
  const [taxes, setTaxes] = useState('12000')
  const [insurance, setInsurance] = useState(String(DEFAULT_ANNUAL_INSURANCE))
  const [hoa, setHoa] = useState(String(DEFAULT_MONTHLY_HOA))
  const [pmi, setPmi] = useState(String(DEFAULT_PMI_RATE))

  useEffect(() => {
    function handlePrefill(event: Event) {
      const detail = (event as CustomEvent<{ price?: number; annualTaxes?: number | null; monthlyHoa?: number | null }>).detail || {}
      if (detail.price) setPrice(String(Math.round(detail.price)))
      if (detail.annualTaxes != null && detail.annualTaxes > 0) setTaxes(String(Math.round(detail.annualTaxes)))
      else setTaxes('0')
      if (detail.monthlyHoa != null && detail.monthlyHoa > 0) setHoa(String(Math.round(detail.monthlyHoa)))
      else setHoa('0')
    }

    window.addEventListener('rel8tion:mortgage-prefill', handlePrefill)
    return () => window.removeEventListener('rel8tion:mortgage-prefill', handlePrefill)
  }, [])

  const result = useMemo(() => {
    return estimateMonthlyMortgage({
      price: numberValue(price),
      downPaymentPercent: numberValue(downPayment),
      rate: numberValue(rate),
      termYears: numberValue(term),
      annualTaxes: numberValue(taxes),
      annualInsurance: numberValue(insurance),
      monthlyHoa: numberValue(hoa),
      pmiRate: numberValue(pmi),
    })
  }, [downPayment, hoa, insurance, pmi, price, rate, taxes, term])

  const rows = [
    { label: 'Principal & interest', value: result.principalInterest, icon: Home },
    { label: 'Property taxes', value: result.monthlyTaxes, icon: Calculator },
    { label: 'Home insurance', value: result.monthlyInsurance, icon: Shield },
    { label: 'HOA / common charges', value: result.monthlyHoa, icon: WalletCards },
    { label: 'Estimated PMI', value: result.monthlyPmi, icon: Percent },
  ]

  return (
    <section id="mortgage-calculator" className="bg-background py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 max-w-3xl">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-accent">
            <Calculator className="h-4 w-4" />
            Mortgage Calculator
          </p>
          <h2 className="text-3xl font-bold text-foreground lg:text-4xl">Estimate Your Monthly Payment</h2>
          <p className="mt-3 text-muted-foreground">
            Adjust price, down payment, rate, taxes, insurance, HOA, and PMI to get a fast monthly estimate before you reach out.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:grid-cols-2 lg:p-6">
            <CalculatorInput id="home-price" label="Purchase price" value={price} onChange={setPrice} icon={DollarSign} />
            <CalculatorInput id="down-payment" label="Down payment" value={downPayment} onChange={setDownPayment} icon={Percent} suffix="%" />
            <CalculatorInput id="interest-rate" label="Interest rate" value={rate} onChange={setRate} icon={Percent} suffix="%" />
            <CalculatorInput id="loan-term" label="Loan term" value={term} onChange={setTerm} icon={CalendarDays} suffix="yrs" />
            <CalculatorInput id="taxes" label="Annual property taxes" value={taxes} onChange={setTaxes} icon={DollarSign} />
            <CalculatorInput id="insurance" label="Annual homeowners insurance" value={insurance} onChange={setInsurance} icon={DollarSign} />
            <CalculatorInput id="hoa" label="Monthly HOA / common charges" value={hoa} onChange={setHoa} icon={DollarSign} />
            <CalculatorInput id="pmi" label="PMI rate if under 20% down" value={pmi} onChange={setPmi} icon={Percent} suffix="%" />
          </div>

          <div className="rounded-2xl border border-border bg-primary p-5 text-primary-foreground shadow-xl lg:p-6">
            <p className="text-sm font-semibold uppercase tracking-wide opacity-80">Estimated Monthly Payment</p>
            <p className="mt-3 text-4xl font-black">{currency(result.total)}</p>
            <div className="mt-6 space-y-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl bg-white/10 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <row.icon className="h-4 w-4" />
                    {row.label}
                  </span>
                  <b>{currency(row.value)}</b>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl bg-white/10 p-4 text-sm">
              <p><b>Estimated loan amount:</b> {currency(result.loanAmount)}</p>
              <p className="mt-1"><b>Estimated down payment:</b> {currency(result.downAmount)}</p>
            </div>
            <p className="mt-4 text-xs leading-relaxed opacity-75">
              This is an estimate only and is not a loan quote, commitment to lend, or financial advice. Final payment depends on lender terms, taxes, insurance, HOA fees, and eligibility.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
