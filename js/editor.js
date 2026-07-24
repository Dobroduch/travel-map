import { escapeHtml, foldDiacritics } from "./util.js";
import { icons } from "./icons.js";
import { slugify, uniqueId } from "./data.js";
import { searchPlaces } from "./geocode.js";
import { airlineLogoUrl } from "./flightstats.js";
import { lookupAircraftType } from "./aircraftlookup.js";

let overlay, closeBtn, titleEl, formEl;
let banner, bannerText, bannerCancelBtn;
let mapHandle = null;
let currentCancel = null;

// Common commercial aircraft types, for the "Aircraft type" combo. Not exhaustive —
// free text is still accepted for anything not in this list.
const AIRCRAFT_TYPES = [
  "A220-100", "A220-300",
  "A318", "A319", "A320", "A321", "A321neo",
  "A330-200", "A330-300", "A330-900neo",
  "A340-300", "A340-600",
  "A350-900", "A350-1000",
  "A380-800",
  "737-700", "737-800", "737-900", "737 MAX 8", "737 MAX 9",
  "747-400", "747-8",
  "757-200", "757-300",
  "767-300", "767-400",
  "777-200", "777-200ER", "777-300ER",
  "787-8", "787-9", "787-10",
  "CRJ-700", "CRJ-900",
  "E170", "E175", "E190", "E195",
  "ATR 72",
  "Dash 8 Q400",
];

export function initEditor(handle) {
  mapHandle = handle;

  overlay = document.getElementById("editor-overlay");
  closeBtn = document.getElementById("editor-close");
  titleEl = document.getElementById("editor-title");
  formEl = document.getElementById("editor-form");

  banner = document.getElementById("pick-banner");
  bannerText = document.getElementById("pick-banner-text");
  bannerCancelBtn = document.getElementById("pick-banner-cancel");

  closeBtn.innerHTML = `${icons.close(14)}<span>Close</span>`;

  closeBtn.addEventListener("click", () => cancelEditor());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cancelEditor();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) cancelEditor();
  });
}

function cancelEditor() {
  overlay.hidden = true;
  banner.hidden = true;
  mapHandle.cancelPickLocation();
  if (currentCancel) {
    const cancel = currentCancel;
    currentCancel = null;
    cancel();
  }
}

function showEditor(title) {
  titleEl.textContent = title;
  overlay.hidden = false;
}

async function promptPickLocation(instruction) {
  const wasOverlayVisible = !overlay.hidden;
  overlay.hidden = true;

  bannerText.textContent = instruction;
  banner.hidden = false;

  const cancelPromise = new Promise((resolve) => {
    bannerCancelBtn.onclick = () => resolve(null);
  });

  const coords = await Promise.race([mapHandle.pickLocation(), cancelPromise]);

  banner.hidden = true;
  bannerCancelBtn.onclick = null;
  if (wasOverlayVisible) overlay.hidden = false;
  if (coords === null) mapHandle.cancelPickLocation();
  return coords;
}

