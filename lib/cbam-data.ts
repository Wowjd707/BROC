/**
 * EU Carbon Border Adjustment Mechanism (CBAM) commodity data.
 *
 * Default emission factors are sourced from:
 *   Commission Implementing Regulation (EU) 2023/1773, Annex III
 *   (default values for embedded emissions where actual data is unavailable)
 *
 * Units: tCO₂e per tonne of product, EXCEPT electricity which is tCO₂e per MWh.
 *
 * IMPORTANT: These are default/fallback values. Actual CBAM declarations must use
 * verified emissions where available. Consult a CBAM compliance advisor for
 * regulatory filings.
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
  defaultFactor: number;  // tCO₂e per tonne (or tCO₂e per MWh for electricity)
  unit: 'tonne' | 'MWh'; // Base unit for the factor
  notes?: string;
}

export const CBAM_COMMODITIES: CBAMCommodity[] = [
  // ─── CEMENT ────────────────────────────────────────────────────────────────
  {
    cnCode: '2523 10',
    name: 'Cement clinkers',
    sector: 'Cement',
    defaultFactor: 0.8442,
    unit: 'tonne',
  },
  {
    cnCode: '2523 21',
    name: 'White Portland cement',
    sector: 'Cement',
    defaultFactor: 0.7690,
    unit: 'tonne',
  },
  {
    cnCode: '2523 29',
    name: 'Portland cement (other than white)',
    sector: 'Cement',
    defaultFactor: 0.7690,
    unit: 'tonne',
  },
  {
    cnCode: '2523 30',
    name: 'Aluminous cement',
    sector: 'Cement',
    defaultFactor: 0.8510,
    unit: 'tonne',
  },
  {
    cnCode: '2523 90',
    name: 'Other hydraulic cements',
    sector: 'Cement',
    defaultFactor: 0.7690,
    unit: 'tonne',
  },

  // ─── IRON & STEEL ──────────────────────────────────────────────────────────
  {
    cnCode: '7201',
    name: 'Pig iron and spiegeleisen (in pigs, blocks or other primary forms)',
    sector: 'Iron & Steel',
    defaultFactor: 1.6800,
    unit: 'tonne',
  },
  {
    cnCode: '7206',
    name: 'Iron and non-alloy steel in ingots or other primary forms',
    sector: 'Iron & Steel',
    defaultFactor: 2.3100,
    unit: 'tonne',
  },
  {
    cnCode: '7207',
    name: 'Semi-finished products of iron or non-alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7208',
    name: 'Flat-rolled iron/steel, hot-rolled, width ≥600 mm, not clad/plated',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7209',
    name: 'Flat-rolled iron/steel, cold-rolled, width ≥600 mm, not clad/plated',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7210',
    name: 'Flat-rolled iron/steel, width ≥600 mm, clad/plated/coated',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7211',
    name: 'Flat-rolled iron/steel, width <600 mm, not clad/plated/coated',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7212',
    name: 'Flat-rolled iron/steel, width <600 mm, clad/plated/coated',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7213',
    name: 'Bars and rods, hot-rolled, in irregularly wound coils (non-alloy steel)',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7214',
    name: 'Bars and rods of iron/non-alloy steel, not further worked than forged/hot-rolled',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7215',
    name: 'Other bars and rods of iron/non-alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7216',
    name: 'Angles, shapes and sections of iron/non-alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7217',
    name: 'Wire of iron or non-alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7219',
    name: 'Flat-rolled stainless steel, width ≥600 mm',
    sector: 'Iron & Steel',
    defaultFactor: 3.7500,
    unit: 'tonne',
    notes: 'Stainless steel — higher factor due to alloying elements',
  },
  {
    cnCode: '7220',
    name: 'Flat-rolled stainless steel, width <600 mm',
    sector: 'Iron & Steel',
    defaultFactor: 3.7500,
    unit: 'tonne',
  },
  {
    cnCode: '7221',
    name: 'Bars/rods of stainless steel, hot-rolled in coils',
    sector: 'Iron & Steel',
    defaultFactor: 3.7500,
    unit: 'tonne',
  },
  {
    cnCode: '7222',
    name: 'Other bars/rods of stainless steel; angles/shapes of stainless steel',
    sector: 'Iron & Steel',
    defaultFactor: 3.7500,
    unit: 'tonne',
  },
  {
    cnCode: '7223',
    name: 'Wire of stainless steel',
    sector: 'Iron & Steel',
    defaultFactor: 3.7500,
    unit: 'tonne',
  },
  {
    cnCode: '7225',
    name: 'Flat-rolled other alloy steel, width ≥600 mm',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7226',
    name: 'Flat-rolled other alloy steel, width <600 mm',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7227',
    name: 'Bars/rods of other alloy steel, hot-rolled in irregularly wound coils',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7228',
    name: 'Other bars/rods of other alloy steel; angles/shapes of other alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7229',
    name: 'Wire of other alloy steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7301',
    name: 'Sheet piling and welded angles/shapes/sections of iron/steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7302',
    name: 'Railway/tramway track construction material of iron/steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7304',
    name: 'Tubes and pipes, seamless, of iron or steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7305',
    name: 'Other tubes and pipes (e.g., large diameter longitudinally welded)',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7306',
    name: 'Other tubes/pipes/hollow profiles of iron/steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7307',
    name: 'Tube or pipe fittings of iron or steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },
  {
    cnCode: '7308',
    name: 'Structures and structural parts of iron or steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.1230,
    unit: 'tonne',
  },

  // ─── ALUMINIUM ─────────────────────────────────────────────────────────────
  {
    cnCode: '7601 10',
    name: 'Unwrought aluminium, not alloyed (primary)',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
    notes: 'World average including indirect process emissions from electricity',
  },
  {
    cnCode: '7601 20',
    name: 'Unwrought aluminium alloys',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7604',
    name: 'Aluminium bars, rods and profiles',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7605',
    name: 'Aluminium wire',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7606',
    name: 'Aluminium plates, sheets and strip, thickness >0.2 mm',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7607',
    name: 'Aluminium foil (thickness ≤0.2 mm)',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7608',
    name: 'Aluminium tubes and pipes',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7609',
    name: 'Aluminium tube or pipe fittings',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7610',
    name: 'Aluminium structures and structural parts',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7611',
    name: 'Aluminium reservoirs, tanks, vats and similar containers',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7612',
    name: 'Aluminium casks, drums, cans and similar containers',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },
  {
    cnCode: '7616',
    name: 'Other articles of aluminium',
    sector: 'Aluminium',
    defaultFactor: 16.5940,
    unit: 'tonne',
  },

  // ─── FERTILISERS ───────────────────────────────────────────────────────────
  {
    cnCode: '2808 00',
    name: 'Nitric acid; sulphonitric acids',
    sector: 'Fertilisers',
    defaultFactor: 1.3060,
    unit: 'tonne',
  },
  {
    cnCode: '2814 10',
    name: 'Ammonia, anhydrous',
    sector: 'Fertilisers',
    defaultFactor: 1.9500,
    unit: 'tonne',
  },
  {
    cnCode: '2814 20',
    name: 'Ammonia in aqueous solution',
    sector: 'Fertilisers',
    defaultFactor: 1.9500,
    unit: 'tonne',
    notes: 'Factor on NH₃ content basis; convert to product weight accordingly',
  },
  {
    cnCode: '3102 10',
    name: 'Urea, whether or not in aqueous solution',
    sector: 'Fertilisers',
    defaultFactor: 2.4350,
    unit: 'tonne',
  },
  {
    cnCode: '3102 21',
    name: 'Ammonium sulphate',
    sector: 'Fertilisers',
    defaultFactor: 1.1310,
    unit: 'tonne',
  },
  {
    cnCode: '3102 30',
    name: 'Ammonium nitrate',
    sector: 'Fertilisers',
    defaultFactor: 4.7440,
    unit: 'tonne',
    notes: 'Includes N₂O emissions from production',
  },
  {
    cnCode: '3102 40',
    name: 'Mixtures of ammonium nitrate with calcium carbonate (CAN)',
    sector: 'Fertilisers',
    defaultFactor: 4.7440,
    unit: 'tonne',
  },
  {
    cnCode: '3102 50',
    name: 'Sodium nitrate',
    sector: 'Fertilisers',
    defaultFactor: 1.8000,
    unit: 'tonne',
  },
  {
    cnCode: '3102 60',
    name: 'Double salts and mixtures of calcium nitrate and ammonium nitrate',
    sector: 'Fertilisers',
    defaultFactor: 1.8000,
    unit: 'tonne',
  },
  {
    cnCode: '3102 80',
    name: 'Mixtures of urea and ammonium nitrate in aqueous/ammoniacal solution (UAN)',
    sector: 'Fertilisers',
    defaultFactor: 3.5890,
    unit: 'tonne',
  },
  {
    cnCode: '3102 90',
    name: 'Other nitrogenous mineral/chemical fertilisers',
    sector: 'Fertilisers',
    defaultFactor: 2.0000,
    unit: 'tonne',
  },
  {
    cnCode: '3105 20',
    name: 'Mineral/chemical fertilisers containing N, P and K (NPK)',
    sector: 'Fertilisers',
    defaultFactor: 2.2000,
    unit: 'tonne',
  },
  {
    cnCode: '3105 51',
    name: 'Mineral/chemical fertilisers containing nitrates and phosphates (NP)',
    sector: 'Fertilisers',
    defaultFactor: 1.8500,
    unit: 'tonne',
  },
  {
    cnCode: '3105 59',
    name: 'Other NP mineral/chemical fertilisers',
    sector: 'Fertilisers',
    defaultFactor: 1.8500,
    unit: 'tonne',
  },
  {
    cnCode: '3105 90',
    name: 'Other mineral/chemical fertilisers',
    sector: 'Fertilisers',
    defaultFactor: 2.0000,
    unit: 'tonne',
  },

  // ─── ELECTRICITY ───────────────────────────────────────────────────────────
  {
    cnCode: '2716 00',
    name: 'Electrical energy',
    sector: 'Electricity',
    defaultFactor: 0.5010,
    unit: 'MWh',
    notes: 'Default world average; actual factor should reflect country-specific grid intensity',
  },

  // ─── HYDROGEN ──────────────────────────────────────────────────────────────
  {
    cnCode: '2804 10',
    name: 'Hydrogen',
    sector: 'Hydrogen',
    defaultFactor: 10.0000,
    unit: 'tonne',
    notes: 'Default based on steam methane reforming (SMR) production route',
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
