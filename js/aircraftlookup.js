const ADSBDB_URL = "https://api.adsbdb.com/v0/aircraft/";
const REQUEST_TIMEOUT_MS = 6000;

// Maps ADS-B Exchange/adsbdb ICAO type designators to the friendly labels used
// in this app's aircraft-type combo, so an online lookup's result reads the
// same way a user would have typed it by hand (e.g. "B738" -> "737-800").
// Not exhaustive — anything unmapped falls back to the raw ICAO code.
const ICAO_TYPE_LABELS = {
  A318: "A318",
  A319: "A319",
  A320: "A320",
  A20N: "A320neo",
  A321: "A321",
  A21N: "A321neo",
  BCS1: "A220-100",
  BCS3: "A220-300",
  A332: "A330-200",
  A333: "A330-300",
  A339: "A330-900neo",
  A342: "A340-300",
  A343: "A340-300",
  A345: "A340-600",
  A346: "A340-600",
  A359: "A350-900",
  A35K: "A350-1000",
  A388: "A380-800",
  B734: "737-400",
  B735: "737-500",
  B736: "737-600",
  B737: "737-700",
  B738: "737-800",
  B739: "737-900",
  B38M: "737 MAX 8",
  B39M: "737 MAX 9",
  B744: "747-400",
  B748: "747-8",
  B752: "757-200",
  B753: "757-300",
  B762: "767-200",
  B763: "767-300",
  B764: "767-400",
  B772: "777-200",
  B77L: "777-200ER",
  B773: "777-300ER",
  B77W: "777-300ER",
  B788: "787-8",
  B789: "787-9",
  B78X: "787-10",
  CRJ7: "CRJ-700",
  CRJ9: "CRJ-900",
  E170: "E170",
  E75L: "E175",
  E75S: "E175",
  E190: "E190",
  E195: "E195",
  AT72: "ATR 72",
  AT76: "ATR 72",
  DH8D: "Dash 8 Q400",
};

/**
 * Online-only lookup of an aircraft's type from its registration (tail number),
 * via the free adsbdb.com registry — used so the aircraft-type field can fill
 * itself in the first time a registration is ever entered, not just on repeats.
 * @returns {Promise<{type: string, manufacturer: string|null}|null>} null if the
 * registration is unknown to the registry.
 * @throws on network failure/timeout — callers should catch and fail silently,
 * since this is a best-effort convenience for an optional field.
 */
export async function lookupAircraftType(registration, { signal } = {}) {
  const reg = (registration || "").trim();
  if (!reg) return null;

  const ownController = signal ? null : new AbortController();
  const effectiveSignal = signal || ownController.signal;
  const timeoutId = ownController ? setTimeout(() => ownController.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    const res = await fetch(`${ADSBDB_URL}${encodeURIComponent(reg)}`, { signal: effectiveSignal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Aircraft lookup failed (${res.status})`);
    const json = await res.json();
    const aircraft = json?.response?.aircraft;
    if (!aircraft) return null;
    const icao = (aircraft.icao_type || "").toUpperCase();
    const type = ICAO_TYPE_LABELS[icao] || aircraft.icao_type || null;
    if (!type) return null;
    return { type, manufacturer: aircraft.manufacturer || null };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