function parseDates(text) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function countryOptions(countries, selectedCode) {
  return countries
    .map((c) => `<option value="${c.code}" ${c.code === selectedCode ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
}

/** Renders a text-input-with-dropdown that substring-matches on country name as you type. */
function renderCountryCombo({ container, countries, onSelect, placeholder = "Search countries..." }) {
  container.innerHTML = `
    <input type="text" class="combo-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    <div class="combo-results"></div>
  `;
  const input = container.querySelector(".combo-input");
  const results = container.querySelector(".combo-results");

  input.addEventListener("input", () => {
    const q = foldDiacritics(input.value.trim().toLowerCase());
    if (!q) {
      results.innerHTML = "";
      return;
    }
    const matches = countries.filter((c) => foldDiacritics(c.name.toLowerCase()).includes(q)).slice(0, 8);
    results.innerHTML = matches.length
      ? matches
          .map((c) => `<button type="button" class="combo-result" data-code="${c.code}">${escapeHtml(c.name)}</button>`)
          .join("")
      : `<div class="combo-empty">No matches</div>`;
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-result");
    if (!btn) return;
    const country = countries.find((c) => c.code === btn.dataset.code);
    if (country) onSelect(country);
  });

  input.focus();
}

/**
 * Renders a text-input-with-dropdown that prefix-matches on city name as you
 * type against the offline dataset; if that comes up empty, falls back
 * (debounced) to an online OpenStreetMap search scoped to `countryCode`,
 * so landmarks and small places not in the offline list are still findable.
 */
function renderCityCombo({ container, cities, countryCode, onSelect, placeholder = "Start typing a city name..." }) {
  container.innerHTML = `
    <input type="text" class="combo-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    <div class="combo-results"></div>
  `;
  const input = container.querySelector(".combo-input");
  const results = container.querySelector(".combo-results");
  let currentMatches = [];
  let debounceTimer = null;
  let controller = null;

  function renderMatches(matches, state = null) {
    if (state === "loading") {
      results.innerHTML = `<div class="combo-empty">Searching online…</div>`;
      return;
    }
    if (state === "error") {
      results.innerHTML = `<div class="combo-empty">Couldn't reach online search — add it as a custom place below</div>`;
      return;
    }
    currentMatches = matches;
    results.innerHTML = matches.length
      ? matches
          .map(
            (c, i) =>
              `<button type="button" class="combo-result" data-i="${i}">${escapeHtml(c.name)}${
                c.typeLabel ? `<span class="combo-result-sub"> · ${escapeHtml(c.typeLabel)}</span>` : ""
              }</button>`
          )
          .join("")
      : `<div class="combo-empty">No matches — add it as a custom place below</div>`;
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    if (controller) controller.abort();

    const raw = input.value.trim();
    const q = foldDiacritics(raw.toLowerCase());
    if (!q) {
      results.innerHTML = "";
      currentMatches = [];
      return;
    }

    const offlineMatches = cities.filter((c) => foldDiacritics(c.name.toLowerCase()).startsWith(q)).slice(0, 10);
    if (offlineMatches.length) {
      renderMatches(offlineMatches);
      return;
    }

    renderMatches([], "loading");
    debounceTimer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const online = await searchPlaces(raw, { signal: controller.signal });
        if (foldDiacritics(input.value.trim().toLowerCase()) !== q) return; // superseded
        renderMatches(online.filter((c) => c.countryCode === countryCode));
      } catch (err) {
        if (err.name === "AbortError") return;
        renderMatches([], "error");
      }
    }, 350);
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-result");
    if (!btn) return;
    const city = currentMatches[Number(btn.dataset.i)];
    if (city) onSelect(city);
  });

  input.focus();
}

/**
 * Add-mode resolves once the whole session ends (cancelled or closed); each
 * individual city added along the way is delivered via `onAdd`, since a
 * single session can add several cities in a row ("Add & add another").
 * Edit-mode resolves with the edited city fields, or null if cancelled.
 * @returns {Promise<object|null|undefined>}
 */
