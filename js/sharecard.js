// Generates a shareable "Instagram Story" style stats image (1080x1920) on a
// <canvas>, entirely with drawn shapes/text — no hotlinked images — so the
// canvas never gets tainted and toBlob()/toDataURL() always work regardless
// of what CORS headers a flag/logo CDN happens to send.

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

// Every color here is already used somewhere in the app's own UI — orange for
// flight routes, teal for the home-base marker, green for visited countries —
// so the decorative shapes double as a callback to what they mean on the map.
const PALETTE = {
  bgDeep: "#14150f",
  bgVignette: "#0b0c08",
  ink: "#f3f1ea",
  muted: "#9a988d",
  accent: "#e07b48",
  teal: "#7ab3d1",
  green: "#81c784",
};

const FONT = "-apple-system, 'Segoe UI', Roboto, sans-serif";
const HEADER_FONT = "'Poppins', -apple-system, 'Segoe UI', Roboto, sans-serif";
const LEFT_MARGIN = 96;
const STAT_MAX_WIDTH = 620;

// Poppins is loaded via a Google Fonts <link> in index.html; kick off (and
// cache) the load here so the header can request it directly instead of
// silently falling back to the system font on the first draw.
let headerFontReady = null;
export function ensureHeaderFont() {
  if (!headerFontReady) {
    headerFontReady = document.fonts
      ? document.fonts.load(`800 66px ${HEADER_FONT}`).catch(() => {})
      : Promise.resolve();
  }
  return headerFontReady;
}

function drawBackground(ctx) {
  const gradient = ctx.createRadialGradient(
    STORY_WIDTH * 0.5,
    STORY_HEIGHT * 0.4,
    80,
    STORY_WIDTH * 0.5,
    STORY_HEIGHT * 0.4,
    1300
  );
  gradient.addColorStop(0, PALETTE.bgDeep);
  gradient.addColorStop(1, PALETTE.bgVignette);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
}

/** A cluster of colored concentric rings bleeding off the top-right corner —
 * the same "passport stamp" ring motif as the Countries page, in the app's
 * three theme colors instead of one flat tint. */
function drawRingCluster(ctx, cx, cy) {
  const rings = [
    { r: 520, color: PALETTE.accent, alpha: 0.16 },
    { r: 410, color: PALETTE.green, alpha: 0.18 },
    { r: 300, color: PALETTE.teal, alpha: 0.2 },
    { r: 195, color: PALETTE.accent, alpha: 0.26 },
  ];
  ctx.save();
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = ring.alpha;
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.restore();
}

/** A bold flight-path squiggle with small "airport" dots, crossing the right
 * side of the frame — an energetic echo of the routes on the actual map. */
function drawFlightSquiggle(ctx) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 7;

  ctx.strokeStyle = PALETTE.accent;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(660, 470);
  ctx.bezierCurveTo(860, 380, 940, 560, 850, 660);
  ctx.bezierCurveTo(760, 760, 900, 820, 1010, 720);
  ctx.stroke();

  const dots = [
    { x: 660, y: 470, color: PALETTE.teal },
    { x: 850, y: 660, color: PALETTE.green },
    { x: 1010, y: 720, color: PALETTE.accent },
  ];
  for (const dot of dots) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = dot.color;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.bgDeep;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A simple paper-plane silhouette, drawn as a path (no image asset needed). */
