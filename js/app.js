import {
  loadCountriesGeoJson,
  loadCitiesData,
  loadAirportsData,
  loadAirlinesData,
  loadCountryCodes,
  countryFlagUrl,
  buildIndex,
  getCountryList,
} from "./data.js";
import { loadData, saveData, exportData, importData, deleteAllData } from "./storage.js";
import { createMap } from "./map.js";
import { initDialog, openDialog, openListDialog, closeDialog } from "./dialog.js";
import { initEditor, openCityForm, openCountryForm, openFlightForm, openCountryEditor } from "./editor.js";
import { icons } from "./icons.js";
import { escapeHtml, foldDiacritics, formatDateDMY } from "./util.js";
import { searchPlaces } from "./geocode.js";
import { lookupAircraftType } from "./aircraftlookup.js";
import { getSyncConfig, saveSyncConfig, connect as connectSync, pullRemote, pushRemote, watchRemote, disconnect as disconnectSync } from "./sync.js";
import {
  computeFlightStats,
  computeFlightBreakdown,
  computeSeatHeatmap,
  distanceComparison,
  formatDistanceKm,
  formatDuration,
  airlineLogoUrl,
  resolveLegName,
  resolveLegLabel,
} from "./flightstats.js";

const HOME_BASE_LIMIT = 2;
const CITY_LIST_CAP = 30;
const THEME_KEY = "travel-map-theme";

let data;
let index;
let countryList;
let countriesGeojson;
let citiesData;
let allWorldCities = [];
let airportsData = [];
let airportsByCode = new Map();
let airlinesData = [];
let mapHandle;
let flightFilter = { year: "", airline: "" };
let flightsListSort = "newest";
let flightsListAirline = "";
let iso2ByIso3 = new Map();

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    if (icons[name]) el.innerHTML = icons[name](18);
  });
}

function refreshIndexes() {
  index = buildIndex(data);
}

let syncConnected = false;
let syncPushTimer = null;
let applyingRemoteSync = false;

/** Pushes to Firestore a little after the last edit rather than on every keystroke/save. */
function schedulePushToSync() {
  if (!syncConnected || applyingRemoteSync) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => {
    pushRemote(data).catch(() => {
      // offline, or the Firestore rules/config are wrong — the local save already
      // succeeded, so nothing is lost; the next successful push catches it up
    });
  }, 1200);
}

function persistAndRefreshMap() {
  data.updatedAt = Date.now();
  saveData(data);
  refreshIndexes();
  mapHandle.updateData(data, index.citiesById);
  applyFlightFilter();
  schedulePushToSync();
}

/** Re-renders whichever page is currently on screen, so a remote update from the
 * other device shows up immediately instead of only after switching views. */
function rerenderCurrentView() {
  if (!document.getElementById("view-countries").hidden) renderCountriesPage();
  else if (!document.getElementById("view-timeline").hidden) renderTimelinePage();
  else if (!document.getElementById("view-flights").hidden) renderFlightsPage();
}

/** Adopts data pushed from another device — only if it's actually newer than what
 * we already have, so this device's own echoed write doesn't loop back and reapply. */
function applyRemoteData(remoteData) {
  if (!remoteData || typeof remoteData.updatedAt !== "number") return;
  if (remoteData.updatedAt <= (data.updatedAt || 0)) return;
  applyingRemoteSync = true;
  data = remoteData;
  backfillCityPopulations();
  persistAndRefreshMap();
  rerenderCurrentView();
  applyingRemoteSync = false;
  showOfflineToast("Synced from your other device");
}

function countryNameForCode(code) {
  return countryList.find((c) => c.code === code)?.name || code;
}

function renderConnection(conn) {
  const fromName = resolveLegName(conn.from, conn.departureAirport, index.citiesById, airportsByCode);
  const toName = resolveLegName(conn.to, conn.arrivalAirport, index.citiesById, airportsByCode);
  return {
    route: `${fromName} → ${toName}`,
    meta: `${formatDateDMY(conn.date)} · ${conn.flightNumber}`,
  };
}

function isHomeBaseCountry(code) {
  return (data.homeBaseCountries || []).includes(code);
}

function visibleCities(cities) {
  return cities.filter((c) => c.visited !== false);
}

function openCityDialog(cityId) {
  const city = index.citiesById.get(cityId);
  if (!city) return;
  const connections = (index.connectionsByCity.get(city.id) || []).map(renderConnection);
  openDialog({
    title: city.name,
    subtitle: isHomeBaseCountry(city.countryCode) ? `${city.country} · Home base` : city.country,
    dates: city.dates.map(formatDateDMY),
    notes: city.notes,
    connections,
    onEdit: () => editCity(city.id),
    onDelete: () => deleteCity(city.id),
  });
}

function openCountryDialog(code) {
  const allCities = index.citiesByCountry.get(code) || [];
  const cities = visibleCities(allCities);
  const name = allCities[0]?.country || countryNameForCode(code);
  const dates = cities.flatMap((c) => c.dates).map(formatDateDMY);
  const cityIds = new Set(allCities.map((c) => c.id));
  const connections = data.connections
    .filter((c) => cityIds.has(c.from) || cityIds.has(c.to))
    .map(renderConnection);

  openDialog({
    title: name,
    subtitle: cities.length
      ? `${cities.length} ${cities.length === 1 ? "city" : "cities"} visited — ${cities.map((c) => c.name).join(", ")}`
      : "Marked as visited",
    dates,
    connections,
    onEdit: () => editCountry(code),
    onDelete: () => removeCountry(code),
  });
}

function editCountry(code) {
  const countryName = countryNameForCode(code);
  closeDialog();

  openCountryEditor({
    countryName,
    homeBaseLimit: HOME_BASE_LIMIT,
    isHomeBase: isHomeBaseCountry(code),
    getCities: () => index.citiesByCountry.get(code) || [],
    onToggleHomeBase: (checked) => toggleCountryHomeBase(code, checked),
    onToggleVisited: (cityId, checked) => toggleCityVisited(cityId, checked),
    onDeleteCity: (cityId) => deleteCity(cityId),
  });
}

function toggleCountryHomeBase(code, makeHomeBase) {
  if (!data.homeBaseCountries) data.homeBaseCountries = [];

  if (makeHomeBase) {
    if (data.homeBaseCountries.length >= HOME_BASE_LIMIT) return false;
    data.homeBaseCountries.push(code);
    if (!data.visitedCountries.includes(code)) data.visitedCountries.push(code);
  } else {
    data.homeBaseCountries = data.homeBaseCountries.filter((c) => c !== code);
  }

  persistAndRefreshMap();
  return true;
}

function toggleCityVisited(cityId, visited) {
  const city = index.citiesById.get(cityId);
  if (!city) return;
  city.visited = visited;
  persistAndRefreshMap();
}