export function openCityForm({
  mode,
  city = null,
  country = null,
  coords = null,
  name = "",
  population = null,
  countries,
  citiesData = {},
  existingIds,
  onAdd,
}) {
  return new Promise((resolve) => {
    currentCancel = () => resolve(null);

    if (mode === "edit") {
      renderEditForm();
      return;
    }

    if (mode === "quick") {
      renderDetailsStep(country, { name, lat: coords.lat, lng: coords.lng, population });
      return;
    }

    renderCountryStep();

    function renderCountryStep() {
      showEditor("Add city or place — choose a country");
      formEl.onsubmit = (e) => e.preventDefault();
      formEl.innerHTML = `
        <div class="form-row">
          <label>Country</label>
          <div id="step-combo"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
        </div>
      `;
      document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());
      renderCountryCombo({
        container: document.getElementById("step-combo"),
        countries,
        onSelect: (country) => renderCityStep(country),
      });
    }

    function renderCityStep(country) {
      showEditor(`Add city or place — ${country.name}`);
      formEl.onsubmit = (e) => e.preventDefault();
      const cityList = citiesData[country.code] || [];
      formEl.innerHTML = `
        <div class="form-row">
          <label>Country</label>
          <div class="selected-chip"><span>${escapeHtml(country.name)}</span><button type="button" id="f-change-country">Change</button></div>
        </div>
        <div class="form-row">
          <label>City or town</label>
          <div id="step-combo"></div>
        </div>
        <p class="form-hint">Looking for a landmark, castle, park, or a place not listed? <button type="button" id="f-manual" class="link-btn">Add a custom place</button></p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
        </div>
      `;
      document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());
      document.getElementById("f-change-country").addEventListener("click", renderCountryStep);
      document.getElementById("f-manual").addEventListener("click", () => startManual(country));

      renderCityCombo({
        container: document.getElementById("step-combo"),
        cities: cityList,
        countryCode: country.code,
        onSelect: (match) =>
          renderDetailsStep(country, { name: match.name, lat: match.lat, lng: match.lng, population: match.p ?? null }),
      });
    }

    async function startManual(country) {
      const coords = await promptPickLocation("Click anywhere on the map to place the pin for this place.");
      if (!coords) {
        renderCityStep(country);
        return;
      }
      renderDetailsStep(country, { name: "", lat: coords.lat, lng: coords.lng });
    }

    function renderDetailsStep(country, { name, lat, lng, population = null }) {
      showEditor(name ? `Add ${name}` : "Add city or place");
      let coords = { lat, lng };

      const renderPinLine = () => `
        <div class="pin-readout">
          <span>Pin at ${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}</span>
          <button type="button" id="editor-move-pin">Move pin</button>
        </div>`;

      formEl.innerHTML = `
        <div class="form-row">
          <label>Country</label>
          <div class="selected-chip"><span>${escapeHtml(country.name)}</span><button type="button" id="f-change-country">Change</button></div>
        </div>
        <div class="form-row">${renderPinLine()}</div>
        <div class="form-row">
          <label for="f-name">Name</label>
          <input type="text" id="f-name" required value="${escapeHtml(name)}" />
        </div>
        <div class="form-row">
          <label for="f-dates">Dates visited (one per line)</label>
          <textarea id="f-dates" placeholder="15.06.2024&#10;20.06.2024"></textarea>
        </div>
        <div class="form-row">
          <label for="f-notes">Notes</label>
          <textarea id="f-notes" placeholder="Optional"></textarea>
        </div>
        <p class="form-error" id="f-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
          <button type="submit" class="btn-secondary" data-action="another">Add &amp; add another</button>
          <button type="submit" class="btn-primary" data-action="close">Add &amp; close</button>
        </div>
      `;

      document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());
      document.getElementById("f-change-country").addEventListener("click", renderCountryStep);

      const handleMovePinClick = async () => {
        const next = await promptPickLocation("Click the map to move this pin.");
        if (next) {
          coords = next;
          formEl.querySelector(".pin-readout").outerHTML = renderPinLine();
          document.getElementById("editor-move-pin").addEventListener("click", handleMovePinClick);
        }
      };
      document.getElementById("editor-move-pin").addEventListener("click", handleMovePinClick);

      formEl.onsubmit = (e) => {
        e.preventDefault();
        const cityName = document.getElementById("f-name").value.trim();
        const errorEl = document.getElementById("f-error");

        if (!cityName) {
          errorEl.textContent = "Please enter a city name.";
          errorEl.hidden = false;
          return;
        }

        const id = uniqueId(slugify(cityName), existingIds);
        const result = {
          id,
          name: cityName,
          country: country.name,
          countryCode: country.code,
          lat: coords.lat,
          lng: coords.lng,
          population,
          dates: parseDates(document.getElementById("f-dates").value),
          notes: document.getElementById("f-notes").value.trim(),
        };

        onAdd(result);

        if (e.submitter?.dataset.action === "another") {
          renderCityStep(country);
        } else {
          currentCancel = null;
          overlay.hidden = true;
          resolve();
        }
      };
    }

    function renderEditForm() {
      let coords = { lng: city.lng, lat: city.lat };

      showEditor("Edit city or place");

      const renderPinLine = () => `
        <div class="pin-readout">
          <span>Pin at ${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}</span>
          <button type="button" id="editor-move-pin">Move pin</button>
        </div>`;

      formEl.innerHTML = `
        <div class="form-row">${renderPinLine()}</div>
        <div class="form-row">
          <label for="f-name">Name</label>
          <input type="text" id="f-name" required value="${escapeHtml(city.name)}" />
        </div>
        <div class="form-row">
          <label for="f-country">Country</label>
          <select id="f-country" required>
            <option value="" disabled>Select a country</option>
            ${countryOptions(countries, city.countryCode)}
          </select>
        </div>
        <div class="form-row">
          <label for="f-dates">Dates visited (one per line)</label>
          <textarea id="f-dates" placeholder="15.06.2024&#10;20.06.2024">${escapeHtml((city.dates || []).join("\n"))}</textarea>
        </div>
        <div class="form-row">
          <label for="f-notes">Notes</label>
          <textarea id="f-notes" placeholder="Optional">${escapeHtml(city.notes || "")}</textarea>
        </div>
        <p class="form-error" id="f-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
          <button type="submit" class="btn-primary">Save changes</button>
        </div>
      `;

      document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());

      const handleMovePinClick = async () => {
        const next = await promptPickLocation("Click the map to move this pin.");
        if (next) {
          coords = next;
          formEl.querySelector(".pin-readout").outerHTML = renderPinLine();
          document.getElementById("editor-move-pin").addEventListener("click", handleMovePinClick);
        }
      };
      document.getElementById("editor-move-pin").addEventListener("click", handleMovePinClick);

      formEl.onsubmit = (e) => {
        e.preventDefault();
        const name = document.getElementById("f-name").value.trim();
        const countryCode = document.getElementById("f-country").value;
        const errorEl = document.getElementById("f-error");

        if (!name || !countryCode) {
          errorEl.textContent = "Please fill in the city name and country.";
          errorEl.hidden = false;
          return;
        }

        const countryName = countries.find((c) => c.code === countryCode)?.name || countryCode;

        currentCancel = null;
        overlay.hidden = true;
        resolve({
          id: city.id,
          name,
          country: countryName,
          countryCode,
          lat: coords.lat,
          lng: coords.lng,
          population: city.population ?? null,
          dates: parseDates(document.getElementById("f-dates").value),
          notes: document.getElementById("f-notes").value.trim(),
        });
      };
    }
  });
}

