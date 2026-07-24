function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two {lat, lng} points, in kilometers. */
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough gate-to-gate estimate: ~30min taxi/climb/descent overhead + 800km/h cruise. */
export function estimateFlightHours(distanceKm) {
  return 0.5 + distanceKm / 800;
}

const EARTH_CIRCUMFERENCE_KM = 40075;

// Approximate real-world great-circle distances, for a "roughly like flying
// from..." comparison — not precise to the km, just recognizable reference points.
const DISTANCE_REFERENCES = [
  { km: 344, label: "London → Paris" },
  { km: 559, label: "Los Angeles → San Francisco" },
  { km: 1434, label: "London → Rome" },
  { km: 2400, label: "London → Athens" },
  { km: 3944, label: "Los Angeles → New York" },
  { km: 5570, label: "London → New York" },
  { km: 7800, label: "London → Bangkok" },
  { km: 9560, label: "London → Tokyo" },
  { km: 9680, label: "London → Cape Town" },
  { km: 12550, label: "New York → Cape Town" },
  { km: 15990, label: "New York → Sydney" },
  { km: 18320, label: "London → Auckland" },
];

/** A fun-facts pair for the total-distance stat: multiples of Earth's circumference, and the closest recognizable real flight. */
export function distanceComparison(totalKm) {
  if (!totalKm) return null;

  const circumferences = totalKm / EARTH_CIRCUMFERENCE_KM;
  const circumferenceText = `${circumferences.toFixed(circumferences >= 10 ? 0 : circumferences >= 1 ? 1 : 2)}× around the Earth`;

  // No single real flight is longer than ~half the globe's circumference — past
  // that, a cumulative total stops mapping to any one real route, so the
  // "closest flight" comparison is only shown while it's still meaningful.
  const maxReference = DISTANCE_REFERENCES[DISTANCE_REFERENCES.length - 1].km;
  let referenceText = null;
  if (totalKm <= maxReference * 1.3) {
    let closest = DISTANCE_REFERENCES[0];
    let bestDiff = Math.abs(totalKm - closest.km);
    for (const ref of DISTANCE_REFERENCES) {
      const diff = Math.abs(totalKm - ref.km);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = ref;
      }
    }
    referenceText = `about as far as ${closest.label}`;
  }

  return { circumferenceText, referenceText };
}

export function resolveCoords(cityId, airportCode, citiesById, airportsByCode) {
  if (airportCode && airportsByCode.has(airportCode)) {
    const a = airportsByCode.get(airportCode);
    return { lat: a.lat, lng: a.lng };
  }
  const city = citiesById.get(cityId);
  return city ? { lat: city.lat, lng: city.lng } : null;
}

/** Display name for a flight leg: the linked visited city if there is one, else the airport's own city/name. */
export function resolveLegName(cityId, airportCode, citiesById, airportsByCode) {
  const city = citiesById.get(cityId);
  if (city) return city.name;
  const airport = airportCode ? airportsByCode.get(airportCode) : null;
  if (airport) return airport.city || airport.name;
  return airportCode || cityId || "Unknown";
}

/** Same as resolveLegName, but with the IATA code appended (e.g. "Vienna (VIE)") when known. */
export function resolveLegLabel(cityId, airportCode, citiesById, airportsByCode) {
  const name = resolveLegName(cityId, airportCode, citiesById, airportsByCode);
  return airportCode ? `${name} (${airportCode})` : name;
}

/** Registration → aircraft type, built from any logged flight that has both — a tail number
 * is (almost) always the same specific aircraft, so this lets one flight's type stand in
 * for another flight logged with the same registration but no type of its own. */
function buildRegistrationTypeMap(connections) {
  const map = new Map();
  for (const conn of connections) {
    if (conn.aircraft && conn.aircraftType) {
      map.set(conn.aircraft.trim().toUpperCase(), conn.aircraftType);
    }
  }
  return map;
}

