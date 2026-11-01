export const OI_ROOTS: Record<string, string[]>;
export function oiRootsOf(ticker: string): string[];
export const OI_READY_MIN: number;
export function oiReportDay(ms: number): string;
export function priorSession(day: string): string;
/** `${expiry}|${strike}|${C|P}` → open interest */
export type OiReport = Record<string, number>;
export function readOiReport(json: unknown): OiReport;
export function mergeReports(reports: Iterable<OiReport>): OiReport;
/** [expiry, strike, right, change in contracts] */
export type OiChangeTuple = [string, number, 'C' | 'P', number];
export function oiChangeRows(now: OiReport, prior: OiReport, from: string): OiChangeTuple[];