/**
 * @returns {Promise<{code: string, name: string}|null>}
 */
export function openCountryForm({ countries, visitedCodes }) {
  return new Promise((resolve) => {
    currentCancel = () => resolve(null);

    const available = countries.filter((c) => !visitedCodes.has(c.code));

    showEditor("Add visited country");

    if (!available.length) {
      formEl.innerHTML = `<p class="form-hint">Every country on the map is already marked as visited.</p>
        <div class="form-actions"><button type="button" class="btn-primary" id="f-ok">OK</button></div>`;
      document.getElementById("f-ok").addEventListener("click", () => {
        currentCancel = null;
        overlay.hidden = true;
        resolve(null);
      });
      formEl.onsubmit = (e) => e.preventDefault();
      return;
    }

    formEl.onsubmit = (e) => e.preventDefault();
    formEl.innerHTML = `
      <div class="form-row">
        <label>Country</label>
        <div id="step-combo"></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
      </div>
    `;

    document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());

    renderCountryCombo({
      container: document.getElementById("step-combo"),
      countries: available,
      onSelect: (country) => {
        currentCancel = null;
        overlay.hidden = true;
        resolve({ code: country.code, name: country.name });
      },
    });
  });
}

/**
 * A name + optional date-range + place-checklist form for grouping a run of
 * flights/cities into a named trip. Membership can come from either signal:
 * an explicit city selection (for when the dates are long forgotten) or a
 * date range (any visit/flight inside it counts) — either is enough on its own.
 * @param {{trip?: object|null, cities: {id: string, name: string, country: string}[]}} args
 * @returns {Promise<{name: string, startDate: string|null, endDate: string|null, cityIds: string[]}|null>}
 */
