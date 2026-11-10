/**
 * Minimal inline icon set (stroke-based, currentColor) so the app has no
 * external icon-font/CDN dependency and keeps working fully offline.
 */
function svg(inner, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const icons = {
  close: (size) => svg(`<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`, size),

  calendar: (size) =>
    svg(
      `<rect x="3.5" y="5" width="17" height="15" rx="2"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>`,
      size
    ),

  plane: (size) =>
    svg(
      `<path d="M3 13.5 20 6l-5.5 15-2.7-6.3L5 12.7z"/><path d="M11.8 14.7 8 18v-3.3"/>`,
      size
    ),

  pencil: (size) =>
    svg(
      `<path d="M4 20l1-4.2L15.8 5 19 8.2 8.2 19z"/><line x1="13.7" y1="7.1" x2="16.9" y2="10.3"/>`,
      size
    ),

  trash: (size) =>
    svg(
      `<path d="M5 7h14"/><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M6.5 7 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/><line x1="10.2" y1="10.5" x2="10.2" y2="16.5"/><line x1="13.8" y1="10.5" x2="13.8" y2="16.5"/>`,
      size
    ),

  plus: (size) => svg(`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, size),

  search: (size) => svg(`<circle cx="10.5" cy="10.5" r="6.5"/><line x1="20" y1="20" x2="15.3" y2="15.3"/>`, size),

  pin: (size) =>
    svg(
      `<circle cx="12" cy="10.5" r="3.2"/><path d="M12 21c4-4.4 7-8.1 7-11.2A7 7 0 0 0 5 9.8C5 12.9 8 16.6 12 21Z"/>`,
      size
    ),

  map: (size) =>
    svg(
      `<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>`,
      size
    ),

  globe: (size) =>
    svg(
      `<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/>`,
      size
    ),

  home: (size) =>
    svg(
      `<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><path d="M10 20v-5.5h4V20"/>`,
      size
    ),

  clock: (size) => svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>`, size),

  filter: (size) => svg(`<path d="M4 5h16l-6 7.5V19l-4 2v-8.5Z"/>`, size),

  sliders: (size) =>
    svg(
      `<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="1.8"/>` +
        `<line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="1.8"/>` +
        `<line x1="4" y1="17" x2="20" y2="17"/><circle cx="11" cy="17" r="1.8"/>`,
      size
    ),

  download: (size) =>
    svg(`<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19h14"/>`, size),

  upload: (size) =>
    svg(`<path d="M12 19V8"/><path d="M7.5 12.5 12 8l4.5 4.5"/><path d="M5 19h14"/>`, size),

  refresh: (size) =>
    svg(
      `<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5L19 8"/><path d="M19 4v4h-4"/><path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5L5 15.5"/><path d="M5 20v-4h4"/>`,
      size
    ),

  sun: (size) =>
    svg(
      `<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="4.9" y1="4.9" x2="6.6" y2="6.6"/><line x1="17.4" y1="17.4" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="6.6" y2="17.4"/><line x1="17.4" y1="6.6" x2="19.1" y2="4.9"/>`,
      size
    ),

  moon: (size) => svg(`<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z"/>`, size),

  flame: (size) =>
    svg(
      `<path d="M12 3c.8 3.4 5 5.4 5 10a5 5 0 0 1-10 0c0-2 1-3.3 2-4.3.2 1.3.8 2.1 1.8 2.5C10.2 8.7 10.6 5.6 12 3Z"/>`,
      size
    ),

  chevron: (size) => svg(`<path d="M9 5.5 15.5 12 9 18.5"/>`, size),
};
