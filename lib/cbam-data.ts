/**
 * EU Carbon Border Adjustment Mechanism (CBAM) goods catalogue.
 *
 * CN codes, names and sectors only. NO default emission values ship here.
 *
 * Earlier versions carried a "default factor" per good, cited to Implementing
 * Regulation (EU) 2023/1773 Annex III. That annex sets monitoring rules, not
 * default values, and checked against the Commission's published transitional
 * default values (DG TAXUD, 22 Dec 2023) most figures did not match — unwrought
 * aluminium was 58% high, structures (7308) less than half. Default values
 * are also set per period (transitional, then definitive from 2026) and, for
 * electricity, per country. So the calculator asks for the value and its
 * source: a supplier's verified embedded emissions, or the default value from
 * the Commission's current publication, cited with its date.
 *
 * Units: tCO₂e per tonne of product, EXCEPT electricity, which is per MWh.
 */

export type CBAMSector =
  | 'Cement'
  | 'Iron & Steel'
  | 'Aluminium'
  | 'Fertilisers'
  | 'Electricity'
  | 'Hydrogen';

export interface CBAMCommodity {
  cnCode: string;         // Combined Nomenclature code (EU customs tariff)
  name: string;           // Commodity name
  sector: CBAMSector;
  unit: 'tonne' | 'MWh'; // Base unit for the factor
  notes?: string;
}