export function openTripForm({ trip = null, cities = [] } = {}) {
  return new Promise((resolve) => {
    currentCancel = () => resolve(null);
    showEditor(trip ? "Edit trip" : "Add trip");
    formEl.onsubmit = (e) => e.preventDefault();

    const selectedIds = new Set(trip?.cityIds || []);
    const cityListHtml = cities.length
      ? cities
          .map(
            (c) => `
        <label class="checkbox-label trip-city-check">
          <input type="checkbox" value="${escapeHtml(c.id)}" ${selectedIds.has(c.id) ? "checked" : ""} />
          ${escapeHtml(c.name)}<span class="trip-city-country">${escapeHtml(c.country)}</span>
        </label>`
          )
          .join("")
      : `<p class="form-hint">Add some cities first to select them here.</p>`;

    formEl.innerHTML = `
      <div class="form-row">
        <label for="f-trip-name">Name</label>
        <input type="text" id="f-trip-name" placeholder="e.g. Japan 2024" value="${escapeHtml(trip?.name || "")}" />
      </div>
      <div class="form-row-split">
        <div class="form-row">
          <label for="f-trip-start">Start date <span class="form-optional">(optional)</span></label>
          <input type="date" id="f-trip-start" value="${trip?.startDate || ""}" />
        </div>
        <div class="form-row">
          <label for="f-trip-end">End date <span class="form-optional">(optional)</span></label>
          <input type="date" id="f-trip-end" value="${trip?.endDate || ""}" />
        </div>
      </div>
      <p class="trip-city-heading">Places on this trip</p>
      <p class="form-hint">Don't remember the exact dates? Just pick the cities instead.</p>
      <div class="trip-city-checklist">${cityListHtml}</div>
      <p class="form-error" id="f-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="f-save">${trip ? "Save" : "Add trip"}</button>
      </div>
    `;

    document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());
    document.getElementById("f-save").addEventListener("click", () => {
      const name = document.getElementById("f-trip-name").value.trim();
      const startDate = document.getElementById("f-trip-start").value;
      const endDate = document.getElementById("f-trip-end").value;
      const cityIds = [...formEl.querySelectorAll(".trip-city-checklist input:checked")].map((el) => el.value);
      const errorEl = document.getElementById("f-error");
      errorEl.hidden = true;

      if (!name) {
        errorEl.textContent = "Give the trip a name.";
        errorEl.hidden = false;
        return;
      }
      if ((startDate && !endDate) || (!startDate && endDate)) {
        errorEl.textContent = "Pick both a start and end date, or leave both empty.";
        errorEl.hidden = false;
        return;
      }
      if (startDate && endDate && endDate < startDate) {
        errorEl.textContent = "End date can't be before the start date.";
        errorEl.hidden = false;
        return;
      }
      if (!cityIds.length && !(startDate && endDate)) {
        errorEl.textContent = "Select at least one place, or set a date range.";
        errorEl.hidden = false;
        return;
      }

      currentCancel = null;
      overlay.hidden = true;
      resolve({ name, startDate: startDate || null, endDate: endDate || null, cityIds });
    });
  });
}

function tokenize(str) {
  return foldDiacritics(str.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * @returns {Promise<object|null>} the submitted connection fields, or null if cancelled.
 */
/** Renders a text-input-with-dropdown that suggests airports by code or any word in the name/city. */
function renderAirportCombo({ container, airports, initialValue = "" }) {
  container.innerHTML = `
    <input type="text" class="combo-input" placeholder="e.g. VIE or Vienna" autocomplete="off" value="${escapeHtml(initialValue)}" />
    <div class="combo-results"></div>
  `;
  const input = container.querySelector(".combo-input");
  const results = container.querySelector(".combo-results");
  let currentMatches = [];

  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const q = foldDiacritics(raw.toLowerCase());
    if (!q) {
      results.innerHTML = "";
      currentMatches = [];
      return;
    }
    // Match on any WORD in the name/city, not just the start of the whole
    // string — airports are commonly searched by a recognizable keyword
    // (e.g. "Malpensa", "Lanzarote") that isn't the first word of the name.
    currentMatches = airports
      .filter(
        (a) =>
          a.code.toLowerCase().startsWith(q) ||
          tokenize(a.name).some((t) => t.startsWith(q)) ||
          tokenize(a.city || "").some((t) => t.startsWith(q))
      )
      .sort((a, b) => {
        const rank = (x) => {
          const code = x.code.toLowerCase();
          if (code === q) return 0;
          if (code.startsWith(q)) return 1;
          const tokens = [...tokenize(x.name), ...tokenize(x.city || "")];
          if (tokens.some((t) => t === q)) return 2;
          return 3;
        };
        return rank(a) - rank(b);
      })
      .slice(0, 8);
    results.innerHTML = currentMatches.length
      ? currentMatches
          .map(
            (a, i) =>
              `<button type="button" class="combo-result" data-i="${i}"><strong>${escapeHtml(a.code)}</strong> — ${escapeHtml(a.name)}${a.city ? `, ${escapeHtml(a.city)}` : ""}</button>`
          )
          .join("")
      : `<div class="combo-empty">No matches</div>`;
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-result");
    if (!btn) return;
    const airport = currentMatches[Number(btn.dataset.i)];
    if (!airport) return;
    input.value = airport.code;
    results.innerHTML = "";
    currentMatches = [];
  });

  return input;
}