function openFlightDialog(connIndex) {
  const conn = data.connections[connIndex];
  if (!conn) return;
  const fromName = resolveLegLabel(conn.from, conn.departureAirport, index.citiesById, airportsByCode);
  const toName = resolveLegLabel(conn.to, conn.arrivalAirport, index.citiesById, airportsByCode);
  const hasLayover = conn.type === "layover" && conn.layoverAirport;
  const viaName = hasLayover ? resolveLegLabel(null, conn.layoverAirport, index.citiesById, airportsByCode) : null;

  const details = [];
  if (conn.airline) details.push({ label: "Airline", value: conn.airline });
  if (conn.departureAirport || conn.departureTime) {
    details.push({
      label: "Departure",
      value: [conn.departureAirport, conn.departureTime].filter(Boolean).join(" · "),
    });
  }
  if (hasLayover) details.push({ label: "Layover", value: conn.layoverAirport });
  if (conn.arrivalAirport || conn.arrivalTime) {
    details.push({
      label: "Arrival",
      value: [conn.arrivalAirport, conn.arrivalTime].filter(Boolean).join(" · "),
    });
  }
  const aircraftParts = [conn.aircraftType, conn.aircraft].filter(Boolean);
  if (aircraftParts.length) details.push({ label: "Aircraft", value: aircraftParts.join(" · ") });
  if (conn.seat) details.push({ label: "Seat", value: conn.seat });

  let subtitle = "Direct flight";
  if (conn.type === "layover") subtitle = hasLayover ? `1 stop via ${viaName}` : "1 stop (airport unknown)";

  openDialog({
    title: hasLayover ? `${fromName} → ${viaName} → ${toName}` : `${fromName} → ${toName}`,
    subtitle,
    iconUrl: conn.airlineCode ? airlineLogoUrl(conn.airlineCode) : null,
    iconAlt: conn.airline || conn.airlineCode || "",
    dates: conn.date ? [formatDateDMY(conn.date)] : [],
    notes: conn.flightNumber ? `Flight ${conn.flightNumber}` : "",
    details,
    onEdit: () => editFlight(connIndex),
    onDelete: () => deleteFlight(connIndex),
  });
}

async function editFlight(connIndex) {
  const connection = data.connections[connIndex];
  if (!connection) return;
  closeDialog();

  const result = await openFlightForm({
    mode: "edit",
    connection,
    cities: data.cities,
    airports: airportsData,
    airlines: airlinesData,
    connections: data.connections,
  });
  if (!result) return;

  data.connections[connIndex] = result;
  persistAndRefreshMap();
}

function deleteFlight(connIndex) {
  const conn = data.connections[connIndex];
  if (!conn) return;
  if (!confirm("Delete this flight?")) return;

  data.connections.splice(connIndex, 1);

  closeDialog();
  persistAndRefreshMap();
}

async function editCity(cityId) {
  const city = index.citiesById.get(cityId);
  if (!city) return;
  closeDialog();

  const existingIds = new Set(index.citiesById.keys());
  existingIds.delete(cityId);

  const result = await openCityForm({ mode: "edit", city, countries: countryList, existingIds });
  if (!result) return;

  const i = data.cities.findIndex((c) => c.id === cityId);
  data.cities[i] = result;
  persistAndRefreshMap();
}

function deleteCity(cityId) {
  const city = index.citiesById.get(cityId);
  if (!city) return;
  if (!confirm(`Delete ${city.name}? This also removes any flights to or from it.`)) return;

  data.cities = data.cities.filter((c) => c.id !== cityId);
  data.connections = data.connections.filter((c) => c.from !== cityId && c.to !== cityId);

  closeDialog();
  persistAndRefreshMap();
}

function removeCountry(code) {
  const cities = index.citiesByCountry.get(code) || [];
  const message = cities.length
    ? `Remove this country from your visited list? Its ${cities.length} ${cities.length === 1 ? "city" : "cities"} will stay on the map.`
    : "Remove this country from your visited list?";
  if (!confirm(message)) return;

  data.visitedCountries = data.visitedCountries.filter((c) => c !== code);

  closeDialog();
  persistAndRefreshMap();
}

async function addCity() {
  const existingIds = new Set(index.citiesById.keys());
  await openCityForm({
    mode: "add",
    countries: countryList,
    citiesData,
    existingIds,
    onAdd: (result) => {
      data.cities.push(result);
      existingIds.add(result.id);
      if (!data.visitedCountries.includes(result.countryCode)) {
        data.visitedCountries.push(result.countryCode);
      }
      persistAndRefreshMap();
      mapHandle.map.flyTo({ center: [result.lng, result.lat], zoom: Math.max(mapHandle.map.getZoom(), 4) });
    },
  });
}

async function quickAddCity(match) {
  document.getElementById("search-results").hidden = true;
  document.getElementById("search-input").value = "";

  const country = { code: match.countryCode, name: countryNameForCode(match.countryCode) };
  const existingIds = new Set(index.citiesById.keys());

  await openCityForm({
    mode: "quick",
    country,
    coords: { lat: match.lat, lng: match.lng },
    name: match.name,
    population: match.p ?? null,
    countries: countryList,
    citiesData,
    existingIds,
    onAdd: (result) => {
      data.cities.push(result);
      existingIds.add(result.id);
      if (!data.visitedCountries.includes(result.countryCode)) {
        data.visitedCountries.push(result.countryCode);
      }
      persistAndRefreshMap();
      mapHandle.map.flyTo({ center: [result.lng, result.lat], zoom: Math.max(mapHandle.map.getZoom(), 4) });
    },
  });
}

async function addCountry() {
  const visitedCodes = new Set(data.visitedCountries);
  const result = await openCountryForm({ countries: countryList, visitedCodes });
  if (!result) return;

  data.visitedCountries.push(result.code);
  persistAndRefreshMap();
}

async function addFlight() {
  let prefill = null;

  for (;;) {
    const result = await openFlightForm({
      mode: "add",
      prefill,
      cities: data.cities,
      airports: airportsData,
      airlines: airlinesData,
      connections: data.connections,
    });
    if (!result) return;

    data.connections.push(result.connection);
    persistAndRefreshMap();

    const flightsView = document.getElementById("view-flights");
    if (flightsView && !flightsView.hidden) renderFlightsPage();

    if (!result.addReturn) return;
    prefill = {
      departureAirport: result.connection.arrivalAirport,
      arrivalAirport: result.connection.departureAirport,
      airline: result.connection.airline,
    };
  }
}

