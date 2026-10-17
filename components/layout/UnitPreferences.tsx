'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  DEFAULT_UNITS, UNIT_OPTIONS, normalizePreferences,
  type UnitPreferences, type MetricFamily,
} from '@/lib/units';

const STORAGE_KEY = 'esg.unitPreferences';

interface UnitContextValue {
  units: UnitPreferences;
  setUnit: (family: MetricFamily, value: string) => void;
  /** False until the stored preference has been read, so SSR and first paint agree. */
  hydrated: boolean;
}

const UnitContext = createContext<UnitContextValue>({
  units: DEFAULT_UNITS,
  setUnit: () => {},
  hydrated: false,
});

export function useUnits() {
  return useContext(UnitContext);
}

/**
 * Display-unit preferences, persisted per browser.
 *
 * Deliberately a *view* preference, not org configuration: it changes nothing
 * that is stored or reported, so it needs no migration and no write path. If
 * this later needs to be an org-wide reporting default, it moves to the
 * organizations table — the formatting layer would not change.
 */
export function UnitPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits] = useState<UnitPreferences>(DEFAULT_UNITS);
  const [hydrated, setHydrated] = useState(false);

  // Browser storage does not exist during server rendering, so the saved
  // preference can only be read after mount. Reading it in a lazy initialiser
  // instead would render different HTML on server and client (a hydration
  // mismatch), which is why this is the one legitimate setState-in-effect here.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      if (raw) setUnits(normalizePreferences(JSON.parse(raw)));
    } catch {
      // Corrupt or unavailable storage — defaults are already in place.
    }
    setHydrated(true);
  }, []);

  const setUnit = useCallback((family: MetricFamily, value: string) => {
    setUnits((prev) => {
      const next = normalizePreferences({ ...prev, [family]: value });
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal: the choice still applies for this session.
      }
      return next;
    });
  }, []);

  return (
    <UnitContext.Provider value={{ units, setUnit, hydrated }}>
      {children}
    </UnitContext.Provider>
  );
}

/** Compact unit switcher for report headers. */
export function UnitToggle({ families }: { families: MetricFamily[] }) {
  const { units, setUnit } = useUnits();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {families.map((family) => (
        <label key={family} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="capitalize">{family}</span>
          <select
            value={units[family]}
            onChange={(e) => setUnit(family, e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {UNIT_OPTIONS[family].map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
