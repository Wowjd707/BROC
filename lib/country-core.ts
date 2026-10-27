/**
 * Normalise a site's free-text country to an ISO 3166-1 alpha-2 code.
 *
 * `sites.country` is free text (default 'USA'), while factor tables key
 * countries by ISO-2 ('DE', 'GB'). Without this, no non-US site could match a
 * country-level factor, and every site fell back to US values. Unknown input
 * returns null so the caller can refuse rather than guess.
 */

const NAMES: Record<string, string> = {
  // United States
  'usa': 'US', 'us': 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states': 'US',
  'united states of america': 'US', 'america': 'US',
  // United Kingdom
  'uk': 'GB', 'u.k.': 'GB', 'gbr': 'GB', 'united kingdom': 'GB', 'great britain': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  // EU, EEA and Switzerland (the AIB residual-mix area)
  'aut': 'AT', 'austria': 'AT', 'bel': 'BE', 'belgium': 'BE', 'bgr': 'BG', 'bulgaria': 'BG',
  'hrv': 'HR', 'croatia': 'HR', 'cyp': 'CY', 'cyprus': 'CY', 'cze': 'CZ', 'czechia': 'CZ',
  'czech republic': 'CZ', 'dnk': 'DK', 'denmark': 'DK', 'est': 'EE', 'estonia': 'EE',
  'fin': 'FI', 'finland': 'FI', 'fra': 'FR', 'france': 'FR', 'deu': 'DE', 'germany': 'DE',
  'grc': 'GR', 'greece': 'GR', 'hun': 'HU', 'hungary': 'HU', 'irl': 'IE', 'ireland': 'IE',
  'ita': 'IT', 'italy': 'IT', 'lva': 'LV', 'latvia': 'LV', 'ltu': 'LT', 'lithuania': 'LT',
  'lux': 'LU', 'luxembourg': 'LU', 'mlt': 'MT', 'malta': 'MT', 'nld': 'NL', 'netherlands': 'NL',
  'the netherlands': 'NL', 'holland': 'NL', 'pol': 'PL', 'poland': 'PL', 'prt': 'PT',
  'portugal': 'PT', 'rou': 'RO', 'romania': 'RO', 'svk': 'SK', 'slovakia': 'SK', 'svn': 'SI',
  'slovenia': 'SI', 'esp': 'ES', 'spain': 'ES', 'swe': 'SE', 'sweden': 'SE', 'nor': 'NO',
  'norway': 'NO', 'isl': 'IS', 'iceland': 'IS', 'che': 'CH', 'switzerland': 'CH',
  // Other common manufacturing locations
  'can': 'CA', 'canada': 'CA', 'mex': 'MX', 'mexico': 'MX', 'bra': 'BR', 'brazil': 'BR',
  'chn': 'CN', 'china': 'CN', 'ind': 'IN', 'india': 'IN', 'jpn': 'JP', 'japan': 'JP',
  'kor': 'KR', 'south korea': 'KR', 'korea': 'KR', 'aus': 'AU', 'australia': 'AU',
  'zaf': 'ZA', 'south africa': 'ZA', 'sgp': 'SG', 'singapore': 'SG', 'tur': 'TR', 'turkey': 'TR',
  'türkiye': 'TR', 'are': 'AE', 'united arab emirates': 'AE', 'uae': 'AE',
};

export function toIso2(country: string | null | undefined): string | null {
  if (!country) return null;
  const raw = country.trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (NAMES[key]) return NAMES[key];
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return null;
}

/** True when the site is in the United States (eGRID applies). Blank counts as US, the column default. */
export function isUsSite(country: string | null | undefined): boolean {
  if (!country || !country.trim()) return true;
  return toIso2(country) === 'US';
}
