import { resolveCoords } from "./flightstats.js";

function buildBasemapStyle(dark) {
  const variant = dark ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`,
          `https://b.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`,
          `https://c.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`,
          `https://d.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png`,
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

const THEME = {
  light: {
    fillLow: "#c5e1a5",
    fillMid: "#43a047",
    fillHigh: "#1b5e20",
    outline: "#2e7d32",
    accent: "#c9622a",
    homeBase: "#2f4858",
  },
  dark: {
    fillLow: "#3d5c3d",
    fillMid: "#4caf50",
    fillHigh: "#81c784",
    outline: "#66bb6a",
    accent: "#e07b48",
    homeBase: "#7ab3d1",
  },
};

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function lngLatToVector([lng, lat]) {
  const φ = toRad(lat);
  const λ = toRad(lng);
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function vectorToLngLat([x, y, z]) {
  return [toDeg(Math.atan2(y, x)), toDeg(Math.asin(Math.max(-1, Math.min(1, z))))];
}

/** Spherical linear interpolation between two unit vectors, `angle` apart, at t in [0, 1]. */
function slerp(a, b, t, angle) {
  const sinAngle = Math.sin(angle);
  const ta = Math.sin((1 - t) * angle) / sinAngle;
  const tb = Math.sin(t * angle) / sinAngle;
  return [ta * a[0] + tb * b[0], ta * a[1] + tb * b[1], ta * a[2] + tb * b[2]];
}

/**
 * True great-circle path between two [lng, lat] points — the shortest route on a
 * sphere, which is what real flight paths approximate (as drawn by tools like
 * Great Circle Mapper or FlightAware), rather than an arbitrary flat-plane bulge.
 */
function buildArc(start, end, segments = 64) {
  const a = lngLatToVector(start);
  const b = lngLatToVector(end);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);

  if (angle < 1e-6) return [start, end];

  const raw = [];
  for (let i = 0; i <= segments; i++) {
    raw.push(vectorToLngLat(slerp(a, b, i / segments, angle)));
  }

  // Unwrap longitude so the polyline doesn't jump across the whole map when a
  // route crosses the antimeridian — each point continues from its predecessor
  // rather than snapping back into [-180, 180].
  const coords = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    let [lng, lat] = raw[i];
    const prevLng = coords[i - 1][0];
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    coords.push([lng, lat]);
  }
  return coords;
}

/** Buckets a city into one of 4 dot-size tiers by population; unknown population reads as the smallest tier. */
function cityTier(population) {
  if (!population) return 1;
  if (population >= 1000000) return 4;
  if (population >= 150000) return 3;
  if (population >= 20000) return 2;
  return 1;
}

function citiesToGeoJson(cities, homeBaseCodes) {
  return {
    type: "FeatureCollection",
    features: cities
      .filter((c) => c.visited !== false)
      .map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        properties: {
          id: c.id,
          name: c.name,
          country: c.country,
          homeBase: homeBaseCodes.has(c.countryCode),
          sizeTier: cityTier(c.population),
        },
      })),
  };
}

function connectionsToGeoJson(connections, citiesById, airportsByCode) {
  return {
    type: "FeatureCollection",
    features: connections
      .map((conn, index) => {
        const from = resolveCoords(conn.from, conn.departureAirport, citiesById, airportsByCode);
        const to = resolveCoords(conn.to, conn.arrivalAirport, citiesById, airportsByCode);
        if (!from || !to) return null;
        const via = conn.type === "layover" && conn.layoverAirport ? resolveCoords(null, conn.layoverAirport, citiesById, airportsByCode) : null;
        const coordinates = via
          ? [...buildArc([from.lng, from.lat], [via.lng, via.lat]), ...buildArc([via.lng, via.lat], [to.lng, to.lat]).slice(1)]
          : buildArc([from.lng, from.lat], [to.lng, to.lat]);
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: { index, from: conn.from, to: conn.to },
        };
      })
      .filter(Boolean),
  };
}

/** A small dot at each flight's actual airport coordinates (deduped by location), shown alongside the route lines. */
function connectionAirportPointsGeoJson(connections, citiesById, airportsByCode) {
  const seen = new Map();
  for (const conn of connections) {
    const legs = [
      [conn.from, conn.departureAirport],
      [conn.to, conn.arrivalAirport],
    ];
    if (conn.type === "layover" && conn.layoverAirport) legs.push([null, conn.layoverAirport]);
    for (const [cityId, code] of legs) {
      if (!code) continue;
      const coords = resolveCoords(cityId, code, citiesById, airportsByCode);
      if (!coords) continue;
      const key = `${coords.lng.toFixed(4)},${coords.lat.toFixed(4)}`;
      if (!seen.has(key)) seen.set(key, coords);
    }
  }
  return {
    type: "FeatureCollection",
    features: [...seen.values()].map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: {},
    })),
  };
}

