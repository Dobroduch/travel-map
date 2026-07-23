import { foldDiacritics } from "./util.js";

export async function loadCountriesGeoJson() {
  const res = await fetch("data/countries.geojson");
  return res.json();
}

export async function loadCitiesData() {
  const res = await fetch("data/cities.json");
  return res.json();
}

export async function loadAirportsData() {
  const res = await fetch("data/airports.json");
  return res.json();
}

export async function loadAirlinesData() {
  const res = await fetch("data/airlines.json");
  return res.json();
}

export async function loadCountryCodes() {
  const res = await fetch("data/country-codes.json");
  return res.json();
}

/**
 * Flag image URL for an ISO2 code, from the free flagcdn.com CDN. Windows'
 * default emoji font doesn't render flag emoji as pictures (just shows the
 * two-letter code), so a hotlinked image is used instead of Unicode regional
 * indicator symbols for guaranteed cross-platform rendering.
 */
export function countryFlagUrl(iso2) {
  if (!iso2 || iso2.length !== 2) return null;
  return `https://flagcdn.com/w40/${iso2.toLowerCase()}.png`;
}

export function getCountryList(countriesGeojson) {
  const seen = new Map();
  for (const f of countriesGeojson.features) {
    if (!f.id || seen.has(f.id)) continue;
    seen.set(f.id, f.properties?.name || f.id);
  }
  return [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function slugify(name) {
  return foldDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function uniqueId(base, existingIds) {
  let id = base || "city";
  let i = 2;
  while (existingIds.has(id)) {
    id = `${base}-${i++}`;
  }
  return id;
}

export function buildIndex(data) {
  const citiesById = new Map(data.cities.map((c) => [c.id, c]));

  const connectionsByCity = new Map(data.cities.map((c) => [c.id, []]));
  for (const conn of data.connections) {
    connectionsByCity.get(conn.from)?.push(conn);
    connectionsByCity.get(conn.to)?.push(conn);
  }

  const citiesByCountry = new Map();
  for (const c of data.cities) {
    if (!citiesByCountry.has(c.countryCode)) citiesByCountry.set(c.countryCode, []);
    citiesByCountry.get(c.countryCode).push(c);
  }

  return { citiesById, connectionsByCity, citiesByCountry };
}