/** Renders a text-input-with-dropdown that suggests airlines by name, with logo thumbnails. */
function renderAirlineCombo({ container, airlines, initialValue = "" }) {
  container.innerHTML = `
    <input type="text" class="combo-input" placeholder="e.g. Austrian Airlines" autocomplete="off" value="${escapeHtml(initialValue)}" />
    <div class="combo-results"></div>
  `;
  const input = container.querySelector(".combo-input");
  const results = container.querySelector(".combo-results");
  let currentMatches = [];

  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const q = foldDiacritics(raw.toLowerCase());
    if (!q) {
      results.innerHTML = "";
      currentMatches = [];
      return;
    }
    currentMatches = airlines
      .filter((a) => foldDiacritics(a.name.toLowerCase()).includes(q) || a.code.toLowerCase() === q)
      .sort((a, b) => {
        const rank = (x) => {
          const name = foldDiacritics(x.name.toLowerCase());
          if (x.code.toLowerCase() === q) return 0;
          if (name.startsWith(q)) return 1;
          return 2;
        };
        return rank(a) - rank(b);
      })
      .slice(0, 8);
    results.innerHTML = currentMatches.length
      ? currentMatches
          .map(
            (a, i) => `
        <button type="button" class="combo-result combo-result-airline" data-i="${i}">
          <img src="${airlineLogoUrl(a.code)}" alt="" class="airline-logo-sm" onerror="this.style.visibility='hidden'" />
          <span>${escapeHtml(a.name)}<span class="combo-result-sub"> · ${escapeHtml(a.code)}</span></span>
        </button>`
          )
          .join("")
      : `<div class="combo-empty">No matches — you can still type a custom name</div>`;
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-result");
    if (!btn) return;
    const airline = currentMatches[Number(btn.dataset.i)];
    if (!airline) return;
    input.value = airline.name;
    results.innerHTML = "";
    currentMatches = [];
  });

  return input;
}

/** Renders a text-input-with-dropdown that suggests common aircraft types; free text is still accepted. */
function renderAircraftTypeCombo({ container, initialValue = "" }) {
  container.innerHTML = `
    <input type="text" class="combo-input" placeholder="e.g. A320 or 737-800" autocomplete="off" value="${escapeHtml(initialValue)}" />
    <div class="combo-results"></div>
  `;
  const input = container.querySelector(".combo-input");
  const results = container.querySelector(".combo-results");
  let currentMatches = [];

  input.addEventListener("input", () => {
    const raw = input.value.trim();
    const q = raw.toLowerCase().replace(/[\s-]/g, "");
    if (!q) {
      results.innerHTML = "";
      currentMatches = [];
      return;
    }
    currentMatches = AIRCRAFT_TYPES.filter((t) => t.toLowerCase().replace(/[\s-]/g, "").includes(q)).slice(0, 8);
    results.innerHTML = currentMatches.length
      ? currentMatches.map((t, i) => `<button type="button" class="combo-result" data-i="${i}">${escapeHtml(t)}</button>`).join("")
      : `<div class="combo-empty">No matches — you can still type a custom type</div>`;
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-result");
    if (!btn) return;
    const type = currentMatches[Number(btn.dataset.i)];
    if (!type) return;
    input.value = type;
    results.innerHTML = "";
    currentMatches = [];
  });

  return input;
}

/** Resolves a combo input's current text to a real airport, by code or exact name — not just whatever was typed. */
function matchAirport(input, airports) {
  const raw = input.value.trim();
  if (!raw) return null;
  const code = raw.toUpperCase();
  return airports.find((a) => a.code === code) || airports.find((a) => a.name.toLowerCase() === raw.toLowerCase()) || null;
}

/** Best-effort link to an existing visited city sharing the airport's city + country, for flight-count badges. */
function matchCityId(airport, cities) {
  if (!airport || !airport.city) return null;
  const match = cities.find(
    (c) => c.countryCode === airport.countryCode && foldDiacritics(c.name.toLowerCase()) === foldDiacritics(airport.city.toLowerCase())
  );
  return match ? match.id : null;
}