export const CBAM_COMMODITIES: CBAMCommodity[] = [
  // ─── CEMENT ────────────────────────────────────────────────────────────────
  {
    cnCode: '2523 10',
    name: 'Cement clinkers',
    sector: 'Cement',
    unit: 'tonne',
  },
  {
    cnCode: '2523 21',
    name: 'White Portland cement',
    sector: 'Cement',
    unit: 'tonne',
  },
  {
    cnCode: '2523 29',
    name: 'Portland cement (other than white)',
    sector: 'Cement',
    unit: 'tonne',
  },
  {
    cnCode: '2523 30',
    name: 'Aluminous cement',
    sector: 'Cement',
    unit: 'tonne',
  },
  {
    cnCode: '2523 90',
    name: 'Other hydraulic cements',
    sector: 'Cement',
    unit: 'tonne',
  },

  // ─── IRON & STEEL ──────────────────────────────────────────────────────────
  {
    cnCode: '7201',
    name: 'Pig iron and spiegeleisen (in pigs, blocks or other primary forms)',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7206',
    name: 'Iron and non-alloy steel in ingots or other primary forms',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7207',
    name: 'Semi-finished products of iron or non-alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7208',
    name: 'Flat-rolled iron/steel, hot-rolled, width ≥600 mm, not clad/plated',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7209',
    name: 'Flat-rolled iron/steel, cold-rolled, width ≥600 mm, not clad/plated',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7210',
    name: 'Flat-rolled iron/steel, width ≥600 mm, clad/plated/coated',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7211',
    name: 'Flat-rolled iron/steel, width <600 mm, not clad/plated/coated',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7212',
    name: 'Flat-rolled iron/steel, width <600 mm, clad/plated/coated',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7213',
    name: 'Bars and rods, hot-rolled, in irregularly wound coils (non-alloy steel)',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7214',
    name: 'Bars and rods of iron/non-alloy steel, not further worked than forged/hot-rolled',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7215',
    name: 'Other bars and rods of iron/non-alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7216',
    name: 'Angles, shapes and sections of iron/non-alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7217',
    name: 'Wire of iron or non-alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7219',
    name: 'Flat-rolled stainless steel, width ≥600 mm',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7220',
    name: 'Flat-rolled stainless steel, width <600 mm',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7221',
    name: 'Bars/rods of stainless steel, hot-rolled in coils',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7222',
    name: 'Other bars/rods of stainless steel; angles/shapes of stainless steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7223',
    name: 'Wire of stainless steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7225',
    name: 'Flat-rolled other alloy steel, width ≥600 mm',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7226',
    name: 'Flat-rolled other alloy steel, width <600 mm',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7227',
    name: 'Bars/rods of other alloy steel, hot-rolled in irregularly wound coils',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7228',
    name: 'Other bars/rods of other alloy steel; angles/shapes of other alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7229',
    name: 'Wire of other alloy steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7301',
    name: 'Sheet piling and welded angles/shapes/sections of iron/steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7302',
    name: 'Railway/tramway track construction material of iron/steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7304',
    name: 'Tubes and pipes, seamless, of iron or steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7305',
    name: 'Other tubes and pipes (e.g., large diameter longitudinally welded)',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7306',
    name: 'Other tubes/pipes/hollow profiles of iron/steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7307',
    name: 'Tube or pipe fittings of iron or steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },
  {
    cnCode: '7308',
    name: 'Structures and structural parts of iron or steel',
    sector: 'Iron & Steel',
    unit: 'tonne',
  },

  // ─── ALUMINIUM ─────────────────────────────────────────────────────────────
  {
    cnCode: '7601 10',
    name: 'Unwrought aluminium, not alloyed (primary)',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7601 20',
    name: 'Unwrought aluminium alloys',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7604',
    name: 'Aluminium bars, rods and profiles',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7605',
    name: 'Aluminium wire',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7606',
    name: 'Aluminium plates, sheets and strip, thickness >0.2 mm',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7607',
    name: 'Aluminium foil (thickness ≤0.2 mm)',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7608',
    name: 'Aluminium tubes and pipes',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7609',
    name: 'Aluminium tube or pipe fittings',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7610',
    name: 'Aluminium structures and structural parts',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7611',
    name: 'Aluminium reservoirs, tanks, vats and similar containers',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7612',
    name: 'Aluminium casks, drums, cans and similar containers',
    sector: 'Aluminium',
    unit: 'tonne',
  },
  {
    cnCode: '7616',
    name: 'Other articles of aluminium',
    sector: 'Aluminium',
    unit: 'tonne',
  },

  // ─── FERTILISERS ───────────────────────────────────────────────────────────
  {
    cnCode: '2808 00',
    name: 'Nitric acid; sulphonitric acids',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '2814 10',
    name: 'Ammonia, anhydrous',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '2814 20',
    name: 'Ammonia in aqueous solution',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 10',
    name: 'Urea, whether or not in aqueous solution',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 21',
    name: 'Ammonium sulphate',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 30',
    name: 'Ammonium nitrate',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 40',
    name: 'Mixtures of ammonium nitrate with calcium carbonate (CAN)',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 50',
    name: 'Sodium nitrate',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 60',
    name: 'Double salts and mixtures of calcium nitrate and ammonium nitrate',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 80',
    name: 'Mixtures of urea and ammonium nitrate in aqueous/ammoniacal solution (UAN)',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3102 90',
    name: 'Other nitrogenous mineral/chemical fertilisers',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3105 20',
    name: 'Mineral/chemical fertilisers containing N, P and K (NPK)',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3105 51',
    name: 'Mineral/chemical fertilisers containing nitrates and phosphates (NP)',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3105 59',
    name: 'Other NP mineral/chemical fertilisers',
    sector: 'Fertilisers',
    unit: 'tonne',
  },
  {
    cnCode: '3105 90',
    name: 'Other mineral/chemical fertilisers',
    sector: 'Fertilisers',
    unit: 'tonne',
  },

  // ─── ELECTRICITY ───────────────────────────────────────────────────────────
  {
    cnCode: '2716 00',
    name: 'Electrical energy',
    sector: 'Electricity',
    unit: 'MWh',
  },

  // ─── HYDROGEN ──────────────────────────────────────────────────────────────
  {
    cnCode: '2804 10',
    name: 'Hydrogen',
    sector: 'Hydrogen',
    unit: 'tonne',
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/** Search commodities by CN code prefix or name fragment (case-insensitive) */
export function searchCBAMCommodities(query: string): CBAMCommodity[] {
  if (!query.trim()) return CBAM_COMMODITIES;
  const q = query.trim().toLowerCase();
  return CBAM_COMMODITIES.filter(
    (c) =>
      c.cnCode.replace(/\s/g, '').startsWith(q.replace(/\s/g, '')) ||
      c.cnCode.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.sector.toLowerCase().includes(q),
  );
}

/** Find a commodity by exact CN code */
export function findCBAMCommodityByCN(cnCode: string): CBAMCommodity | undefined {
  return CBAM_COMMODITIES.find((c) => c.cnCode === cnCode);
}

// ─── Definitive-period scope ──────────────────────────────────────────────────

/**
 * Sectors whose CBAM certificates cover DIRECT embedded emissions only in the
 * definitive period (from 2026): Regulation (EU) 2023/956, Annex II lists
 * iron and steel, aluminium and hydrogen. Cement, fertilisers and electricity
 * count indirect emissions too.
 */
export const DIRECT_ONLY_SECTORS: readonly CBAMSector[] = ['Iron & Steel', 'Aluminium', 'Hydrogen'];

export function directEmissionsOnly(sector: CBAMSector): boolean {
  return DIRECT_ONLY_SECTORS.includes(sector);
}

// ─── Calculation ──────────────────────────────────────────────────────────────

export interface CBAMCalculationInput {
  commodity: CBAMCommodity;
  quantity: number;               // in the commodity's base unit (tonnes or MWh)
  massUnit: 'kg' | 'tonnes' | 'MWh';
  emissionFactor: number;         // tCO₂e per tonne (or MWh for electricity)
  factorType: 'eu_default' | 'supplier_provided';
  certificatePriceEur: number;    // €/tCO₂e certificate price
}

export interface CBAMCalculationResult {
  quantityTonnes: number;         // normalised to tonnes (or MWh for electricity)
  totalTCO2e: number;
  estimatedCostEur: number;
}

export function calculateCBAM(input: CBAMCalculationInput): CBAMCalculationResult {
  // Normalise input quantity to tonnes (MWh already passes through)
  let quantityTonnes: number;
  if (input.massUnit === 'kg') {
    quantityTonnes = input.quantity / 1000;
  } else {
    quantityTonnes = input.quantity; // tonnes or MWh
  }

  const totalTCO2e = quantityTonnes * input.emissionFactor;
  const estimatedCostEur = totalTCO2e * input.certificatePriceEur;

  return {
    quantityTonnes,
    totalTCO2e,
    estimatedCostEur,
  };
}

// ─── Country list ─────────────────────────────────────────────────────────────

/**
 * Countries subject to CBAM (non-EU).
 * Sorted alphabetically.
 */
export const CBAM_COUNTRIES: string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Angola', 'Argentina', 'Armenia',
  'Australia', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Belarus', 'Bolivia',
  'Bosnia and Herzegovina', 'Brazil', 'Canada', 'Chile', 'China', 'Colombia',
  'Democratic Republic of the Congo', 'Ecuador', 'Egypt', 'Ethiopia',
  'Georgia', 'Ghana', 'Hong Kong', 'India', 'Indonesia', 'Iran', 'Iraq',
  'Israel', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan',
  'Lebanon', 'Libya', 'Malaysia', 'Mexico', 'Moldova', 'Mongolia', 'Morocco',
  'Mozambique', 'Myanmar', 'Nepal', 'New Zealand', 'Nigeria', 'North Korea',
  'North Macedonia', 'Oman', 'Pakistan', 'Peru', 'Philippines', 'Qatar',
  'Russia', 'Saudi Arabia', 'Serbia', 'Singapore', 'South Africa',
  'South Korea', 'Sri Lanka', 'Sudan', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda',
  'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
  'Other',
];

// ─── Sector colour map for badges ────────────────────────────────────────────

export const SECTOR_COLORS: Record<CBAMSector, string> = {
  'Cement':      'bg-amber-100 text-amber-800',
  'Iron & Steel': 'bg-slate-100 text-slate-800',
  'Aluminium':   'bg-sky-100 text-sky-800',
  'Fertilisers': 'bg-green-100 text-green-800',
  'Electricity': 'bg-yellow-100 text-yellow-800',
  'Hydrogen':    'bg-purple-100 text-purple-800',
};

// No default certificate price is shipped. A hardcoded figure goes stale and
// then quietly prices every estimate; the calculator asks for the price used.