/** Best-effort aircraft type for a connection: its own, else inferred from its registration. */
function resolveAircraftType(conn, regTypeMap) {
  if (conn.aircraftType) return conn.aircraftType;
  const reg = (conn.aircraft || "").trim().toUpperCase();
  return reg ? regTypeMap.get(reg) || null : null;
}

/** Distance/time for a connection, as a single direct point-to-point flight. */
function computeConnectionDistanceHours(conn, citiesById, airportsByCode) {
  const from = resolveCoords(conn.from, conn.departureAirport, citiesById, airportsByCode);
  const to = resolveCoords(conn.to, conn.arrivalAirport, citiesById, airportsByCode);
  if (!from || !to) return { km: 0, hours: 0 };
  const km = haversineKm(from, to);
  return { km, hours: estimateFlightHours(km) };
}

export function computeFlightStats(connections, citiesById, airportsByCode) {
  let totalDistanceKm = 0;
  let totalHours = 0;
  let seatCount = 0;
  const airportSet = new Set();
  const airlineSet = new Set();
  const aircraftTypeSet = new Set();
  const regTypeMap = buildRegistrationTypeMap(connections);

  for (const conn of connections) {
    const { km, hours } = computeConnectionDistanceHours(conn, citiesById, airportsByCode);
    totalDistanceKm += km;
    totalHours += hours;
    if (conn.departureAirport) airportSet.add(conn.departureAirport.toUpperCase());
    if (conn.arrivalAirport) airportSet.add(conn.arrivalAirport.toUpperCase());
    const airlineKey = conn.airlineCode || conn.airline;
    if (airlineKey) airlineSet.add(airlineKey.toUpperCase());
    if (conn.seat) seatCount += 1;
    const resolvedType = resolveAircraftType(conn, regTypeMap);
    if (resolvedType) aircraftTypeSet.add(resolvedType);
  }

  return {
    totalDistanceKm,
    totalHours,
    flightCount: connections.length,
    airportCount: airportSet.size,
    airlineCount: airlineSet.size,
    seatCount,
    aircraftTypeCount: aircraftTypeSet.size,
  };
}

/**
 * Buckets logged seats ("14A") into a row x column heatmap grid, the way a
 * seat-picker shows during flight booking. We don't know each flight's real
 * aircraft layout, so this fills in the whole plane implied by your data —
 * every row from 1 up to the furthest back you've sat, every column from A up
 * to the widest you've sat — rather than only the exact seats you've logged,
 * so it reads as a full airplane instead of a sparse handful of cells.
 */