function showOfflineToast(message) {
  let toast = document.querySelector(".offline-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "offline-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showOfflineToast._t);
  showOfflineToast._t = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function setupSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  let currentWorldMatches = [];
  let onlineDebounceTimer = null;
  let onlineController = null;

  function render(visitedMatches, worldMatches, state = null) {
    if (state === "loading") {
      results.innerHTML = `<div class="search-empty">Searching online…</div>`;
      results.hidden = false;
      return;
    }
    if (state === "error") {
      results.innerHTML = `<div class="search-empty">Couldn't reach online search. Check your connection or add this place manually.</div>`;
      results.hidden = false;
      return;
    }
    if (!visitedMatches.length && !worldMatches.length) {
      results.innerHTML = `<div class="search-empty">No matches</div>`;
      results.hidden = false;
      return;
    }

    const visitedHtml = visitedMatches
      .map(
        (c) => `
        <div class="search-result" data-kind="visited" data-id="${c.id}">
          <span class="search-result-main">${escapeHtml(c.name)}<span class="search-result-sub">${escapeHtml(c.country)}</span></span>
        </div>`
      )
      .join("");

    const worldHtml = worldMatches
      .map(
        (c, i) => `
        <div class="search-result" data-kind="world" data-i="${i}">
          <span class="search-result-main">${escapeHtml(c.name)}<span class="search-result-sub">${c.typeLabel ? `${escapeHtml(c.typeLabel)} · ` : ""}${escapeHtml(countryNameForCode(c.countryCode))}</span></span>
          <button type="button" class="search-result-add" aria-label="Add ${escapeHtml(c.name)} to visited cities">${icons.plus(14)}</button>
        </div>`
      )
      .join("");

    const onlineNote = state === "online" ? `<div class="search-osm-note">Results via OpenStreetMap</div>` : "";

    results.innerHTML = visitedHtml + worldHtml + onlineNote;
    results.hidden = false;
  }

  input.addEventListener("input", () => {
    clearTimeout(onlineDebounceTimer);
    if (onlineController) onlineController.abort();

    const raw = input.value.trim();
    const q = foldDiacritics(raw.toLowerCase());
    if (!q) {
      results.hidden = true;
      return;
    }

    const visitedMatches = data.cities
      .filter((c) => foldDiacritics(c.name.toLowerCase()).includes(q) || foldDiacritics(c.country.toLowerCase()).includes(q))
      .slice(0, 5);

    const visitedKeys = new Set(data.cities.map((c) => `${c.name.toLowerCase()}|${c.countryCode}`));

    currentWorldMatches = allWorldCities
      .filter((c) => foldDiacritics(c.name.toLowerCase()).startsWith(q))
      .filter((c) => !visitedKeys.has(`${c.name.toLowerCase()}|${c.countryCode}`))
      .slice(0, 8);

    if (visitedMatches.length || currentWorldMatches.length) {
      render(visitedMatches, currentWorldMatches);
      return;
    }

    // offline dataset came up empty — fall back to an online search, after a
    // short debounce so we don't hit the (free, shared) API on every keystroke
    render(visitedMatches, currentWorldMatches, "loading");

    onlineDebounceTimer = setTimeout(async () => {
      onlineController = new AbortController();
      try {
        const online = await searchPlaces(raw, { signal: onlineController.signal });
        if (foldDiacritics(input.value.trim().toLowerCase()) !== q) return; // superseded by newer input
        currentWorldMatches = online
          .filter((c) => !visitedKeys.has(`${c.name.toLowerCase()}|${c.countryCode}`))
          .slice(0, 8);
        render(visitedMatches, currentWorldMatches, currentWorldMatches.length ? "online" : null);
      } catch (err) {
        if (err.name === "AbortError") return;
        render(visitedMatches, [], "error");
      }
    }, 350);
  });

  results.addEventListener("click", (e) => {
    const row = e.target.closest(".search-result");
    if (!row) return;

    if (row.dataset.kind === "world") {
      const match = currentWorldMatches[Number(row.dataset.i)];
      if (match) quickAddCity(match);
      return;
    }

    const city = index.citiesById.get(row.dataset.id);
    if (!city) return;
    mapHandle.map.flyTo({ center: [city.lng, city.lat], zoom: Math.max(mapHandle.map.getZoom(), 5) });
    openCityDialog(city.id);
    input.value = "";
    results.hidden = true;
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) results.hidden = true;
  });
}

function setupSidebar() {
  const items = [...document.querySelectorAll(".nav-item")];
  const views = {
    map: document.getElementById("view-map"),
    countries: document.getElementById("view-countries"),
    timeline: document.getElementById("view-timeline"),
    flights: document.getElementById("view-flights"),
    settings: document.getElementById("view-settings"),
  };

  items.forEach((btn) => {
    btn.addEventListener("click", () => {
      items.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      Object.entries(views).forEach(([key, el]) => {
        el.hidden = key !== view;
      });
      if (view === "map") mapHandle.map.resize();
      else if (view === "countries") renderCountriesPage();
      else if (view === "timeline") renderTimelinePage();
      else if (view === "flights") renderFlightsPage();
    });
  });
}

function renderCountryFlag(code) {
  const url = countryFlagUrl(iso2ByIso3.get(code));
  if (!url) return "";
  return `<img src="${url}" alt="" class="country-flag" onerror="this.style.visibility='hidden'" />`;
}

function renderCountriesPage() {
  const container = document.getElementById("view-countries");

  const rows = data.visitedCountries
    .map((code) => {
      const allCities = index.citiesByCountry.get(code) || [];
      const cities = visibleCities(allCities);
      const name = allCities[0]?.country || countryNameForCode(code);
      return { code, name, count: cities.length, homeBase: isHomeBaseCountry(code) };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (!rows.length) {
    container.innerHTML = `<div class="page-panel"><h2>Countries</h2><p class="page-hint">No countries marked as visited yet. Use the + button on the map to add one.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-panel">
      <h2>Countries</h2>
      <p class="page-hint">${rows.length} ${rows.length === 1 ? "country" : "countries"} visited</p>
      <div class="entity-list">
        ${rows
          .map(
            (r) => `
          <div class="country-block" data-code="${r.code}">
            <button type="button" class="country-row">
              <span class="entity-name entity-name-with-icon">${renderCountryFlag(r.code)}${escapeHtml(r.name)}${r.homeBase ? " · Home base" : ""}</span>
              <span class="entity-count">
                <span class="country-row-count-text">${r.count ? `${r.count} ${r.count === 1 ? "city" : "cities"}` : "Marked visited"}</span>
                <span class="country-row-chevron">${icons.chevron(16)}</span>
              </span>
            </button>
            <div class="country-expand" hidden></div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".country-block").forEach((block) => {
    const code = block.dataset.code;
    const row = block.querySelector(".country-row");
    const expand = block.querySelector(".country-expand");

    row.addEventListener("click", () => {
      const isOpen = block.classList.contains("expanded");
      if (isOpen) {
        block.classList.remove("expanded");
        expand.hidden = true;
        return;
      }
      block.classList.add("expanded");
      expand.hidden = false;
      renderCountryExpansion(code, expand);
    });
  });
}

function updateCountryRowCount(code) {
  const block = document.querySelector(`.country-block[data-code="${code}"]`);
  if (!block) return;
  const cities = visibleCities(index.citiesByCountry.get(code) || []);
  const label = cities.length ? `${cities.length} ${cities.length === 1 ? "city" : "cities"}` : "Marked visited";
  const textEl = block.querySelector(".country-row-count-text");
  if (textEl) textEl.textContent = label;
}

function renderCityMiniRow(c) {
  const flightCount = (index.connectionsByCity.get(c.id) || []).length;
  return `
    <div class="city-mini-row" data-id="${c.id}">
      <div class="city-mini-main">
        <span class="city-mini-name">${escapeHtml(c.name)}</span>
        ${flightCount ? `<span class="city-mini-flights">${icons.plane(12)}${flightCount}</span>` : ""}
      </div>
      <div class="city-mini-actions">
        <button type="button" class="icon-btn-sm city-mini-edit" data-id="${c.id}" aria-label="Edit ${escapeHtml(c.name)}">${icons.pencil(14)}</button>
        <button type="button" class="icon-btn-sm icon-btn-danger city-mini-delete" data-id="${c.id}" aria-label="Delete ${escapeHtml(c.name)}">${icons.trash(14)}</button>
      </div>
    </div>`;
}

function renderCountryExpansion(code, container) {
  const cities = visibleCities(index.citiesByCountry.get(code) || []);

  const sorted = [...cities].sort((a, b) => {
    const aFlights = (index.connectionsByCity.get(a.id) || []).length;
    const bFlights = (index.connectionsByCity.get(b.id) || []).length;
    if (aFlights !== bFlights) return bFlights - aFlights;
    return a.name.localeCompare(b.name);
  });

  const visible = sorted.slice(0, CITY_LIST_CAP);
  const overflowCount = sorted.length - visible.length;

  container.innerHTML = `
    ${visible.map(renderCityMiniRow).join("")}
    ${
      overflowCount > 0
        ? `<div class="see-all-row"><button type="button" class="see-all-btn">See all ${sorted.length} cities</button></div>`
        : ""
    }
    <div class="country-remove-row"><button type="button" class="country-remove-btn">Remove country from visited</button></div>
  `;

  container.querySelectorAll(".city-mini-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".icon-btn-sm")) return;
      openCityDialog(row.dataset.id);
    });
  });

  container.querySelectorAll(".city-mini-edit").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await editCity(btn.dataset.id);
      renderCountriesPage();
    });
  });

  container.querySelectorAll(".city-mini-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCity(btn.dataset.id);
      renderCountryExpansion(code, container);
      updateCountryRowCount(code);
    });
  });

  const seeAllBtn = container.querySelector(".see-all-btn");
  if (seeAllBtn) {
    seeAllBtn.addEventListener("click", () => {
      openListDialog({
        title: countryNameForCode(code),
        subtitle: `${sorted.length} cities`,
        rows: sorted.map((c) => {
          const flightCount = (index.connectionsByCity.get(c.id) || []).length;
          return {
            id: c.id,
            name: c.name,
            meta: flightCount ? `${flightCount} flight${flightCount === 1 ? "" : "s"}` : "",
          };
        }),
        onRowClick: (cityId) => openCityDialog(cityId),
      });
    });
  }

  container.querySelector(".country-remove-btn").addEventListener("click", () => {
    removeCountry(code);
    renderCountriesPage();
  });
}

