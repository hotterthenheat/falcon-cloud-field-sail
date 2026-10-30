/* The names a firm's options evaluation may trade, as data: each list with the page it was read from and the date it
   was read. rules.ts reads `underlyings` (a plan's list) and refuses a way in on a name that is not on it. The firm's own
   page governs — its list changes.

   Options Funding: optionsfunding.co/ticker-whitelist, "275 supported", read 2026-10-29. Strix Options Funding names a
   275-symbol whitelist of its own (strixoptionsfunding.com/#/ticker-whitelist, built from its assets/data/tickers.json),
   but that list was not read, so it is not assumed to be the same one: a Strix plan trades any name here and says the
   firm's list is not checked. */

export interface NameList {
  firm: string;
  url: string;
  /** When the list was read (YYYY-MM-DD) */
  asOf: string;
  /** The page's own words for its size */
  says: string;
  names: string[];
}

/** A ticker as a list compares it: upper case, letters and digits only ("BRK.B" and "BRK/B" are the list's BRKB) */
export const listKey = (ticker: string): string => ticker.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const OPTIONS_FUNDING_WHITELIST: NameList = {
  firm: 'Options Funding',
  url: 'https://optionsfunding.co/ticker-whitelist',
  asOf: '2026-10-29',
  says: '275 supported',
  names: [
  'AAL', 'AAOI', 'AAPL', 'ABBV', 'ABNB', 'ABT', 'ACHR', 'ADBE', 'AEHR', 'AEM', 'AFRM', 'AG', 'AKAM', 'ALAB', 'ALB',
  'AMC', 'AMD', 'AMZN', 'ANET', 'APA', 'APLD', 'APP', 'ARM', 'ASML', 'ASTS', 'AVAV', 'AVGO', 'AXP', 'B', 'BA',
  'BABA', 'BAC', 'BB', 'BBY', 'BCS', 'BE', 'BG', 'BHP', 'BIDU', 'BMNR', 'BMY', 'BP', 'BRKB', 'BTI', 'BULL', 'C',
  'CAT', 'CCJ', 'CCL', 'CELH', 'CGMX', 'CIEN', 'CIFR', 'CLS', 'CLSK', 'CMCSA', 'CMG', 'COF', 'COIN', 'COPX', 'COST',
  'CRCL', 'CRDO', 'CRM', 'CRWD', 'CRWV', 'CSCO', 'CVNA', 'CVS', 'CVX', 'DAL', 'DDOG', 'DELL', 'DIA', 'DIS', 'DJX',
  'DOW', 'DRAM', 'DUOL', 'EBAY', 'EEM', 'ENPH', 'EOSE', 'EQNR', 'ETHA', 'ETSY', 'EWY', 'EWZ', 'F', 'FCEL', 'FCX',
  'FDX', 'FIG', 'FISV', 'FIX', 'FN', 'FSLY', 'FXI', 'GDX', 'GE', 'GEF', 'GFI', 'GH', 'GLD', 'GLOB', 'GLW', 'GME',
  'GOLD', 'GOOG', 'GOOGL', 'GS', 'HAL', 'HD', 'HIMS', 'HL', 'HOOD', 'HPQ', 'HRB', 'HWM', 'HYG', 'IBIT', 'IBM', 'IGV',
  'INTC', 'INTU', 'IONQ', 'IREN', 'IWM', 'JNJ', 'JOBY', 'JPM', 'KLAC', 'KMI', 'KO', 'KR', 'KWEB', 'LITE', 'LLY',
  'LRCX', 'LULU', 'LYFT', 'MA', 'MARA', 'MBLY', 'MCD', 'META', 'MMM', 'MNST', 'MRK', 'MRNA', 'MRUT', 'MRVL', 'MS',
  'MSFT', 'MSTR', 'MU', 'MXL', 'NBIS', 'NEE', 'NEM', 'NET', 'NFLX', 'NIO', 'NKE', 'NOK', 'NOW', 'NRG', 'NU', 'NVDA',
  'NVO', 'NVS', 'OEX', 'OKLO', 'ON', 'ONDS', 'OPEN', 'ORCL', 'OSCR', 'OUST', 'OXY', 'PAAS', 'PANW', 'PATH', 'PDD',
  'PEP', 'PFE', 'PG', 'PINS', 'PLTR', 'PM', 'POET', 'PYPL', 'QBTS', 'QCOM', 'QQQ', 'QUBT', 'RBLX', 'RDDT', 'RGTI',
  'RIOT', 'RIVN', 'RKLB', 'RKT', 'ROKU', 'RUT', 'RUTW', 'SBUX', 'SCHW', 'SE', 'SHW', 'SILJ', 'SLB', 'SLV', 'SMCI',
  'SMH', 'SNAP', 'SNDK', 'SNOW', 'SOFI', 'SOUN', 'SOXL', 'SPCE', 'SPCX', 'SPX', 'SPXW', 'SPY', 'STRA', 'STX', 'STZ',
  'SWKS', 'T', 'TEM', 'TGT', 'TJX', 'TLN', 'TLT', 'TQQQ', 'TSLA', 'TSM', 'TTD', 'TXN', 'U', 'UAL', 'UBER', 'UBS',
  'UMC', 'UNH', 'UPS', 'UPST', 'USO', 'UUUU', 'V', 'VERA', 'VICR', 'VIX', 'VIXW', 'VLO', 'VRT', 'VST', 'VZ', 'WBA',
  'WDC', 'WFC', 'WMB', 'WMT', 'WULF', 'WYFI', 'XEO', 'XLE', 'XOM', 'XSP', 'XYZ', 'YPF', 'ZETA', 'ZS'
  ],
};
