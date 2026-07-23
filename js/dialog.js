import { escapeHtml } from "./util.js";
import { icons } from "./icons.js";

let overlay, closeBtn, editBtn, deleteBtn, titleEl, iconEl, subtitleEl, bodyEl;

export function initDialog() {
  overlay = document.getElementById("dialog-overlay");
  closeBtn = document.getElementById("dialog-close");
  editBtn = document.getElementById("dialog-edit");
  deleteBtn = document.getElementById("dialog-delete");
  titleEl = document.getElementById("dialog-title");
  iconEl = document.getElementById("dialog-icon");
  subtitleEl = document.getElementById("dialog-subtitle");
  bodyEl = document.getElementById("dialog-body");

  closeBtn.innerHTML = `${icons.close(14)}<span>Close</span>`;
  editBtn.innerHTML = icons.pencil(16);
  deleteBtn.innerHTML = icons.trash(16);

  closeBtn.addEventListener("click", closeDialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDialog();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeDialog();
  });
}

export function openDialog({
  title,
  subtitle = "",
  iconUrl = null,
  iconAlt = "",
  dates = [],
  notes = "",
  details = [],
  connections = [],
  bodyHtml = null,
  onEdit = null,
  onDelete = null,
}) {
  titleEl.textContent = title;
  subtitleEl.textContent = subtitle;

  iconEl.onerror = null;
  if (iconUrl) {
    iconEl.src = iconUrl;
    iconEl.alt = iconAlt;
    iconEl.hidden = false;
    iconEl.onerror = () => {
      iconEl.hidden = true;
    };
  } else {
    iconEl.hidden = true;
    iconEl.removeAttribute("src");
  }

  editBtn.hidden = !onEdit;
  editBtn.onclick = onEdit ? () => onEdit() : null;

  deleteBtn.hidden = !onDelete;
  deleteBtn.onclick = onDelete ? () => onDelete() : null;

  if (bodyHtml !== null) {
    bodyEl.innerHTML = bodyHtml;
    overlay.hidden = false;
    return;
  }

  let html = "";

  if (dates.length) {
    html += `<div class="dialog-section"><h3>${icons.calendar(14)}<span>Visited</span></h3><div class="pill-row">${dates
      .map((d) => `<span class="date-pill">${escapeHtml(d)}</span>`)
      .join("")}</div></div>`;
  }

  if (notes) {
    html += `<div class="dialog-section"><h3>Notes</h3><p class="dialog-notes">${escapeHtml(notes)}</p></div>`;
  }

  if (details.length) {
    html += `<div class="dialog-section"><h3>${icons.plane(14)}<span>Flight details</span></h3>${details
      .map(
        (d) =>
          `<div class="connection-row"><span class="connection-route">${escapeHtml(
            d.label
          )}</span><span class="connection-meta">${escapeHtml(d.value)}</span></div>`
      )
      .join("")}</div>`;
  }

  if (connections.length) {
    html += `<div class="dialog-section"><h3>${icons.plane(14)}<span>Flight connections</span></h3>${connections
      .map(
        (c) =>
          `<div class="connection-row"><span class="connection-route">${escapeHtml(
            c.route
          )}</span><span class="connection-meta">${escapeHtml(c.meta)}</span></div>`
      )
      .join("")}</div>`;
  }

  bodyEl.innerHTML = html;
  overlay.hidden = false;
}

/**
 * A simple scrollable list inside the same dialog card, for overflow views
 * like "see all cities in a country". No edit/delete actions.
 */
export function openListDialog({ title, subtitle = "", rows, onRowClick }) {
  titleEl.textContent = title;
  subtitleEl.textContent = subtitle;
  iconEl.hidden = true;
  iconEl.removeAttribute("src");

  editBtn.hidden = true;
  editBtn.onclick = null;
  deleteBtn.hidden = true;
  deleteBtn.onclick = null;

  bodyEl.innerHTML = `<div class="entity-list">${rows
    .map(
      (r) =>
        `<button type="button" class="entity-row" data-id="${r.id}"><span class="entity-name">${escapeHtml(
          r.name
        )}</span><span class="entity-count">${r.meta || ""}</span></button>`
    )
    .join("")}</div>`;

  bodyEl.querySelectorAll(".entity-row").forEach((btn) => {
    btn.addEventListener("click", () => onRowClick(btn.dataset.id));
  });

  overlay.hidden = false;
}

export function closeDialog() {
  overlay.hidden = true;
}