function parseDateSafe(str) {
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function renderTimelinePage() {
  const container = document.getElementById("view-timeline");

  const visible = visibleCities(data.cities);
  const seen = new Set();
  const entries = [];

  function addEntry(city, dateStr) {
    const key = `${city.id}|${dateStr}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ city, dateStr, date: parseDateSafe(dateStr) });
  }

  for (const city of visible) {
    for (const dateStr of city.dates) addEntry(city, dateStr);
  }

  if (!entries.length) {
    container.innerHTML = `<div class="page-panel"><h2>Timeline</h2><p class="page-hint">No visits recorded yet.</p></div>`;
    return;
  }

  const dated = entries.filter((e) => e.date).sort((a, b) => a.date - b.date);
  const undated = entries.filter((e) => !e.date);

  const groups = new Map();
  for (const e of dated) {
    const year = e.date.getFullYear();
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(e);
  }

  const renderRow = (e) => `
    <button type="button" class="entity-row" data-id="${e.city.id}">
      <span class="entity-name">${escapeHtml(e.city.name)}</span>
      <span class="entity-count">${escapeHtml(formatDateDMY(e.dateStr))}</span>
    </button>`;

  let html = `<div class="page-panel"><h2>Timeline</h2>`;

  for (const year of [...groups.keys()].sort((a, b) => a - b)) {
    html += `<div class="timeline-year"><h3>${year}</h3><div class="entity-list">${groups
      .get(year)
      .map(renderRow)
      .join("")}</div></div>`;
  }

  if (undated.length) {
    html += `<div class="timeline-year"><h3>Undated</h3><div class="entity-list">${undated
      .map(renderRow)
      .join("")}</div></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll(".entity-row").forEach((btn) => {
    btn.addEventListener("click", () => openCityDialog(btn.dataset.id));
  });
}

function renderFlightRowIcon(conn) {
  if (!conn.airlineCode) {
    return `<span class="airline-fallback-icon">${icons.plane(14)}</span>`;
  }
  return `<img src="${airlineLogoUrl(conn.airlineCode)}" alt="${escapeHtml(conn.airline || conn.airlineCode)}" class="airline-logo-row" onerror="this.style.display='none';this.nextElementSibling.hidden=false;" /><span class="airline-fallback-icon" hidden>${icons.plane(14)}</span>`;
}

function renderFlightRow({ conn, i }) {
  const fromName = resolveLegLabel(conn.from, conn.departureAirport, index.citiesById, airportsByCode);
  const toName = resolveLegLabel(conn.to, conn.arrivalAirport, index.citiesById, airportsByCode);
  const viaName =
    conn.type === "layover" && conn.layoverAirport
      ? resolveLegLabel(null, conn.layoverAirport, index.citiesById, airportsByCode)
      : null;
  const routeText = viaName ? `${fromName} → ${viaName} → ${toName}` : `${fromName} → ${toName}`;
  return `
    <button type="button" class="entity-row" data-index="${i}">
      <span class="entity-name-with-icon">${renderFlightRowIcon(conn)}<span class="entity-name">${escapeHtml(routeText)}</span></span>
      <span class="entity-count">${escapeHtml(conn.date ? formatDateDMY(conn.date) : "No date")}${conn.flightNumber ? ` · ${escapeHtml(conn.flightNumber)}` : ""}</span>
    </button>`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function buildFlightsListHtml(rows, sortMode) {
  if (sortMode === "longest" || sortMode === "shortest") {
    const sorted = [...rows].sort((a, b) => (sortMode === "longest" ? b.km - a.km : a.km - b.km));
    return `<div class="entity-list">${sorted.map(renderFlightRow).join("")}</div>`;
  }

  const dated = rows.filter((r) => r.date).sort((a, b) => (sortMode === "oldest" ? a.date - b.date : b.date - a.date));
  const undated = rows.filter((r) => !r.date);

  const yearGroups = new Map();
  for (const r of dated) {
    const year = r.date.getFullYear();
    if (!yearGroups.has(year)) yearGroups.set(year, []);
    yearGroups.get(year).push(r);
  }

  const yearOrder = [...yearGroups.keys()].sort((a, b) => (sortMode === "oldest" ? a - b : b - a));
  let html = "";
  for (const year of yearOrder) {
    const monthGroups = new Map();
    for (const r of yearGroups.get(year)) {
      const month = r.date.getMonth();
      if (!monthGroups.has(month)) monthGroups.set(month, []);
      monthGroups.get(month).push(r);
    }
    const monthOrder = [...monthGroups.keys()].sort((a, b) => (sortMode === "oldest" ? a - b : b - a));
    const monthsHtml = monthOrder
      .map(
        (month) =>
          `<div class="timeline-month"><h4>${MONTH_NAMES[month]}</h4><div class="entity-list">${monthGroups
            .get(month)
            .map(renderFlightRow)
            .join("")}</div></div>`
      )
      .join("");
    html += `<div class="timeline-year"><h3>${year}</h3>${monthsHtml}</div>`;
  }
  if (undated.length) {
    html += `<div class="timeline-year"><h3>Undated</h3><div class="entity-list">${undated
      .map(renderFlightRow)
      .join("")}</div></div>`;
  }
  return html;
}

function renderFlightsPage() {
  const container = document.getElementById("view-flights");

  if (!data.connections.length) {
    container.innerHTML = `
      <div class="page-panel">
        <div class="page-header-row">
          <h2>Flights</h2>
          <button type="button" class="btn-primary" id="flights-add-btn">Add flight</button>
        </div>
        <p class="page-hint">No flights recorded yet.</p>
      </div>`;
    document.getElementById("flights-add-btn").addEventListener("click", () => addFlight());
    return;
  }

  const stats = computeFlightStats(data.connections, index.citiesById, airportsByCode);
  const breakdown = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);

  const missingTypeCount = data.connections.filter((c) => c.aircraft && !c.aircraftType).length;

  const allRows = data.connections.map((conn, i) => ({
    conn,
    i,
    date: parseDateSafe(conn.date),
    km: breakdown.perFlight[i].km,
  }));

  const rows = flightsListAirline
    ? allRows.filter((r) => (r.conn.airlineCode || r.conn.airline) === flightsListAirline)
    : allRows;

  const rowsHtml = rows.length
    ? buildFlightsListHtml(rows, flightsListSort)
    : `<p class="page-hint">No flights match this filter.</p>`;

  const airlineOptionsHtml = breakdown.airlines
    .map((a) => {
      const key = a.code || a.name;
      return `<option value="${escapeHtml(key)}" ${key === flightsListAirline ? "selected" : ""}>${escapeHtml(a.name || a.code)}</option>`;
    })
    .join("");

  container.innerHTML = `
    <div class="page-panel">
      <div class="page-header-row">
        <h2>Flights</h2>
        <button type="button" class="btn-primary" id="flights-add-btn">Add flight</button>
      </div>
      <div class="stats-grid">
        <button type="button" class="stat-tile" data-tile="distance">
          <div class="stat-value">${formatDistanceKm(stats.totalDistanceKm)}</div>
          <div class="stat-label">Distance flown</div>
        </button>
        <button type="button" class="stat-tile" data-tile="time">
          <div class="stat-value">${formatDuration(stats.totalHours)}</div>
          <div class="stat-label">Time in the air</div>
        </button>
        <button type="button" class="stat-tile" data-tile="flights">
          <div class="stat-value">${stats.flightCount}</div>
          <div class="stat-label">${stats.flightCount === 1 ? "Flight" : "Flights"}</div>
        </button>
        <button type="button" class="stat-tile" data-tile="airports">
          <div class="stat-value">${stats.airportCount}</div>
          <div class="stat-label">${stats.airportCount === 1 ? "Airport" : "Airports"}</div>
        </button>
        <button type="button" class="stat-tile" data-tile="airlines">
          <div class="stat-value">${stats.airlineCount}</div>
          <div class="stat-label">${stats.airlineCount === 1 ? "Airline" : "Airlines"}</div>
        </button>
        <button type="button" class="stat-tile" data-tile="seats">
          <div class="stat-value">${stats.seatCount ?? 0}</div>
          <div class="stat-label">${stats.seatCount === 1 ? "Seat logged" : "Seats logged"}</div>
        </button>
        <button type="button" class="stat-tile" data-tile="aircraftTypes">
          <div class="stat-value">${stats.aircraftTypeCount ?? 0}</div>
          <div class="stat-label">${stats.aircraftTypeCount === 1 ? "Aircraft type" : "Aircraft types"}</div>
        </button>
      </div>
      <p class="stats-note">Distance and time in the air are approximate — great-circle distance at a ~800&nbsp;km/h cruise estimate.</p>
      ${
        missingTypeCount
          ? `<p class="stats-note stats-action">
              ${missingTypeCount} ${missingTypeCount === 1 ? "flight has" : "flights have"} a registration but no known aircraft type.
              <button type="button" class="btn-link" id="flights-fill-types-btn">Look them up</button>
            </p>`
          : ""
      }
      <div class="flights-controls">
        <div class="form-row">
          <label for="flights-sort">Sort</label>
          <select id="flights-sort">
            <option value="newest" ${flightsListSort === "newest" ? "selected" : ""}>Newest first</option>
            <option value="oldest" ${flightsListSort === "oldest" ? "selected" : ""}>Oldest first</option>
            <option value="longest" ${flightsListSort === "longest" ? "selected" : ""}>Longest first</option>
            <option value="shortest" ${flightsListSort === "shortest" ? "selected" : ""}>Shortest first</option>
          </select>
        </div>
        <div class="form-row">
          <label for="flights-airline-filter">Airline</label>
          <select id="flights-airline-filter">
            <option value="">All airlines</option>
            ${airlineOptionsHtml}
          </select>
        </div>
      </div>
      ${rowsHtml}
    </div>
  `;

  document.getElementById("flights-add-btn").addEventListener("click", () => addFlight());

  const fillTypesBtn = document.getElementById("flights-fill-types-btn");
  if (fillTypesBtn) fillTypesBtn.addEventListener("click", () => fillMissingAircraftTypes(fillTypesBtn));

  document.getElementById("flights-sort").addEventListener("change", (e) => {
    flightsListSort = e.target.value;
    renderFlightsPage();
  });
  document.getElementById("flights-airline-filter").addEventListener("change", (e) => {
    flightsListAirline = e.target.value;
    renderFlightsPage();
  });

  container.querySelectorAll(".entity-row").forEach((btn) => {
    btn.addEventListener("click", () => openFlightDialog(Number(btn.dataset.index)));
  });

  const tileHandlers = {
    distance: openDistanceBreakdown,
    time: openTimeBreakdown,
    flights: openFlightsBreakdown,
    airports: openAirportsBreakdown,
    airlines: openAirlinesBreakdown,
    seats: openSeatsBreakdown,
    aircraftTypes: openAircraftTypesBreakdown,
  };
  container.querySelectorAll(".stat-tile").forEach((btn) => {
    btn.addEventListener("click", () => tileHandlers[btn.dataset.tile]?.());
  });
}

/**
 * Backfills aircraftType for logged flights that only have a registration, via
 * a one-time online registry lookup per unique tail number (deduped so a
 * frequently-flown aircraft only costs one request, not one per flight).
 */
async function fillMissingAircraftTypes(button) {
  const registrationsNeeded = new Set();
  for (const c of data.connections) {
    if (c.aircraft && !c.aircraftType) registrationsNeeded.add(c.aircraft.trim());
  }
  if (!registrationsNeeded.size) return;

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Looking up…";

  const resolved = new Map();
  for (const reg of registrationsNeeded) {
    try {
      const result = await lookupAircraftType(reg);
      if (result?.type) resolved.set(reg.toLowerCase(), result.type);
    } catch {
      // offline or unreachable — leave unresolved, the button stays available to retry
    }
  }

  let changedCount = 0;
  for (const c of data.connections) {
    if (c.aircraft && !c.aircraftType) {
      const type = resolved.get(c.aircraft.trim().toLowerCase());
      if (type) {
        c.aircraftType = type;
        changedCount += 1;
      }
    }
  }

  if (changedCount) {
    persistAndRefreshMap();
    showOfflineToast(`Found the aircraft type for ${changedCount} ${changedCount === 1 ? "flight" : "flights"}.`);
    renderFlightsPage();
  } else {
    button.disabled = false;
    button.textContent = originalLabel;
    showOfflineToast("Couldn't find any of those registrations — try again later.");
  }
}

function renderBreakdownSection(heading, innerHtml) {
  return `<div class="dialog-section"><h3>${escapeHtml(heading)}</h3>${innerHtml}</div>`;
}

function renderFlightRefRow(flight) {
  if (!flight) return `<p class="dialog-notes">Not enough data yet.</p>`;
  const meta = [formatDistanceKm(flight.km), formatDuration(flight.hours), formatDateDMY(flight.date)].filter(Boolean);
  return `<div class="connection-row"><span class="connection-route">${escapeHtml(flight.label)}</span><span class="connection-meta">${escapeHtml(
    meta.join(" · ")
  )}</span></div>`;
}

function renderMostUsedAirlineLine(airline) {
  if (!airline) return `<p class="dialog-notes">No airline data yet.</p>`;
  return `<p class="dialog-notes">${escapeHtml(airline.name || airline.code)} (${airline.count} ${airline.count === 1 ? "flight" : "flights"})</p>`;
}

function renderAirlineRows(airlines, valueFn) {
  if (!airlines.length) return `<p class="dialog-notes">No airline data yet.</p>`;
  return airlines
    .map(
      (a) => `
      <div class="connection-row">
        <span class="connection-route entity-name-with-icon">${
          a.code ? `<img src="${airlineLogoUrl(a.code)}" alt="" class="airline-logo-sm" onerror="this.style.visibility='hidden'" />` : ""
        }${escapeHtml(a.name || a.code || "Unknown")}</span>
        <span class="connection-meta">${escapeHtml(valueFn(a))}</span>
      </div>`
    )
    .join("");
}

function renderAirportRows(airports) {
  if (!airports.length) return `<p class="dialog-notes">No airport data yet.</p>`;
  return airports
    .map(
      (a) =>
        `<div class="connection-row"><span class="connection-route">${escapeHtml(a.code)} — ${escapeHtml(
          a.name
        )}</span><span class="connection-meta">${a.count} ${a.count === 1 ? "visit" : "visits"}</span></div>`
    )
    .join("");
}

function renderAircraftTypeRows(types) {
  if (!types.length) return `<p class="dialog-notes">No aircraft type data yet.</p>`;
  return types
    .map(
      (t) => `
      <div class="connection-row">
        <span class="connection-route">${escapeHtml(t.type)}</span>
        <span class="connection-meta">${t.count} ${t.count === 1 ? "flight" : "flights"}</span>
      </div>`
    )
    .join("");
}

function openAircraftTypesBreakdown() {
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const body =
    renderBreakdownSection(
      "Most flown",
      renderAircraftTypeRows(b.mostUsedAircraftType ? [b.mostUsedAircraftType] : [])
    ) + renderBreakdownSection("All types", renderAircraftTypeRows(b.aircraftTypes));
  openDialog({ title: "Aircraft types breakdown", bodyHtml: body });
}

function openDistanceBreakdown() {
  const stats = computeFlightStats(data.connections, index.citiesById, airportsByCode);
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const comparison = distanceComparison(stats.totalDistanceKm);
  const comparisonHtml = comparison
    ? `<p class="dialog-notes">${[comparison.circumferenceText, comparison.referenceText].filter(Boolean).map(escapeHtml).join(" — ")}</p>`
    : `<p class="dialog-notes">Not enough data yet.</p>`;

  const body =
    renderBreakdownSection("Fun comparison", comparisonHtml) +
    renderBreakdownSection("Longest flight", renderFlightRefRow(b.longestByKm)) +
    renderBreakdownSection("Shortest flight", renderFlightRefRow(b.shortestByKm)) +
    renderBreakdownSection("Most-used airline", renderMostUsedAirlineLine(b.mostUsedAirline)) +
    renderBreakdownSection("Average per year", `<p class="dialog-notes">${escapeHtml(formatDistanceKm(b.avgYearlyKm))}/year</p>`) +
    renderBreakdownSection("Distance by airline", renderAirlineRows(b.airlines, (a) => formatDistanceKm(a.km)));
  openDialog({ title: "Distance breakdown", bodyHtml: body });
}

function openTimeBreakdown() {
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const body =
    renderBreakdownSection("Longest flight", renderFlightRefRow(b.longestByHours)) +
    renderBreakdownSection("Shortest flight", renderFlightRefRow(b.shortestByHours)) +
    renderBreakdownSection("Most-used airline", renderMostUsedAirlineLine(b.mostUsedAirline)) +
    renderBreakdownSection("Average per year", `<p class="dialog-notes">${escapeHtml(formatDuration(b.avgYearlyHours))}/year</p>`) +
    renderBreakdownSection("Time by airline", renderAirlineRows(b.airlines, (a) => formatDuration(a.hours)));
  openDialog({ title: "Time breakdown", bodyHtml: body });
}

function openFlightsBreakdown() {
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const body =
    renderBreakdownSection("Longest flight", renderFlightRefRow(b.longestByKm)) +
    renderBreakdownSection("Shortest flight", renderFlightRefRow(b.shortestByKm)) +
    renderBreakdownSection("Most-used airline", renderMostUsedAirlineLine(b.mostUsedAirline)) +
    renderBreakdownSection("Average per year", `<p class="dialog-notes">${b.avgYearlyFlights.toFixed(1)} flights/year</p>`) +
    renderBreakdownSection(
      "Flights by airline",
      renderAirlineRows(b.airlines, (a) => `${a.count} ${a.count === 1 ? "flight" : "flights"}`)
    );
  openDialog({ title: "Flights breakdown", bodyHtml: body });
}

function openAirportsBreakdown() {
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const body =
    renderBreakdownSection("Most visited", renderAirportRows(b.mostVisitedAirport ? [b.mostVisitedAirport] : [])) +
    renderBreakdownSection("Least visited", renderAirportRows(b.leastVisitedAirport ? [b.leastVisitedAirport] : [])) +
    renderBreakdownSection("All airports", renderAirportRows(b.airports));
  openDialog({ title: "Airports breakdown", bodyHtml: body });
}

function openAirlinesBreakdown() {
  const b = computeFlightBreakdown(data.connections, index.citiesById, airportsByCode);
  const body = renderBreakdownSection(
    "Flights by airline",
    renderAirlineRows(b.airlines, (a) => `${a.count} ${a.count === 1 ? "flight" : "flights"}`)
  );
  openDialog({ title: "Airlines breakdown", bodyHtml: body });
}

function openSeatsBreakdown() {
  const seatData = computeSeatHeatmap(data.connections);

  if (!seatData.rows.length) {
    openDialog({
      title: "Seat map",
      bodyHtml: `<p class="dialog-notes">No seats logged yet — add a seat (e.g. 14A) when logging a flight.</p>`,
    });
    return;
  }

  // Common single-aisle 3-3 layout gets a visual aisle gap after the 3rd
  // column; anything wider is too variable to guess reliably, so it's left
  // as a plain contiguous grid.
  const gapAfter = seatData.cols.length > 3 && seatData.cols.length <= 6 ? 3 : null;

  const headerCells = seatData.cols
    .map((col, i) => `<div class="seat-col-label${gapAfter && i === gapAfter ? " seat-gap" : ""}">${escapeHtml(col)}</div>`)
    .join("");

  const bodyRows = seatData.rows
    .map((row) => {
      const cells = seatData.cols
        .map((col, i) => {
          const count = seatData.counts.get(`${row}${col}`) || 0;
          const intensity = seatData.maxCount ? count / seatData.maxCount : 0;
          const style = count ? `background: rgba(201, 98, 42, ${(0.15 + intensity * 0.75).toFixed(2)});` : "";
          return `<div class="seat-cell${gapAfter && i === gapAfter ? " seat-gap" : ""}" style="${style}" title="${row}${col}: ${count} ${
            count === 1 ? "flight" : "flights"
          }">${count || ""}</div>`;
        })
        .join("");
      return `<div class="seat-row"><span class="seat-row-label">${row}</span>${cells}</div>`;
    })
    .join("");

  const body = `
    <div class="seat-map-shell">
      <div class="seat-map-nose"><span class="seat-map-cockpit"></span></div>
      <div class="seat-map-body">
        <div class="seat-map">
          <div class="seat-row seat-header"><span class="seat-row-label"></span>${headerCells}</div>
          ${bodyRows}
        </div>
      </div>
      <div class="seat-map-tail"></div>
    </div>
    <p class="stats-note">Darker seats were flown more often. Layout reflects the rows/columns you've actually logged, not your exact aircraft.</p>
  `;
  openDialog({ title: "Seat map", bodyHtml: body });
}

function setupFab() {
  const fabBtn = document.getElementById("fab-add");
  const menu = document.getElementById("fab-menu");

  fabBtn.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });

  menu.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    menu.hidden = true;
    if (btn.dataset.action === "add-city") await addCity();
    else if (btn.dataset.action === "add-country") await addCountry();
    else if (btn.dataset.action === "add-flight") await addFlight();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#fab-wrap")) menu.hidden = true;
  });
}

