/*
  THE COMPANY FILE — the panels a name's page did not have.

  Profile, dividends, splits, forward estimates and the last call. The
  shape is the contract Unusual Whales fills (companies/*). Until the key
  is plugged every figure is a SAMPLE, deterministic per name, and the
  page says so.
*/

import { h01, hPick, hRange } from '../core/rng';

export interface DividendRow {
  ex: string;
  amount: number;
}
export interface SplitRow {
  date: string;
  ratio: string;
}
export interface EstimateRow {
  period: string;
  eps: number;
}
export interface TranscriptLine {
  speaker: string;
  role: string;
  text: string;
}

export interface CompanyFile {
  sample: true;
  sector: string;
  industry: string;
  description: string;
  marketCapB: number;
  pe: number;
  dividendYield: number;
  target: number;
  high: number;
  low: number;
  analysts: number;
  revenueB: number;
  dividends: DividendRow[];
  splits: SplitRow[];
  estimates: EstimateRow[];
  transcript: TranscriptLine[];
}

const SECTORS = ['Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Industrials', 'Energy'] as const;
const INDUSTRIES: Record<(typeof SECTORS)[number], string[]> = {
  Technology: ['Semiconductors', 'Software', 'Hardware'],
  'Financial Services': ['Banks', 'Capital markets', 'Insurance'],
  Healthcare: ['Drug manufacturers', 'Medical devices', 'Managed care'],
  'Consumer Cyclical': ['Auto', 'Retail', 'Restaurants'],
  Industrials: ['Machinery', 'Aerospace', 'Rail'],
  Energy: ['Integrated oil', 'Oilfield services', 'Refining'],
};

export function buildCompanyFile(ticker: string, price: number): CompanyFile {
  const sector = hPick(`${ticker}-sec`, SECTORS);
  const industry = hPick(`${ticker}-ind`, INDUSTRIES[sector]);
  const pe = Number(hRange(`${ticker}-pe`, 12, 48).toFixed(1));
  const yieldPct = Number((h01(`${ticker}-dy`) * 2.4).toFixed(2));
  const cap = Number(hRange(`${ticker}-cap`, 18, 2800).toFixed(1));
  const quarters = ['2026 Q1', '2026 Q2', '2026 Q3', '2026 Q4', '2027 Q1'];
  return {
    sample: true,
    sector,
    industry,
    description: `${ticker} sits in ${industry}, inside ${sector}. The file under it is the capitalisation, the multiple, the dividend and where the street has the name.`,
    marketCapB: cap,
    pe,
    dividendYield: yieldPct,
    target: Number((price * hRange(`${ticker}-tgt`, 0.9, 1.25)).toFixed(2)),
    high: Number((price * hRange(`${ticker}-hi`, 1.05, 1.45)).toFixed(2)),
    low: Number((price * hRange(`${ticker}-lo`, 0.7, 0.95)).toFixed(2)),
    analysts: Math.round(hRange(`${ticker}-an`, 8, 42)),
    revenueB: Number(hRange(`${ticker}-rev`, 4, 90).toFixed(1)),
    dividends: [0, 1, 2, 3].map(i => ({
      ex: `2026-0${4 - i}-15`,
      amount: Number(hRange(`${ticker}-div-${i}`, 0.12, 0.85).toFixed(2)),
    })),
    splits: h01(`${ticker}-split`) > 0.55 ? [{ date: '2024-08-12', ratio: hPick(`${ticker}-ratio`, ['2-for-1', '4-for-1', '3-for-1']) }] : [],
    estimates: quarters.map((period, i) => ({
      period,
      eps: Number((1.1 + i * 0.08 + hRange(`${ticker}-eps-${i}`, -0.2, 0.35)).toFixed(2)),
    })),
    transcript: [
      { speaker: 'Operator', role: 'Call', text: 'The question-and-answer portion of the call will follow the prepared remarks.' },
      { speaker: 'Chief executive', role: 'Prepared', text: `Demand held through the quarter. The guide for the next one sits inside the range the street already had for ${ticker}.` },
      { speaker: 'Chief financial officer', role: 'Prepared', text: 'Margins were a tenth either side of last quarter. We are not changing the capital return.' },
      { speaker: 'Analyst', role: 'Question', text: 'How much of the guide is volume, and how much is price?' },
      { speaker: 'Chief executive', role: 'Answer', text: 'Most of it is volume. Price is steady. The swing factor is the second half, not this print.' },
    ],
  };
}

export const STATEMENT_PERIODS = ['2025 Q4', '2026 Q1', '2026 Q2', '2026 Q3'] as const;

export interface StatementLine {
  name: string;
  values: number[];
}

export interface StatementBook {
  income: StatementLine[];
  balance: StatementLine[];
  cash: StatementLine[];
}

const round1 = (n: number) => Number(n.toFixed(1));