export function openFlightForm({
  mode = "add",
  connection = null,
  prefill = null,
  cities = [],
  airports = [],
  airlines = [],
  connections = [],
}) {
  return new Promise((resolve) => {
    currentCancel = () => resolve(null);

    showEditor(mode === "edit" ? "Edit flight" : "Add flight");

    formEl.innerHTML = `
      <div class="form-row-split">
        <div class="form-row">
          <label>From</label>
          <div id="from-airport-combo"></div>
        </div>
        <div class="form-row">
          <label for="f-dep-time">Departure time <span class="form-optional">(optional)</span></label>
          <input type="time" id="f-dep-time" value="${escapeHtml(connection?.departureTime || "")}" />
        </div>
      </div>
      <div class="form-row-split">
        <div class="form-row">
          <label>To</label>
          <div id="to-airport-combo"></div>
        </div>
        <div class="form-row">
          <label for="f-arr-time">Arrival time <span class="form-optional">(optional)</span></label>
          <input type="time" id="f-arr-time" value="${escapeHtml(connection?.arrivalTime || "")}" />
        </div>
      </div>
      <div class="form-row">
        <label for="f-date">Date <span class="form-optional">(optional — leave blank if you don't remember)</span></label>
        <input type="date" id="f-date" value="${escapeHtml(connection?.date || "")}" />
      </div>
      <div class="form-row">
        <label for="f-flightnum">Flight number <span class="form-optional">(optional)</span></label>
        <input type="text" id="f-flightnum" placeholder="e.g. LX 16" value="${escapeHtml(connection?.flightNumber || "")}" />
      </div>
      <div class="form-row">
        <label>Airline <span class="form-optional">(optional)</span></label>
        <div id="airline-combo"></div>
      </div>
      <div class="form-row-split">
        <div class="form-row">
          <label>Aircraft type <span class="form-optional">(optional)</span></label>
          <div id="aircraft-type-combo"></div>
        </div>
        <div class="form-row">
          <label for="f-aircraft">Registration <span class="form-optional">(optional)</span></label>
          <input type="text" id="f-aircraft" placeholder="e.g. OE-LBA" value="${escapeHtml(connection?.aircraft || "")}" />
        </div>
      </div>
      <div class="form-row">
        <label for="f-seat">Seat <span class="form-optional">(optional)</span></label>
        <input type="text" id="f-seat" placeholder="e.g. 14A" value="${escapeHtml(connection?.seat || "")}" />
      </div>
      <p class="form-error" id="f-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="f-cancel">Cancel</button>
        ${mode === "edit" ? "" : `<button type="submit" class="btn-secondary" data-action="return">Add &amp; add return flight</button>`}
        <button type="submit" class="btn-primary" data-action="close">${mode === "edit" ? "Save changes" : "Add flight"}</button>
      </div>
    `;

    document.getElementById("f-cancel").addEventListener("click", () => cancelEditor());

    const airlineInput = renderAirlineCombo({
      container: document.getElementById("airline-combo"),
      airlines,
      initialValue: connection?.airline || prefill?.airline || "",
    });
    const fromAirportInput = renderAirportCombo({
      container: document.getElementById("from-airport-combo"),
      airports,
      initialValue: connection?.departureAirport || prefill?.departureAirport || "",
    });
    const toAirportInput = renderAirportCombo({
      container: document.getElementById("to-airport-combo"),
      airports,
      initialValue: connection?.arrivalAirport || prefill?.arrivalAirport || "",
    });

    const aircraftTypeInput = renderAircraftTypeCombo({
      container: document.getElementById("aircraft-type-combo"),
      initialValue: connection?.aircraftType || prefill?.aircraftType || "",
    });

    // A tail number is (almost) always the same specific aircraft. First check
    // whether we've already logged this registration with a type; if not, fall
    // back to a free online registry lookup so it fills in even the first time.
    const aircraftInput = document.getElementById("f-aircraft");
    const aircraftTypeResults = document.querySelector("#aircraft-type-combo .combo-results");
    aircraftInput.addEventListener("change", () => {
      if (aircraftTypeInput.value.trim()) return;
      const reg = aircraftInput.value.trim();
      if (!reg) return;
      const regLower = reg.toLowerCase();
      const known = connections.find((c) => (c.aircraft || "").trim().toLowerCase() === regLower && c.aircraftType);
      if (known) {
        aircraftTypeInput.value = known.aircraftType;
        return;
      }

      if (aircraftTypeResults) aircraftTypeResults.innerHTML = `<div class="combo-empty">Looking up aircraft type…</div>`;
      lookupAircraftType(reg)
        .then((result) => {
          if (aircraftInput.value.trim() !== reg || aircraftTypeInput.value.trim()) return;
          if (result?.type) aircraftTypeInput.value = result.type;
        })
        .catch(() => {
          // offline or unreachable — leave the field for manual entry
        })
        .finally(() => {
          if (aircraftTypeResults && aircraftInput.value.trim() === reg) aircraftTypeResults.innerHTML = "";
        });
    });

    formEl.onsubmit = (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("f-error");

      const fromAirport = matchAirport(fromAirportInput, airports);
      const toAirport = matchAirport(toAirportInput, airports);
      if (!fromAirport || !toAirport) {
        errorEl.textContent = "Pick a departure and arrival airport from the suggestions.";
        errorEl.hidden = false;
        return;
      }
      if (fromAirport.code === toAirport.code) {
        errorEl.textContent = "From and to must be different airports.";
        errorEl.hidden = false;
        return;
      }

      const airlineName = airlineInput.value.trim();
      const airlineMatch = airlines.find((a) => a.name.toLowerCase() === airlineName.toLowerCase());

      const builtConnection = {
        from: matchCityId(fromAirport, cities),
        to: matchCityId(toAirport, cities),
        date: document.getElementById("f-date").value,
        flightNumber: document.getElementById("f-flightnum").value.trim(),
        airline: airlineName,
        airlineCode: airlineMatch ? airlineMatch.code : "",
        departureAirport: fromAirport.code,
        departureTime: document.getElementById("f-dep-time").value,
        arrivalAirport: toAirport.code,
        arrivalTime: document.getElementById("f-arr-time").value,
        aircraftType: aircraftTypeInput.value.trim(),
        aircraft: document.getElementById("f-aircraft").value.trim(),
        seat: document.getElementById("f-seat").value.trim(),
      };

      currentCancel = null;
      overlay.hidden = true;
      if (mode === "edit") {
        resolve(builtConnection);
      } else {
        resolve({ connection: builtConnection, addReturn: e.submitter?.dataset.action === "return" });
      }
    };
  });
}