function setupSettings() {
  document.getElementById("btn-export").addEventListener("click", () => exportData(data));

  const fileInput = document.getElementById("import-file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      data = await importData(file);
      backfillCityPopulations();
      refreshIndexes();
      mapHandle.updateData(data, index.citiesById);
      showOfflineToast("Data imported");
    } catch (err) {
      alert(err.message || "Could not import that file.");
    }
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("Delete all your data? This removes every city, country, and flight you've added. This can't be undone.")) return;
    data = deleteAllData();
    refreshIndexes();
    mapHandle.updateData(data, index.citiesById);
  });
}

function renderSyncConnectedState(config) {
  document.getElementById("sync-disconnected").hidden = true;
  const connectedEl = document.getElementById("sync-connected");
  connectedEl.hidden = false;
  document.getElementById("sync-status").textContent = `Connected with sync code "${config.syncCode}".`;
}

function renderSyncDisconnectedState() {
  document.getElementById("sync-connected").hidden = true;
  document.getElementById("sync-disconnected").hidden = false;
}

async function startSync(config) {
  await connectSync(config);
  syncConnected = true;

  let remote = null;
  try {
    remote = await pullRemote();
  } catch (err) {
    syncConnected = false;
    throw new Error("Couldn't reach Firestore — double-check the config and rules, then try again.");
  }

  if (remote && typeof remote.updatedAt === "number" && remote.updatedAt > (data.updatedAt || 0)) {
    applyingRemoteSync = true;
    data = remote;
    backfillCityPopulations();
    persistAndRefreshMap();
    rerenderCurrentView();
    applyingRemoteSync = false;
  } else {
    await pushRemote(data);
  }

  watchRemote((remoteData) => applyRemoteData(remoteData));
}

