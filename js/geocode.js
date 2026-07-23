const PHOTON_URL = "https://photon.komoot.io/api/";
const REQUEST_TIMEOUT_MS = 6000;

let iso2to3Promise = null;

function loadIso2to3() {
  if (!iso2to3Promise) {
    iso2to3Promise = fetch("data/country-codes.json").then((res) => res.json());
  }
  return iso2to3Promise;
}

const TYPE_LABELS = {
  tourism: "Attraction",
  natural: "Natural feature",
  historic: "Historic site",
  leisure: "Park",
  waterway: "Waterway",
  mountain_range: "Mountain range",
};

function typeLabelFor(properties) {
  return TYPE_LABELS[properties.osm_key] || null;
}

/**
 * Online-only fallback search over OpenStreetMap (via the free Photon API),
 * used when the bundled offline city dataset comes up empty — covers
 * landmarks, parks, and small places that aren't populated-place cities.
 * @returns {Promise<Array<{name, country, countryCode, lat, lng, typeLabel}>>}
 * @throws on network failure/timeout — callers should catch and show a
 * "couldn't reach online search" message rather than treating it as "no results".
 */
export async function searchPlaces(query, { limit = 8, signal } = {}) {
  const iso2to3 = await loadIso2to3();

  const ownController = signal ? null : new AbortController();
  const effectiveSignal = signal || ownController.signal;
  const timeoutId = ownController ? setTimeout(() => ownController.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
    const res = await fetch(url, { signal: effectiveSignal });
    if (!res.ok) throw new Error(`Photon request failed (${res.status})`);
    const geojson = await res.json();

    return (geojson.features || [])
      .map((f) => {
        const props = f.properties || {};
        const code2 = (props.countrycode || "").toUpperCase();
        const code3 = iso2to3[code2];
        if (!code3 || !props.name) return null;
        const [lng, lat] = f.geometry.coordinates;
        return {
          name: props.name,
          country: props.country || code3,
          countryCode: code3,
          lat,
          lng,
          typeLabel: typeLabelFor(props),
        };
      })
      .filter(Boolean);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