/**
 * A live panel (not a one-shot form) for a country: toggle it as a home base,
 * toggle individual cities' visited status (home-base countries only), and
 * delete cities — all without leaving the view.
 */
export function openCountryEditor({
  countryName,
  homeBaseLimit,
  isHomeBase,
  getCities,
  onToggleHomeBase,
  onToggleVisited,
  onDeleteCity,
}) {
  currentCancel = () => {};
  showEditor(`Edit ${countryName}`);
  formEl.onsubmit = (e) => e.preventDefault();

  function render() {
    const cities = getCities();

    const cityListHtml = cities.length
      ? `
      <div class="city-edit-list">
        ${cities
          .map(
            (c) => `
          <div class="city-edit-row">
            <div class="city-edit-info">
              <span class="city-edit-name">${escapeHtml(c.name)}</span>
              ${
                isHomeBase
                  ? `<label class="checkbox-label">
                <input type="checkbox" class="visited-check" data-id="${c.id}" ${c.visited === false ? "" : "checked"} />
                Visited
              </label>`
                  : ""
              }
            </div>
            <button type="button" class="icon-btn icon-btn-danger city-edit-delete" data-id="${c.id}" aria-label="Delete ${escapeHtml(c.name)}">${icons.trash(16)}</button>
          </div>`
          )
          .join("")}
      </div>`
      : `<p class="form-hint">No cities in ${escapeHtml(countryName)} yet.</p>`;

    formEl.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox" id="home-base-check" ${isHomeBase ? "checked" : ""} />
        Home base country
      </label>
      <p class="form-hint">Home base countries let you toggle individual cities on/off as "visited" — handy for places you live in rather than just travel to.</p>
      ${cityListHtml}
      <p class="form-error" id="f-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn-primary" id="f-done">Done</button>
      </div>
    `;

    document.getElementById("f-done").addEventListener("click", () => {
      overlay.hidden = true;
    });

    document.getElementById("home-base-check").addEventListener("change", (e) => {
      const checked = e.target.checked;
      const ok = onToggleHomeBase(checked);
      if (!ok) {
        e.target.checked = !checked;
        const errorEl = document.getElementById("f-error");
        errorEl.textContent = `Only ${homeBaseLimit} home base countries allowed — unmark one first.`;
        errorEl.hidden = false;
        return;
      }
      isHomeBase = checked;
      render();
    });

    formEl.querySelectorAll(".visited-check").forEach((cb) => {
      cb.addEventListener("change", () => onToggleVisited(cb.dataset.id, cb.checked));
    });

    formEl.querySelectorAll(".city-edit-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        onDeleteCity(btn.dataset.id);
        render();
      });
    });
  }

  render();
}