function setupSync() {
  const errorEl = document.getElementById("sync-error");
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  const existingConfig = getSyncConfig();
  if (existingConfig) {
    renderSyncConnectedState(existingConfig);
    startSync(existingConfig).catch(() => {
      // stored config didn't work this time (offline, revoked rules, etc.) — the
      // UI still shows "connected" since the config is still saved locally, and
      // the next successful connection attempt (e.g. on reload) will catch up
    });
  }

  document.getElementById("btn-sync-connect").addEventListener("click", async () => {
    errorEl.hidden = true;
    const configText = document.getElementById("sync-config-input").value.trim();
    const syncCode = document.getElementById("sync-code-input").value.trim();

    if (!syncCode) {
      showError("Pick a sync code first — any private string, the same one on both devices.");
      return;
    }

    let firebaseConfig;
    try {
      firebaseConfig = JSON.parse(configText);
    } catch {
      showError("That doesn't look like valid JSON — paste the whole firebaseConfig object as shown in your Firebase project settings.");
      return;
    }
    if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
      showError("That config is missing apiKey/projectId — make sure you copied the whole object.");
      return;
    }

    const config = { firebaseConfig, syncCode };
    const btn = document.getElementById("btn-sync-connect");
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      await startSync(config);
      saveSyncConfig(config);
      renderSyncConnectedState(config);
    } catch (err) {
      showError(err.message || "Couldn't connect — check your config and Firestore rules.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Connect & sync";
    }
  });

  document.getElementById("btn-sync-now").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const remote = await pullRemote();
      if (remote && typeof remote.updatedAt === "number" && remote.updatedAt > (data.updatedAt || 0)) {
        applyRemoteData(remote);
      } else {
        await pushRemote(data);
        showOfflineToast("Synced");
      }
    } catch {
      showOfflineToast("Sync failed — check your connection");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-sync-disconnect").addEventListener("click", () => {
    if (!confirm("Stop syncing this device? Your data already saved to the cloud isn't deleted — you can reconnect with the same sync code later.")) return;
    disconnectSync();
    syncConnected = false;
    renderSyncDisconnectedState();
  });
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

