/* What is on the record about a name off the tape: insider trades (SEC Form 4) and members of Congress' trades (STOCK Act),
   shaped like the feeds (amount brackets, a three-state plan flag, the owner on every row). */

/* ---- Congress ------------------------------------------------------------------ */

export type Chamber = 'House' | 'Senate';
/** '' when the roster lacks the member (never guessed as independent) */
export type Party = 'D' | 'R' | 'I' | '';
/** The Senate keeps the partial/full split; the House feed collapses it */
/** 'Sale': a sale the filing marks neither full nor partial (the vendor's bare "Sell") */
export type ReportType = 'Purchase' | 'Sale' | 'Sale (Full)' | 'Sale (Partial)' | 'Exchange';
/** Whose holding the report covers: the member, spouse, a joint account, a dependent */
/** 'Undisclosed': the filing does not say whose holding (shown as "not stated") */
export type ReportOwner = 'Self' | 'Spouse' | 'Joint' | 'Dependent' | 'Undisclosed';
export type AssetKind = 'Stock' | 'Stock Option' | 'Corporate Bond' | 'Asset-Backed Security' | 'Municipal Security' | 'Fund' | 'Crypto' | 'Other';

/** One of the ten statutory amount rungs, in the form's order A-J */
export interface AmountBracket {
  column: string;
  /** Lower bound in dollars, inclusive */
  low: number;
  /** Upper bound, or null for the open-ended top rung */
  high: number | null;
  label: string;
}

export interface Member {
  id: string;
  name: string;
  chamber: Chamber;
  party: Party;
  state: string;
  /** House members only */
  district?: string;
  /** Committee seats: the join that carries the signal */
  committees: string[];
}

export interface CongressTrade {
  id: string;
  member: Member;
  ticker: string;
  /** What the filing wrote in the asset field */
  assetDescription: string;
  assetKind: AssetKind;
  type: ReportType;
  owner: ReportOwner;
  /** Index into AMOUNT_BRACKETS, or null when the filing was unparsed */
  bracket: number | null;
  /** Days from trade to filing; can be negative on a real feed */
  lagDays: number;
  tradedDaysAgo: number;
  filedDaysAgo: number;
  /** Past the STOCK Act's 45-day outer bound */
  late: boolean;
  /** The committee of the member's with jurisdiction over this sector, if any */
  /** The trade and filing days as the vendor wrote them (New York days, "YYYY-MM-DD") */
  tradedOn?: string;
  filedOn?: string;
  /** An open-ended amount as filed ("Over $1,000,000"): the bracket is its lowest rung, the label the filing's words */
  amountOver?: number;
}

export interface CongressFeed {
  trades: CongressTrade[];
  /** The disclosed value as a range: bracket floors summed, and the ceilings */
  totalLow: number;
  /** Null when an open-ended top rung makes the ceiling unknowable */
  totalHigh: number | null;
  unknownAmounts: number;
  purchases: number;
  sales: number;
  lateFilings: number;
  medianLag: number;
  windowDays: number;
  /** Rows whose type could not be read, counted rather than dropped */
  unreadTypes?: number;
  /** Rows tagged house/senate whose person the politician list does not carry as a member: left out */
  notMembers?: number;
  /** Each left-out executive-branch filing's trade age in days, so a window can count its own */
  notMemberAges?: number[];
}

/* ---- Insiders ------------------------------------------------------------------ */

export type InsiderRole = 'CEO' | 'CFO' | 'COO' | 'Director' | 'EVP' | 'Chief Legal Officer' | 'Officer' | '10% owner' | 'Other';
export type InsiderKind = 'BUY' | 'SELL';
/** The Form 4 transaction codes modelled: the row's identity */
export type TxCode = 'P' | 'S' | 'A' | 'M' | 'F' | 'G' | 'D';
/** Under a 10b5-1 plan, chosen, or from a filing without the box */
export type PlanState = 'plan' | 'discretionary' | 'unknown';
export type InsiderSignal = 'accumulating' | 'distributing' | 'flat' | 'scheduled selling' | 'quiet';

export interface TxCodeMeta {
  code: TxCode;
  label: string;
  /** Did the filer choose the trade, so its price and timing carry a view? */
  discretionary: boolean;
  /** Did shares change hands in the market? */
  openMarket: boolean;
  /** Does the row add shares to the holding, or take them out? */
  acquires: boolean;
  note: string;
}

export interface InsiderTrade {
  id: string;
  ticker: string;
  role: InsiderRole;
  person: string;
  code: TxCode;
  kind: InsiderKind;
  shares: number;
  /** The filed price per share */
  price: number;
  /** Shares times price in dollars; 0 when the price is not in dollars (`foreignPrice`) */
  value: number;
  /** A foreign issuer's filing priced in its home currency: flagged and kept out of every dollar total. `listed` is the
      US listing's price, `filedValue` shares times the filed price. */
  foreignPrice?: { listed: number; filedValue: number };
  /** Held indirectly (a trust, fund or family member): the stake is read against that line's holding only */
  indirect?: string;
  daysAgo: number;
  plan: PlanState;
  /** Distinct filers acting the same way in this name inside 30 days */
  clusterCount: number;
  /** Shares still held afterwards */
  heldAfter: number;
  /** Percent of the holding this trade was */
  stakePct: number;
  /** Percent the name has moved since, signed */
  sincePct: number;
  /** The live feed's own facts, when it sent them */
  company?: string;
  /** The vendor's sector word ("Healthcare", "Financial Services") */
  sector?: string;
  marketCap?: number | null;
  /** The reporting owner's SEC CIK: one insider across companies and filings */
  cik?: string;
  /** The officer title as filed */
  title?: string;
  /** The trade day as filed, "YYYY-MM-DD" */
  tradedOn?: string;
  /** Every reporting owner on a joint filing (one trade filed by related owners is one row) */
  owners?: string[];
  /** The reporter is a company or fund: a purchase is a corporate or strategic stake, not an insider's choice */
  entity?: boolean;
  /** The day the filing (or its latest amendment) was filed, "YYYY-MM-DD" */
  filedOn?: string;
}

export interface InsiderFlow {
  ticker: string;
  trades: InsiderTrade[];
  /** 'loading' until the read lands; nothing is reported as none before then */
  status?: 'loading' | 'live' | 'sim';
  /** Dollars bought and sold on the market in the window */
  bought: number;
  sold: number;
  net: number;
  /** Dollars of selling that ran off a schedule rather than a decision */
  plannedValue: number;
  /** Dollars of compensation plumbing (grants, conversions, withholdings), kept apart */
  compValue: number;
  /** Distinct filers who bought on the market inside 30 days */
  buyerCluster: number;
  /** Dollars of discretionary buying: the informative subset */
  openMarketBuys: number;
  /** Dollars of selling the filing marks chosen (not 10b5-1); an unstated sale is neither planned nor chosen */
  chosenSold: number;
  signal: InsiderSignal;
  windowDays: number;
}
