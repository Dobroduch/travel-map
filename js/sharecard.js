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

// Reserved area for a user-added photo, left empty (or filled with a cover-fit
// crop of their chosen image) beneath a compacted stat block.
const PHOTO_RECT = { x: LEFT_MARGIN, y: 860, width: STORY_WIDTH - LEFT_MARGIN * 2, height: 880, radius: 28 };

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

function drawHeader(ctx, title, compact = false) {
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${compact ? 54 : 66}px ${HEADER_FONT}`;
  ctx.fillText(title, LEFT_MARGIN, compact ? 170 : 210);
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The reserved photo slot: a dashed placeholder with a hint label when no
 * photo has been chosen yet, or the user's own image cover-fit and cropped
 * to the rounded rect once one is loaded. */
function drawPhotoArea(ctx, photoImage) {
  const { x, y, width, height, radius } = PHOTO_RECT;

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.clip();
  if (photoImage) {
    const scale = Math.max(width / photoImage.width, height / photoImage.height);
    const drawW = photoImage.width * scale;
    const drawH = photoImage.height * scale;
    ctx.drawImage(photoImage, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
  } else {
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.fillRect(x, y, width, height);
  }
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.lineWidth = 3;
  if (photoImage) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  } else {
    ctx.strokeStyle = PALETTE.muted;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([14, 12]);
  }
  ctx.stroke();
  ctx.restore();

  if (!photoImage) {
    ctx.fillStyle = PALETTE.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText("Add your photo here", x + width / 2, y + height / 2);
  }
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
    size -= 2;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

/** The big left-aligned stacked stat list — value huge and bold (auto-shrunk
 * to fit), label small/muted/uppercase beneath. Returns the y position after
 * the last entry, so captions can follow it. `compact` shrinks the whole list
 * (smaller max sizes, tighter label gap) to leave room for a photo below it. */
function drawStatList(ctx, entries, startY, rowGap, compact = false) {
  const labelMaxWidth = STORY_WIDTH - LEFT_MARGIN * 2;
  const valueMaxSize = compact ? 100 : 148;
  const labelGap = compact ? 34 : 44;
  const labelMaxSize = compact ? 26 : 32;
  const labelMinSize = compact ? 15 : 18;
  let y = startY;
  for (const { value, label } of entries) {
    // 32px floor (not the usual short-number range) so a long country or place
    // name — "United States of America", "British Indian Ocean Territory" —
    // still shrinks enough to fit rather than overflowing the box.
    const size = fitFontSize(ctx, value, STAT_MAX_WIDTH, valueMaxSize, 32);
    ctx.fillStyle = PALETTE.accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillText(value, LEFT_MARGIN, y);

    const upperLabel = label.toUpperCase();
    const labelSize = fitFontSize(ctx, upperLabel, labelMaxWidth, labelMaxSize, labelMinSize, 600);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 ${labelSize}px ${FONT}`;
    ctx.fillText(upperLabel, LEFT_MARGIN, y + labelGap);

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

const VARIANT_YEAR_SUFFIX = {
  highlights: "",
  flights: " Flights",
  countries: " Countries",
};

/** "My Travels" normally, or "My 2026" / "My 2026 Flights" / "My 2026 Countries"
 * when a share card is scoped to one year. */
function buildTitle(variant, year) {
  if (!year) return VARIANT_TITLES[variant] || VARIANT_TITLES.highlights;
  return `My ${year}${VARIANT_YEAR_SUFFIX[variant] ?? ""}`;
}

/**
 * Draws one of three variants onto the given canvas 2D context:
 * - "flights": flights taken, distance, time in the air, plus fun comparison
 *   and top airline as smaller captions
 * - "countries": countries + cities visited, home base as a caption
 * - "highlights": the four headline numbers from both, stacked together
 *
 * `options.withPhoto` compacts the stat block and reserves a rounded rect
 * below it — filled with `options.photoImage` if one's been chosen, else a
 * dashed placeholder — for the user to drop their own photo into. The
 * decorative ring/squiggle motif is skipped in that mode so it doesn't
 * compete with the photo for attention.
 */
export function drawShareCard(ctx, variant, stats, options = {}) {
  const { withPhoto = false, photoImage = null } = options;

  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  drawBackground(ctx);
  if (!withPhoto) {
    drawRingCluster(ctx, STORY_WIDTH * 0.88, STORY_HEIGHT * 0.19);
    drawFlightSquiggle(ctx);
    drawPlaneIcon(ctx, STORY_WIDTH * 0.86, STORY_HEIGHT * 0.315, 46, -0.55, PALETTE.accent);
  }
  drawHeader(ctx, buildTitle(variant, stats.year), withPhoto);

  let entries;
  let startY;
  let rowGap;
  const captions = [];

  if (variant === "countries") {
    entries = [
      { value: String(stats.countryCount), label: stats.countryCount === 1 ? "Country visited" : "Countries visited" },
      { value: String(stats.cityCount), label: stats.cityCount === 1 ? "City explored" : "Cities explored" },
    ];
    if (stats.mostVisitedCountryName) {
      entries.push({ value: stats.mostVisitedCountryName, label: "Most visited country" });
    }
    if (stats.furthestDistanceText) {
      entries.push({ value: stats.furthestDistanceText, label: `Furthest — ${stats.furthestPlaceName}` });
    }
    if (withPhoto) {
      startY = entries.length > 2 ? 260 : 420;
      rowGap = entries.length > 2 ? 140 : 170;
    } else {
      startY = entries.length > 2 ? 760 : 980;
      rowGap = entries.length > 2 ? 195 : 230;
    }
    if (stats.homeBaseName) captions.push(`Home base: ${stats.homeBaseName}`);
  } else if (variant === "flights") {
    entries = [
      { value: String(stats.flightCount), label: stats.flightCount === 1 ? "Flight taken" : "Flights taken" },
      { value: stats.distanceText, label: "Distance flown" },
      { value: stats.durationText, label: "Time in the air" },
    ];
    startY = withPhoto ? 260 : 820;
    rowGap = withPhoto ? 140 : 210;
    if (stats.comparisonText) captions.push(stats.comparisonText);
    if (stats.topAirlineName) captions.push(`Flying most with ${stats.topAirlineName}`);
  } else {
    entries = [
      { value: String(stats.countryCount), label: stats.countryCount === 1 ? "Country" : "Countries" },
      { value: String(stats.cityCount), label: stats.cityCount === 1 ? "City" : "Cities" },
      { value: String(stats.flightCount), label: stats.flightCount === 1 ? "Flight" : "Flights" },
      { value: stats.distanceText, label: "Flown" },
    ];
    startY = withPhoto ? 260 : 760;
    rowGap = withPhoto ? 140 : 195;
  }

  const afterY = drawStatList(ctx, entries, startY, rowGap, withPhoto);
  let capY = afterY + (withPhoto ? 6 : 8);
  for (const caption of captions) {
    drawCaption(ctx, capY, caption);
    capY += withPhoto ? 34 : 46;
  }

  if (withPhoto) drawPhotoArea(ctx, photoImage);

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