function drawPlaneIcon(ctx, cx, cy, size, rotation, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.15, size * 0.35);
  ctx.lineTo(-size * 0.1, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeader(ctx, title) {
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 66px ${HEADER_FONT}`;
  ctx.fillText(title, LEFT_MARGIN, 210);
}

function drawFooter(ctx) {
  const cy = STORY_HEIGHT - 110;

  ctx.beginPath();
  ctx.fillStyle = PALETTE.accent;
  ctx.arc(LEFT_MARGIN + 28, cy, 28, 0, Math.PI * 2);
  ctx.fill();
  drawPlaneIcon(ctx, LEFT_MARGIN + 28, cy, 15, -0.4, PALETTE.bgDeep);

  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText("My Travel Map", LEFT_MARGIN + 72, cy);

  ctx.fillStyle = PALETTE.accent;
  ctx.textAlign = "right";
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText("#MYTRAVELMAP", STORY_WIDTH - LEFT_MARGIN, cy);
}

/** Shrinks the font until `text` fits within maxWidth, so a long value (a big
 * km figure, a long airline name) can never overflow its slot. */
function fitFontSize(ctx, text, maxWidth, maxSize, minSize, weight = 800) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

/** The big left-aligned stacked stat list — value huge and bold (auto-shrunk
 * to fit), label small/muted/uppercase beneath. Returns the y position after
 * the last entry, so captions can follow it. */
function drawStatList(ctx, entries, startY, rowGap) {
  let y = startY;
  for (const { value, label } of entries) {
    const size = fitFontSize(ctx, value, STAT_MAX_WIDTH, 148, 64);
    ctx.fillStyle = PALETTE.accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillText(value, LEFT_MARGIN, y);

    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText(label.toUpperCase(), LEFT_MARGIN, y + 44);

    y += rowGap;
  }
  return y;
}

function drawCaption(ctx, y, text) {
  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = fitFontSize(ctx, text, STORY_WIDTH - LEFT_MARGIN * 2, 32, 20, 500);
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillText(text, LEFT_MARGIN, y);
}

const VARIANT_TITLES = {
  highlights: "My Travels",
  flights: "My Flights",
  countries: "My Countries",
};

/**
 * Draws one of three variants onto the given canvas 2D context:
 * - "flights": flights taken, distance, time in the air, plus fun comparison
 *   and top airline as smaller captions
 * - "countries": countries + cities visited, home base as a caption
 * - "highlights": the four headline numbers from both, stacked together
 */
export function drawShareCard(ctx, variant, stats) {
  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  drawBackground(ctx);
  drawRingCluster(ctx, STORY_WIDTH * 0.88, STORY_HEIGHT * 0.19);
  drawFlightSquiggle(ctx);
  drawPlaneIcon(ctx, STORY_WIDTH * 0.86, STORY_HEIGHT * 0.315, 46, -0.55, PALETTE.accent);
  drawHeader(ctx, VARIANT_TITLES[variant] || VARIANT_TITLES.highlights);

  let entries;
  let startY;
  let rowGap;
  const captions = [];

  if (variant === "countries") {
    entries = [
      { value: String(stats.countryCount), label: stats.countryCount === 1 ? "Country visited" : "Countries visited" },
      { value: String(stats.cityCount), label: stats.cityCount === 1 ? "City explored" : "Cities explored" },
    ];
    startY = 980;
    rowGap = 230;
    if (stats.homeBaseName) captions.push(`Home base: ${stats.homeBaseName}`);
  } else if (variant === "flights") {
    entries = [
      { value: String(stats.flightCount), label: stats.flightCount === 1 ? "Flight taken" : "Flights taken" },
      { value: stats.distanceText, label: "Distance flown" },
      { value: stats.durationText, label: "Time in the air" },
    ];
    startY = 820;
    rowGap = 210;
    if (stats.comparisonText) captions.push(stats.comparisonText);
    if (stats.topAirlineName) captions.push(`Flying most with ${stats.topAirlineName}`);
  } else {
    entries = [
      { value: String(stats.countryCount), label: stats.countryCount === 1 ? "Country" : "Countries" },
      { value: String(stats.cityCount), label: stats.cityCount === 1 ? "City" : "Cities" },
      { value: String(stats.flightCount), label: stats.flightCount === 1 ? "Flight" : "Flights" },
      { value: stats.distanceText, label: "Flown" },
    ];
    startY = 760;
    rowGap = 195;
  }

  const afterY = drawStatList(ctx, entries, startY, rowGap);
  let capY = afterY + 8;
  for (const caption of captions) {
    drawCaption(ctx, capY, caption);
    capY += 46;
  }

  drawFooter(ctx);
}

/** Shares a PNG blob via the Web Share API if available (and it accepts files),
 * otherwise falls back to triggering a plain download. */
export async function shareOrDownloadImage(blob, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My Travel Map" });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      // fall through to download on any other share failure
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "downloaded";
}