/** Income, balance sheet and cash flow, four quarters, figures in millions. Sample, one shape per name. */
export function buildStatements(ticker: string): StatementBook {
  const income = [0, 1, 2, 3].map(i => {
    const revenue = hRange(`${ticker}-is-rev-${i}`, 4200, 28000) * (1 + i * 0.03);
    const cost = revenue * hRange(`${ticker}-is-cogs-${i}`, 0.42, 0.68);
    const gross = revenue - cost;
    const opex = gross * hRange(`${ticker}-is-opex-${i}`, 0.35, 0.62);
    const operating = gross - opex;
    const interest = hRange(`${ticker}-is-int-${i}`, 40, 380);
    const pretax = operating - interest;
    const tax = Math.max(0, pretax) * 0.21;
    const net = pretax - tax;
    const shares = hRange(`${ticker}-is-sh-${i}`, 400, 9000);
    return { revenue, cost, gross, opex, operating, interest, pretax, tax, net, eps: net / shares, shares };
  });
  const pick = (key: keyof (typeof income)[number]) => income.map(q => round1(q[key]));
  const cash = hRange(`${ticker}-bs-cash`, 1800, 42000);
  const debt = hRange(`${ticker}-bs-debt`, 500, 36000);
  const assets = hRange(`${ticker}-bs-assets`, 12000, 180000);
  const balanceAt = (i: number, base: number, swing: string) => round1(base * (1 + i * 0.015) * hRange(`${ticker}-bs-${swing}-${i}`, 0.96, 1.04));
  const cashFlow = [0, 1, 2, 3].map(i => {
    const cfo = hRange(`${ticker}-cf-cfo-${i}`, 800, 14000);
    const capex = -hRange(`${ticker}-cf-capex-${i}`, 200, 4000);
    const buybacks = -hRange(`${ticker}-cf-bb-${i}`, 0, 2500);
    const dividends = -hRange(`${ticker}-cf-div-${i}`, 0, 900);
    const debtIssued = hRange(`${ticker}-cf-di-${i}`, -800, 1200);
    const cfi = capex;
    const cff = buybacks + dividends + debtIssued;
    return { cfo, capex, cfi, buybacks, dividends, debtIssued, cff, change: cfo + cfi + cff, da: hRange(`${ticker}-cf-da-${i}`, 80, 1600) };
  });
  const flow = (key: keyof (typeof cashFlow)[number]) => cashFlow.map(q => round1(q[key]));
  return {
    income: [
      { name: 'Total revenue', values: pick('revenue') },
      { name: 'Cost of revenue', values: pick('cost') },
      { name: 'Gross profit', values: pick('gross') },
      { name: 'Research and development', values: income.map(q => round1(q.opex * 0.38)) },
      { name: 'Selling, general and administrative', values: income.map(q => round1(q.opex * 0.62)) },
      { name: 'Operating expenses', values: pick('opex') },
      { name: 'Operating income', values: pick('operating') },
      { name: 'Interest expense', values: pick('interest') },
      { name: 'EBIT', values: pick('operating') },
      { name: 'EBITDA', values: income.map((q, i) => round1(q.operating + cashFlow[i].da)) },
      { name: 'Income before tax', values: pick('pretax') },
      { name: 'Income tax expense', values: pick('tax') },
      { name: 'Net income', values: pick('net') },
    ],
    balance: [
      { name: 'Cash', values: [0, 1, 2, 3].map(i => balanceAt(i, cash, 'cash')) },
      { name: 'Receivables', values: [0, 1, 2, 3].map(i => balanceAt(i, cash * 0.35, 'ar')) },
      { name: 'Inventory', values: [0, 1, 2, 3].map(i => balanceAt(i, cash * 0.22, 'inv')) },
      { name: 'Total current assets', values: [0, 1, 2, 3].map(i => balanceAt(i, cash * 1.8, 'ca')) },
      { name: 'Property and equipment', values: [0, 1, 2, 3].map(i => balanceAt(i, assets * 0.28, 'ppe')) },
      { name: 'Goodwill', values: [0, 1, 2, 3].map(i => balanceAt(i, assets * 0.12, 'gw')) },
      { name: 'Total assets', values: [0, 1, 2, 3].map(i => balanceAt(i, assets, 'ta')) },
      { name: 'Accounts payable', values: [0, 1, 2, 3].map(i => balanceAt(i, debt * 0.18, 'ap')) },
      { name: 'Short-term debt', values: [0, 1, 2, 3].map(i => balanceAt(i, debt * 0.22, 'std')) },
      { name: 'Total current liabilities', values: [0, 1, 2, 3].map(i => balanceAt(i, debt * 0.55, 'cl')) },
      { name: 'Long-term debt', values: [0, 1, 2, 3].map(i => balanceAt(i, debt, 'ltd')) },
      { name: 'Total liabilities', values: [0, 1, 2, 3].map(i => balanceAt(i, debt * 1.7, 'tl')) },
      { name: 'Equity', values: [0, 1, 2, 3].map(i => balanceAt(i, assets * 0.42, 'eq')) },
      { name: 'Retained earnings', values: [0, 1, 2, 3].map(i => balanceAt(i, assets * 0.24, 're')) },
    ],
    cash: [
      { name: 'Net income', values: pick('net') },
      { name: 'Depreciation', values: flow('da') },
      { name: 'Cash from operations', values: flow('cfo') },
      { name: 'Capital expenditure', values: flow('capex') },
      { name: 'Cash from investing', values: flow('cfi') },
      { name: 'Buybacks', values: flow('buybacks') },
      { name: 'Dividends paid', values: flow('dividends') },
      { name: 'Debt issued or repaid', values: flow('debtIssued') },
      { name: 'Cash from financing', values: flow('cff') },
      { name: 'Change in cash', values: flow('change') },
    ],
  };
}
