// Draws a continent "visit heatmap" story card: every country of the chosen
// continent is shaded by how many trips were taken there (cool → hot), with
// the home country in its own color so it doesn't flatten the scale.

import { continentOf } from "./continents.js";
import {
  STORY_WIDTH,
  STORY_HEIGHT,
  PALETTE,
  FONT,
  LEFT_MARGIN,
  drawBackground,
  drawHeader,
  drawFooter,
  fitFontSize,
  roundedRectPath,
} from "./sharecard.js";

const MAP_RECT = { x: 60, y: 330, width: STORY_WIDTH - 120, height: 900 };

// Low → high trip counts: muted green, amber, hot orange-red.
const RAMP = [
  [0, [88, 124, 84]],
  [0.5, [226, 178, 70]],
  [1, [232, 92, 56]],
];

function rampColor(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (x - t0) / (t1 - t0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return `rgb(${RAMP[RAMP.length - 1][1].join(", ")})`;
}

function heatT(visits, maxVisits) {
  if (maxVisits <= 1) return 0.55;
  return Math.sqrt((visits - 1) / (maxVisits - 1)) * 0.9 + 0.1;
}

function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * @param continent {key, name, bounds}
 * @param stats {visits: Map<iso3, number>, homeCodes: Set<iso3>, names: Map<iso3, string>, year}
 */
export function drawContinentHeatmap(ctx, geojson, continent, stats) {
  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  drawBackground(ctx);
  drawHeader(ctx, `My ${continent.name}`);

  const entries = [...stats.visits.entries()].filter(([code]) => !stats.homeCodes.has(code));
  const maxVisits = Math.max(1, ...entries.map(([, v]) => v));
  const unit = stats.unit || "trip";
  const unitLabel = (n) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const countryCount = stats.visits.size;
  const totalVisits = stats.total ?? [...stats.visits.values()].reduce((a, b) => a + b, 0);

  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 34px ${FONT}`;
  const subtitle = [
    stats.year ? String(stats.year) : null,
    `${countryCount} ${countryCount === 1 ? "country" : "countries"}`,
    unitLabel(totalVisits),
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillText(subtitle, LEFT_MARGIN, 262);

  // --- map ---
  const [west, south, east, north] = continent.bounds;
  const cosMid = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = Math.min(MAP_RECT.width / ((east - west) * cosMid), MAP_RECT.height / (north - south));
  const drawW = (east - west) * cosMid * scale;
  const drawH = (north - south) * scale;
  const ox = MAP_RECT.x + (MAP_RECT.width - drawW) / 2;
  const oy = MAP_RECT.y + (MAP_RECT.height - drawH) / 2;
  const px = (lon) => ox + (lon - west) * cosMid * scale;
  const py = (lat) => oy + (north - lat) * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, drawW, drawH);
  ctx.clip();

  const labels = [];
  for (const feature of geojson.features) {
    if (!feature.geometry || feature.id === "ATA") continue;
    const code = feature.id;
    const inContinent = continentOf(code) === continent.key;
    const isHome = stats.homeCodes.has(code);
    const visits = stats.visits.get(code) || 0;

    let fill;
    let stroke;
    if (!inContinent) {
      fill = "rgba(255, 255, 255, 0.04)";
      stroke = "rgba(255, 255, 255, 0.05)";
    } else if (isHome) {
      fill = PALETTE.teal;
      stroke = PALETTE.bgDeep;
    } else if (visits) {
      fill = rampColor(heatT(visits, maxVisits));
      stroke = PALETTE.bgDeep;
    } else {
      fill = "rgba(255, 255, 255, 0.09)";
      stroke = "rgba(20, 21, 15, 0.9)";
    }

    ctx.beginPath();
    let best = null;
    for (const poly of polygonsOf(feature.geometry)) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const x = px(lon);
          const y = py(lat);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          if (ring === poly[0]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        });
        ctx.closePath();
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const area = (maxX - minX) * (maxY - minY);
      if (cx > ox && cx < ox + drawW && cy > oy && cy < oy + drawH && (!best || area > best.area)) {
        best = { cx, cy, w: maxX - minX, area };
      }
    }
    ctx.fillStyle = fill;
    ctx.fill("evenodd");
    ctx.lineWidth = inContinent ? 2 : 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();

    if (inContinent && !isHome && visits && best && best.w > 44) labels.push({ ...best, text: String(visits), isHome });
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 30px ${FONT}`;
  for (const l of labels) {
    ctx.fillStyle = PALETTE.bgDeep;
    ctx.fillText(l.text, l.cx, l.cy);
  }
  ctx.restore();

  // --- legend ---
  const legendY = 1300;
  const legendW = 520;
  const grad = ctx.createLinearGradient(LEFT_MARGIN, 0, LEFT_MARGIN + legendW, 0);
  for (const [t, c] of RAMP) grad.addColorStop(t, `rgb(${c.join(",")})`);
  ctx.fillStyle = grad;
  roundedRectPath(ctx, LEFT_MARGIN, legendY, legendW, 22, 11);
  ctx.fill();

  ctx.fillStyle = PALETTE.muted;
  ctx.font = `600 26px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(unitLabel(1), LEFT_MARGIN, legendY + 62);
  ctx.textAlign = "right";
  ctx.fillText(unitLabel(maxVisits), LEFT_MARGIN + legendW, legendY + 62);

  if (stats.homeCodes.size) {
    ctx.fillStyle = PALETTE.teal;
    ctx.beginPath();
    ctx.arc(LEFT_MARGIN + legendW + 70, legendY + 11, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.muted;
    ctx.textAlign = "left";
    ctx.fillText("Home", LEFT_MARGIN + legendW + 92, legendY + 20);
  }

  // --- top countries ---
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 5);
  let y = 1450;
  const barMax = STORY_WIDTH - LEFT_MARGIN * 2 - 380;
  for (const [code, visits] of top) {
    const name = stats.names.get(code) || code;
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const size = fitFontSize(ctx, name, 330, 34, 20, 700);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(name, LEFT_MARGIN, y);

    const w = Math.max(14, (visits / maxVisits) * barMax);
    ctx.fillStyle = rampColor(heatT(visits, maxVisits));
    roundedRectPath(ctx, LEFT_MARGIN + 360, y - 14, w, 28, 14);
    ctx.fill();

    ctx.fillStyle = PALETTE.muted;
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(String(visits), LEFT_MARGIN + 360 + w + 14, y);
    y += 62;
  }
  if (!top.length) {
    ctx.fillStyle = PALETTE.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(`No ${continent.name} ${unit}s logged yet`, LEFT_MARGIN, y);
  }

  drawFooter(ctx);
}