export function computeSeatHeatmap(connections) {
  const counts = new Map();
  let maxCount = 0;
  let maxRow = 0;
  let maxCol = "A";

  for (const conn of connections) {
    const seat = (conn.seat || "").trim().toUpperCase();
    const match = /^(\d{1,3})\s*([A-Z])$/.exec(seat);
    if (!match) continue;
    const rowNum = parseInt(match[1], 10);
    const colLetter = match[2];
    const key = `${rowNum}${colLetter}`;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > maxCount) maxCount = count;
    if (rowNum > maxRow) maxRow = rowNum;
    if (colLetter > maxCol) maxCol = colLetter;
  }

  const rows = [];
  for (let r = 1; r <= maxRow; r++) rows.push(r);

  const cols = [];
  for (let c = "A".charCodeAt(0); c <= maxCol.charCodeAt(0); c++) cols.push(String.fromCharCode(c));

  return {
    counts,
    rows,
    cols,
    maxCount,
    total: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

/**
 * Rich stats used by the Flights page's clickable tile breakdowns: per-flight
 * distance/duration, longest/shortest legs, per-airline and per-year totals,
 * yearly averages, and per-airport flight counts (each flight counts both its
 * departure and arrival airport).
 */
export function computeFlightBreakdown(connections, citiesById, airportsByCode) {
  const perFlight = [];
  const airlineAgg = new Map();
  const yearAgg = new Map();
  const airportCounts = new Map();
  const aircraftTypeAgg = new Map();
  const regTypeMap = buildRegistrationTypeMap(connections);

  for (const conn of connections) {
    const { km, hours } = computeConnectionDistanceHours(conn, citiesById, airportsByCode);
    const fromLabel = resolveLegLabel(conn.from, conn.departureAirport, citiesById, airportsByCode);
    const toLabel = resolveLegLabel(conn.to, conn.arrivalAirport, citiesById, airportsByCode);
    const year = conn.date ? conn.date.slice(0, 4) : null;
    const airlineKey = conn.airlineCode || conn.airline || null;
    const airlineName = conn.airline || conn.airlineCode || null;

    perFlight.push({
      label: `${fromLabel} → ${toLabel}`,
      km,
      hours,
      date: conn.date || null,
      year,
      airlineName,
      airlineCode: conn.airlineCode || null,
    });

    if (airlineKey) {
      if (!airlineAgg.has(airlineKey)) {
        airlineAgg.set(airlineKey, { name: airlineName, code: conn.airlineCode || null, count: 0, km: 0, hours: 0 });
      }
      const a = airlineAgg.get(airlineKey);
      a.count += 1;
      a.km += km;
      a.hours += hours;
    }

    if (year) {
      if (!yearAgg.has(year)) yearAgg.set(year, { count: 0, km: 0, hours: 0 });
      const y = yearAgg.get(year);
      y.count += 1;
      y.km += km;
      y.hours += hours;
    }

    for (const code of [conn.departureAirport, conn.arrivalAirport]) {
      if (!code) continue;
      const upper = code.toUpperCase();
      if (!airportCounts.has(upper)) {
        const airport = airportsByCode.get(upper);
        airportCounts.set(upper, { code: upper, name: airport ? airport.city || airport.name : upper, count: 0 });
      }
      airportCounts.get(upper).count += 1;
    }

    const aircraftType = resolveAircraftType(conn, regTypeMap);
    if (aircraftType) {
      if (!aircraftTypeAgg.has(aircraftType)) aircraftTypeAgg.set(aircraftType, { type: aircraftType, count: 0, km: 0, hours: 0 });
      const t = aircraftTypeAgg.get(aircraftType);
      t.count += 1;
      t.km += km;
      t.hours += hours;
    }
  }

  const withRoute = perFlight.filter((f) => f.km > 0);
  const byKmAsc = [...withRoute].sort((a, b) => a.km - b.km);
  const byHoursAsc = [...withRoute].sort((a, b) => a.hours - b.hours);
  const airlines = [...airlineAgg.values()].sort((a, b) => b.count - a.count);
  const airports = [...airportCounts.values()].sort((a, b) => b.count - a.count);
  const aircraftTypes = [...aircraftTypeAgg.values()].sort((a, b) => b.count - a.count);
  const yearCount = yearAgg.size || 1;
  const totals = perFlight.reduce((acc, f) => ({ km: acc.km + f.km, hours: acc.hours + f.hours }), { km: 0, hours: 0 });

  return {
    perFlight,
    longestByKm: byKmAsc[byKmAsc.length - 1] || null,
    shortestByKm: byKmAsc[0] || null,
    longestByHours: byHoursAsc[byHoursAsc.length - 1] || null,
    shortestByHours: byHoursAsc[0] || null,
    mostUsedAirline: airlines[0] || null,
    airlines,
    avgYearlyKm: totals.km / yearCount,
    avgYearlyHours: totals.hours / yearCount,
    avgYearlyFlights: perFlight.length / yearCount,
    airports,
    mostVisitedAirport: airports[0] || null,
    leastVisitedAirport: airports[airports.length - 1] || null,
    aircraftTypes,
    mostUsedAircraftType: aircraftTypes[0] || null,
  };
}

export function formatDistanceKm(km) {
  return `${Math.round(km).toLocaleString()} km`;
}

export function formatDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Airline logos aren't bundled (trademarked, and there's no free redistributable
 * set) — this hotlinks a public logo CDN by IATA code. Callers should handle
 * the image failing to load (unknown code, host unreachable) with a fallback icon.
 */
export function airlineLogoUrl(code) {
  return `https://images.kiwi.com/airlines/64/${encodeURIComponent(code)}.png`;
}