function isDarkActive() {
  const stored = getStoredTheme();
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : false;
}

function updateThemeToggleIcon() {
  document.getElementById("theme-toggle").innerHTML = isDarkActive() ? icons.sun(18) : icons.moon(18);
}

function updateRoutesToggleButton() {
  document.getElementById("toggle-routes").setAttribute("aria-pressed", String(mapHandle.areRoutesVisible()));
}

function updateHomeCitiesToggleButton() {
  document.getElementById("toggle-home-cities").setAttribute("aria-pressed", String(mapHandle.areHomeCitiesVisible()));
}

function updateAllCitiesToggleButton() {
  document.getElementById("toggle-all-cities").setAttribute("aria-pressed", String(mapHandle.areAllCitiesVisible()));
}

function recreateMap(dark) {
  const center = mapHandle.map.getCenter();
  const zoom = mapHandle.map.getZoom();
  const routesVisible = mapHandle.areRoutesVisible();
  const homeCitiesVisible = mapHandle.areHomeCitiesVisible();
  const allCitiesVisible = mapHandle.areAllCitiesVisible();

  mapHandle.map.remove();

  mapHandle = createMap({
    container: "map",
    data,
    countriesGeojson,
    citiesById: index.citiesById,
    airportsByCode,
    dark,
    onCitySelect: (props) => openCityDialog(props.id),
    onCountrySelect: (props) => openCountryDialog(props.code),
    onFlightSelect: (props) => openFlightDialog(props.index),
  });

  mapHandle.map.once("load", () => {
    mapHandle.map.jumpTo({ center, zoom });
    mapHandle.setRoutesVisible(routesVisible);
    mapHandle.setHomeCitiesVisible(homeCitiesVisible);
    mapHandle.setAllCitiesVisible(allCitiesVisible);
    applyFlightFilter();
    updateRoutesToggleButton();
    updateHomeCitiesToggleButton();
    updateAllCitiesToggleButton();
  });

  initEditor(mapHandle);
}