function countCitiesByCountry(cities) {
  const counts = new Map();
  for (const c of cities) {
    if (c.visited === false) continue;
    counts.set(c.countryCode, (counts.get(c.countryCode) || 0) + 1);
  }
  return counts;
}

function markVisited(countriesGeojson, visitedCountries, cities, homeBaseCodes) {
  const visitedSet = new Set(visitedCountries);
  const cityCounts = countCitiesByCountry(cities);
  return {
    ...countriesGeojson,
    features: countriesGeojson.features.map((f) => ({
      ...f,
      // MapLibre can't reliably promote string GeoJSON feature ids (like "SVK")
      // onto rendered features without `promoteId`, so carry the code as a
      // regular property instead — same pattern already used for cities.
      properties: {
        ...f.properties,
        code: f.id,
        visited: visitedSet.has(f.id),
        homeBase: homeBaseCodes.has(f.id),
        cityCount: cityCounts.get(f.id) || 0,
      },
    })),
  };
}

export function createMap({
  container,
  data,
  countriesGeojson,
  citiesById,
  airportsByCode = new Map(),
  dark = false,
  onCitySelect,
  onCountrySelect,
  onFlightSelect,
}) {
  const theme = dark ? THEME.dark : THEME.light;

  const map = new maplibregl.Map({
    container,
    style: buildBasemapStyle(dark),
    center: [15, 30],
    zoom: 1.6,
    minZoom: 1.2,
    maxZoom: 12,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });

  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.scrollZoom.setWheelZoomRate(1 / 300);

  // MapLibre sizes its canvas to the container at construction time; if the
  // container hasn't been laid out yet (e.g. stylesheet still applying),
  // it falls back to 400x300. Keep the canvas in sync as layout settles/resizes.
  const containerEl = typeof container === "string" ? document.getElementById(container) : container;
  if ("ResizeObserver" in window && containerEl) {
    new ResizeObserver(() => map.resize()).observe(containerEl);
  }

  let pickModeActive = false;
  let pickResolver = null;
  let routesVisible = true;
  let homeCitiesVisible = true;
  let allCitiesVisible = true;

  map.on("load", () => {
    map.addSource("countries", {
      type: "geojson",
      data: markVisited(countriesGeojson, data.visitedCountries, data.cities, new Set(data.homeBaseCountries || [])),
    });

    map.addLayer({
      id: "countries-fill",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": [
          "case",
          ["get", "homeBase"],
          theme.homeBase,
          ["interpolate", ["linear"], ["get", "cityCount"], 0, theme.fillLow, 3, theme.fillMid, 6, theme.fillHigh],
        ],
        "fill-opacity": [
          "case",
          ["get", "homeBase"],
          0.45,
          ["get", "visited"],
          ["interpolate", ["linear"], ["get", "cityCount"], 0, 0.18, 6, 0.38],
          0,
        ],
      },
    });

    map.addLayer({
      id: "countries-outline",
      type: "line",
      source: "countries",
      paint: {
        "line-color": theme.outline,
        "line-width": 1,
        "line-opacity": ["case", ["any", ["get", "visited"], ["get", "homeBase"]], 0.75, 0],
      },
    });

    map.addSource("routes", {
      type: "geojson",
      data: connectionsToGeoJson(data.connections, citiesById, airportsByCode),
    });

    map.addLayer({
      id: "routes-line",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": theme.accent,
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 8, 2.2],
        "line-opacity": 0.55,
      },
    });

    // wider, invisible line used only to make the thin route easier to click/tap
    map.addLayer({
      id: "routes-hit",
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": 16,
        "line-opacity": 0,
      },
    });

    map.addSource("route-airports", {
      type: "geojson",
      data: connectionAirportPointsGeoJson(data.connections, citiesById, airportsByCode),
    });

    map.addLayer({
      id: "route-airport-dots",
      type: "circle",
      source: "route-airports",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 8, 3],
        "circle-color": theme.accent,
        "circle-opacity": 0.85,
      },
    });

    map.addSource("cities", {
      type: "geojson",
      data: citiesToGeoJson(data.cities, new Set(data.homeBaseCountries || [])),
    });

    map.addLayer({
      id: "cities-halo",
      type: "circle",
      source: "cities",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1, ["step", ["get", "sizeTier"], 3, 2, 4.5, 3, 6.5, 4, 8.5],
          8, ["step", ["get", "sizeTier"], 6, 2, 9, 3, 12.5, 4, 16.5],
        ],
        "circle-color": ["case", ["get", "homeBase"], theme.homeBase, theme.accent],
        "circle-opacity": 0.18,
      },
    });

    map.addLayer({
      id: "cities-circle",
      type: "circle",
      source: "cities",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1, ["step", ["get", "sizeTier"], 1.8, 2, 2.8, 3, 4, 4, 5.2],
          8, ["step", ["get", "sizeTier"], 3, 2, 4.5, 3, 6.5, 4, 9],
        ],
        "circle-color": ["case", ["get", "homeBase"], theme.homeBase, theme.accent],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    });

    const clickableLayers = ["cities-circle", "routes-hit", "countries-fill"];

    map.on("click", (e) => {
      if (pickModeActive) {
        pickModeActive = false;
        map.getCanvas().style.cursor = "";
        const resolve = pickResolver;
        pickResolver = null;
        if (resolve) resolve({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }

      const features = map.queryRenderedFeatures(e.point, { layers: clickableLayers });
      if (!features.length) return;
      const top = features[0];
      if (top.layer.id === "cities-circle") {
        onCitySelect(top.properties);
      } else if (top.layer.id === "routes-hit") {
        onFlightSelect(top.properties);
      } else if (top.layer.id === "countries-fill" && top.properties.visited) {
        onCountrySelect(top.properties);
      }
    });

    map.on("mousemove", (e) => {
      if (pickModeActive) return;
      const features = map.queryRenderedFeatures(e.point, { layers: clickableLayers });
      const hit =
        features.find((f) => f.layer.id === "cities-circle") ||
        features.find((f) => f.layer.id === "routes-hit") ||
        features.find((f) => f.layer.id === "countries-fill" && f.properties.visited);
      map.getCanvas().style.cursor = hit ? "pointer" : "";
    });

    const bounds = new maplibregl.LngLatBounds();
    data.cities.forEach((c) => bounds.extend([c.lng, c.lat]));
    map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 4 });
  });

  let currentCitiesById = citiesById;

  function updateData(newData, newCitiesById) {
    if (!map.getSource("cities")) return;
    currentCitiesById = newCitiesById;
    const homeBaseCodes = new Set(newData.homeBaseCountries || []);
    map.getSource("countries").setData(markVisited(countriesGeojson, newData.visitedCountries, newData.cities, homeBaseCodes));
    map.getSource("routes").setData(connectionsToGeoJson(newData.connections, newCitiesById, airportsByCode));
    map.getSource("route-airports").setData(connectionAirportPointsGeoJson(newData.connections, newCitiesById, airportsByCode));
    map.getSource("cities").setData(citiesToGeoJson(newData.cities, homeBaseCodes));
  }

  /** Redraws only the routes source from a caller-filtered subset of connections (e.g. by year/airline). */
  function setVisibleConnections(connections) {
    if (!map.getSource("routes")) return;
    map.getSource("routes").setData(connectionsToGeoJson(connections, currentCitiesById, airportsByCode));
    map.getSource("route-airports").setData(connectionAirportPointsGeoJson(connections, currentCitiesById, airportsByCode));
  }

  /** Resolves with {lng, lat} on the next map click; used for click-to-place-pin flows. */
  function pickLocation() {
    cancelPickLocation();
    return new Promise((resolve) => {
      pickModeActive = true;
      pickResolver = resolve;
      map.getCanvas().style.cursor = "crosshair";
    });
  }

  function cancelPickLocation() {
    if (!pickModeActive) return;
    pickModeActive = false;
    pickResolver = null;
    map.getCanvas().style.cursor = "";
  }

  function setRoutesVisible(visible) {
    routesVisible = visible;
    if (!map.getLayer("routes-line")) return;
    const value = visible ? "visible" : "none";
    map.setLayoutProperty("routes-line", "visibility", value);
    map.setLayoutProperty("routes-hit", "visibility", value);
    map.setLayoutProperty("route-airport-dots", "visibility", value);
  }

  function areRoutesVisible() {
    return routesVisible;
  }

  function setHomeCitiesVisible(visible) {
    homeCitiesVisible = visible;
    if (!map.getLayer("cities-circle")) return;
    const filter = visible ? null : ["!=", ["get", "homeBase"], true];
    map.setFilter("cities-halo", filter);
    map.setFilter("cities-circle", filter);
  }

  function areHomeCitiesVisible() {
    return homeCitiesVisible;
  }

  function setAllCitiesVisible(visible) {
    allCitiesVisible = visible;
    if (!map.getLayer("cities-circle")) return;
    const value = visible ? "visible" : "none";
    map.setLayoutProperty("cities-halo", "visibility", value);
    map.setLayoutProperty("cities-circle", "visibility", value);
  }

  function areAllCitiesVisible() {
    return allCitiesVisible;
  }

  return {
    map,
    updateData,
    setVisibleConnections,
    pickLocation,
    cancelPickLocation,
    setRoutesVisible,
    areRoutesVisible,
    setHomeCitiesVisible,
    areHomeCitiesVisible,
    setAllCitiesVisible,
    areAllCitiesVisible,
  };
}
