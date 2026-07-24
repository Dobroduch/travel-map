const STORAGE_KEY = "travel-map-data-v1";

function emptyData() {
  return { visitedCountries: [], homeBaseCountries: [], homeCityId: null, cities: [], connections: [] };
}

export async function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to a fresh empty start if local data is corrupt
    }
  }
  const seed = emptyData();
  saveData(seed);
  return seed;
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportData(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "travel-data.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isValidTravelData(data) {
  return (
    data &&
    Array.isArray(data.visitedCountries) &&
    Array.isArray(data.cities) &&
    Array.isArray(data.connections)
  );
}

export async function importData(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!isValidTravelData(parsed)) {
    throw new Error("That file doesn't look like a valid travel-map data export.");
  }
  saveData(parsed);
  return parsed;
}

export function deleteAllData() {
  const empty = { visitedCountries: [], homeBaseCountries: [], homeCityId: null, cities: [], connections: [] };
  saveData(empty);
  return empty;
}