function setupTheme() {
  updateThemeToggleIcon();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const nextDark = !isDarkActive();
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    setStoredTheme(nextDark ? "dark" : "light");
    updateThemeToggleIcon();
    recreateMap(nextDark);
  });
}

function setupRoutesToggle() {
  document.getElementById("toggle-routes").addEventListener("click", () => {
    const next = !mapHandle.areRoutesVisible();
    mapHandle.setRoutesVisible(next);
    updateRoutesToggleButton();
  });
}

function setupHomeCitiesToggle() {
  document.getElementById("toggle-home-cities").addEventListener("click", () => {
    const next = !mapHandle.areHomeCitiesVisible();
    mapHandle.setHomeCitiesVisible(next);
    updateHomeCitiesToggleButton();
  });
}

function setupAllCitiesToggle() {
  document.getElementById("toggle-all-cities").addEventListener("click", () => {
    const next = !mapHandle.areAllCitiesVisible();
    mapHandle.setAllCitiesVisible(next);
    updateAllCitiesToggleButton();
  });
}

function getFlightFilterOptions() {
  const years = new Set();
  const airlines = new Map();
  for (const c of data.connections) {
    const year = (c.date || "").slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
    const key = c.airlineCode || c.airline;
    if (key) airlines.set(key, c.airline || c.airlineCode);
  }
  return {
    years: [...years].sort((a, b) => b - a),
    airlines: [...airlines.entries()].sort((a, b) => a[1].localeCompare(b[1])),
  };
}

function renderFlightFilterOptions() {
  const { years, airlines } = getFlightFilterOptions();
  const yearSelect = document.getElementById("filter-year");
  const airlineSelect = document.getElementById("filter-airline");

  yearSelect.innerHTML = `<option value="">All years</option>${years
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("")}`;
  airlineSelect.innerHTML = `<option value="">All airlines</option>${airlines
    .map(([key, name]) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`)
    .join("")}`;

  yearSelect.value = years.includes(flightFilter.year) ? flightFilter.year : "";
  airlineSelect.value = airlines.some(([key]) => key === flightFilter.airline) ? flightFilter.airline : "";
}

function matchesFlightFilter(conn) {
  if (flightFilter.year && (conn.date || "").slice(0, 4) !== flightFilter.year) return false;
  if (flightFilter.airline && (conn.airlineCode || conn.airline) !== flightFilter.airline) return false;
  return true;
}

function applyFlightFilter() {
  mapHandle.setVisibleConnections(data.connections.filter(matchesFlightFilter));
  const active = !!(flightFilter.year || flightFilter.airline);
  document.getElementById("toggle-flight-filter").setAttribute("aria-pressed", String(active));
}

function setupFlightFilter() {
  const btn = document.getElementById("toggle-flight-filter");
  const panel = document.getElementById("flight-filter-panel");
  const yearSelect = document.getElementById("filter-year");
  const airlineSelect = document.getElementById("filter-airline");
  const clearBtn = document.getElementById("filter-clear");

  btn.addEventListener("click", () => {
    if (panel.hidden) renderFlightFilterOptions();
    panel.hidden = !panel.hidden;
  });

  yearSelect.addEventListener("change", () => {
    flightFilter.year = yearSelect.value;
    applyFlightFilter();
  });

  airlineSelect.addEventListener("change", () => {
    flightFilter.airline = airlineSelect.value;
    applyFlightFilter();
  });

  clearBtn.addEventListener("click", () => {
    flightFilter = { year: "", airline: "" };
    yearSelect.value = "";
    airlineSelect.value = "";
    applyFlightFilter();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#flight-filter-panel") && !e.target.closest("#toggle-flight-filter")) panel.hidden = true;
  });
}

/**
 * Cities saved before the population field existed (or imported from an older
 * export) have no size data — fill it in by matching against the offline
 * dataset so their dots aren't stuck at the smallest tier forever.
 */
function backfillCityPopulations() {
  let changed = false;
  for (const city of data.cities) {
    if (city.population) continue;
    const candidates = citiesData[city.countryCode] || [];
    const match = candidates.find((c) => foldDiacritics(c.name.toLowerCase()) === foldDiacritics(city.name.toLowerCase()));
    if (match) {
      city.population = match.p;
      changed = true;
    }
  }
  if (changed) saveData(data);
}

async function main() {
  initDialog();

  const [loadedData, loadedCountriesGeoJson, loadedCitiesData, loadedAirportsData, loadedAirlinesData, loadedCountryCodes] =
    await Promise.all([
      loadData(),
      loadCountriesGeoJson(),
      loadCitiesData(),
      loadAirportsData(),
      loadAirlinesData(),
      loadCountryCodes(),
    ]);
  data = loadedData;
  countriesGeojson = loadedCountriesGeoJson;
  countryList = getCountryList(countriesGeojson);
  citiesData = loadedCitiesData;
  allWorldCities = Object.entries(citiesData).flatMap(([code, list]) =>
    list.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng, countryCode: code, p: c.p }))
  );
  airportsData = loadedAirportsData;
  airportsByCode = new Map(airportsData.map((a) => [a.code, a]));
  airlinesData = loadedAirlinesData;
  iso2ByIso3 = new Map(Object.entries(loadedCountryCodes).map(([iso2, iso3]) => [iso3, iso2]));
  backfillCityPopulations();
  refreshIndexes();

  mapHandle = createMap({
    container: "map",
    data,
    countriesGeojson,
    citiesById: index.citiesById,
    airportsByCode,
    dark: isDarkActive(),
    onCitySelect: (props) => openCityDialog(props.id),
    onCountrySelect: (props) => openCountryDialog(props.code),
    onFlightSelect: (props) => openFlightDialog(props.index),
  });

  initEditor(mapHandle);
  hydrateIcons();
  setupSearch();
  setupSidebar();
  setupFab();
  setupSettings();
  setupSync();
  setupTheme();
  setupRoutesToggle();
  updateRoutesToggleButton();
  setupHomeCitiesToggle();
  updateHomeCitiesToggleButton();
  setupAllCitiesToggle();
  updateAllCitiesToggleButton();
  setupFlightFilter();

  window.addEventListener("offline", () => showOfflineToast("You're offline — showing cached map"));
  window.addEventListener("online", () => showOfflineToast("Back online"));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  }
}

main();
