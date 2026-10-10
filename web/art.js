// Illustrations: flat, chunky, rounded, with a darker underside (in the spirit of Duolingo's art).
// Fixed colours so they read the same in light and dark mode. Decorative: always aria-hidden.
const C = {
  water: '#38BDF8', waterDeep: '#0EA5E9', waterDark: '#0284C7', waterLight: '#BAE6FD',
  teal: '#14B8A6', tealDark: '#0F766E', tealLight: '#CCFBF1',
  sun: '#FBBF24', sunDark: '#F59E0B',
  coral: '#FB7185', coralDark: '#E11D48', coralLight: '#FECDD3',
  clay: '#F59E6B', clayDark: '#EA7C45', clayRim: '#C2410C',
  leaf: '#4ADE80', leafDark: '#16A34A',
  grape: '#A78BFA', grapeDark: '#7C3AED',
  ink: '#1F2937', mist: '#E5E7EB', white: '#FFFFFF', skin: '#FDBA74',
};

const jar = (extra = '') => `
  <rect x="26" y="6" width="12" height="7" rx="2" fill="${C.waterDark}"/>
  <rect x="28" y="12" width="8" height="5" fill="${C.waterDeep}"/>
  <rect x="14" y="16" width="36" height="42" rx="10" fill="${C.waterLight}"/>
  <path d="M14 30h36v18a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10z" fill="${C.water}"/>
  <path d="M14 44h36v4a10 10 0 0 1-10 10H24a10 10 0 0 1-10-10z" fill="${C.waterDeep}"/>
  <rect x="19" y="20" width="5" height="22" rx="2.5" fill="${C.white}" opacity=".7"/>${extra}`;

const dropBody = `
  <path d="M32 5C24 17 13 28 13 40a19 19 0 0 0 38 0C51 28 40 17 32 5z" fill="${C.water}"/>
  <path d="M51 40a19 19 0 0 1-19 19c9-4 14-11 14-20 0-9-5-17-11-27 8 10 16 19 16 28z" fill="${C.waterDeep}"/>
  <ellipse cx="22" cy="28" rx="3" ry="5.5" fill="${C.white}" opacity=".6" transform="rotate(25 22 28)"/>`;

const ART = {
  // Mascot: a friendly water drop.
  drop: `${dropBody}
    <circle cx="25" cy="39" r="4.6" fill="${C.white}"/><circle cx="39" cy="39" r="4.6" fill="${C.white}"/>
    <circle cx="26" cy="40" r="2.3" fill="${C.ink}"/><circle cx="40" cy="40" r="2.3" fill="${C.ink}"/>
    <path d="M26 48q6 5 12 0" stroke="${C.ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <circle cx="20" cy="46" r="2.5" fill="${C.coral}" opacity=".55"/><circle cx="44" cy="46" r="2.5" fill="${C.coral}" opacity=".55"/>`,
  // Mascot resting (nothing to do).
  dropRest: `${dropBody}
    <path d="M21 40q4 3 8 0M35 40q4 3 8 0" stroke="${C.ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M28 48q4 2 8 0" stroke="${C.ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <text x="46" y="16" font-family="system-ui,sans-serif" font-weight="800" font-size="11" fill="${C.waterDark}">z</text>
    <text x="53" y="9" font-family="system-ui,sans-serif" font-weight="800" font-size="8" fill="${C.waterDark}">z</text>`,
  // Mascot cheering (all done).
  dropCheer: `${dropBody}
    <path d="M21 39q4-4 8 0M35 39q4-4 8 0" stroke="${C.ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M25 46q7 8 14 0z" fill="${C.ink}"/><path d="M28 49q4 3 8 0" fill="${C.coral}"/>
    <rect x="4" y="10" width="6" height="6" rx="1" fill="${C.sun}" transform="rotate(20 7 13)"/>
    <circle cx="57" cy="12" r="3" fill="${C.coral}"/><rect x="54" y="30" width="5" height="5" rx="1" fill="${C.leaf}" transform="rotate(-15 56 32)"/>`,
  jar: jar(),
  // Kulhad (clay cup): plastic-free and familiar.
  cup: `
    <path d="M14 18h36l-5 36a6 6 0 0 1-6 5H25a6 6 0 0 1-6-5z" fill="${C.clay}"/>
    <path d="M34 18h16l-5 36a6 6 0 0 1-6 5h-5z" fill="${C.clayDark}"/>
    <rect x="11" y="13" width="42" height="8" rx="4" fill="${C.clayRim}"/>
    <path d="M20 30h24" stroke="${C.white}" stroke-width="3" stroke-linecap="round" opacity=".45"/>`,
  people: `
    <circle cx="23" cy="22" r="9" fill="${C.skin}"/><path d="M8 55a15 15 0 0 1 30 0z" fill="${C.teal}"/>
    <path d="M30 55a15 15 0 0 0-7-12.7A15 15 0 0 1 38 55z" fill="${C.tealDark}"/>
    <circle cx="43" cy="24" r="8" fill="${C.sunDark}"/><path d="M30 55a13 13 0 0 1 26 0z" fill="${C.coral}"/>
    <path d="M50 55a13 13 0 0 0-5-10.3A13 13 0 0 1 56 55z" fill="${C.coralDark}"/>`,
  calendar: `
    <rect x="8" y="12" width="48" height="45" rx="9" fill="${C.white}"/>
    <rect x="8" y="51" width="48" height="6" rx="3" fill="${C.mist}"/>
    <path d="M8 21a9 9 0 0 1 9-9h30a9 9 0 0 1 9 9v6H8z" fill="${C.coral}"/>
    <rect x="18" y="6" width="6" height="12" rx="3" fill="${C.coralDark}"/><rect x="40" y="6" width="6" height="12" rx="3" fill="${C.coralDark}"/>
    <rect x="16" y="33" width="8" height="7" rx="2" fill="${C.coralLight}"/><rect x="28" y="33" width="8" height="7" rx="2" fill="${C.teal}"/>
    <rect x="40" y="33" width="8" height="7" rx="2" fill="${C.coralLight}"/><rect x="16" y="43" width="8" height="6" rx="2" fill="${C.coralLight}"/>
    <rect x="28" y="43" width="8" height="6" rx="2" fill="${C.coralLight}"/>`,
  sun: `
    <g stroke="${C.sunDark}" stroke-width="5" stroke-linecap="round"><path d="M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M52 12l-6 6M18 46l-6 6"/></g>
    <circle cx="32" cy="32" r="14" fill="${C.sun}"/><path d="M46 32a14 14 0 0 1-14 14 14 14 0 0 0 0-28 14 14 0 0 1 14 14z" fill="${C.sunDark}"/>`,
  // Water station: dispenser with a jar on top.
  station: `
    <path d="M24 4h16v4a8 8 0 0 1 4 7v13H20V15a8 8 0 0 1 4-7z" fill="${C.water}"/>
    <rect x="23" y="2" width="18" height="5" rx="2" fill="${C.waterDark}"/>
    <rect x="14" y="28" width="36" height="30" rx="7" fill="${C.teal}"/>
    <rect x="14" y="50" width="36" height="8" rx="4" fill="${C.tealDark}"/>
    <rect x="34" y="34" width="12" height="6" rx="3" fill="${C.mist}"/>
    <path d="M42 41v5" stroke="${C.water}" stroke-width="3" stroke-linecap="round"/>
    <rect x="19" y="34" width="10" height="10" rx="3" fill="${C.white}" opacity=".35"/>`,
  truck: `
    <rect x="4" y="16" width="34" height="28" rx="5" fill="${C.sun}"/>
    <rect x="4" y="38" width="34" height="6" rx="3" fill="${C.sunDark}"/>
    <path d="M38 24h12l9 11v9H38z" fill="${C.teal}"/><path d="M42 27h7l6 8H42z" fill="${C.tealLight}"/>
    <rect x="9" y="21" width="9" height="13" rx="3" fill="${C.water}"/><rect x="22" y="21" width="9" height="13" rx="3" fill="${C.water}"/>
    <circle cx="16" cy="46" r="7" fill="${C.ink}"/><circle cx="16" cy="46" r="2.8" fill="${C.mist}"/>
    <circle cx="49" cy="46" r="7" fill="${C.ink}"/><circle cx="49" cy="46" r="2.8" fill="${C.mist}"/>`,
  phone: `
    <rect x="16" y="4" width="32" height="56" rx="8" fill="${C.ink}"/>
    <rect x="19" y="10" width="26" height="42" rx="4" fill="${C.white}"/>
    <g fill="${C.ink}"><rect x="23" y="15" width="7" height="7" rx="1.5"/><rect x="34" y="15" width="7" height="7" rx="1.5"/><rect x="23" y="26" width="7" height="7" rx="1.5"/>
    <rect x="35" y="27" width="3" height="3"/><rect x="39" y="31" width="3" height="3"/><rect x="34" y="31" width="3" height="3"/></g>
    <rect x="22" y="40" width="20" height="7" rx="3.5" fill="${C.teal}"/>`,
  clipboard: `
    <rect x="12" y="10" width="40" height="50" rx="8" fill="${C.grape}"/>
    <rect x="12" y="52" width="40" height="8" rx="4" fill="${C.grapeDark}"/>
    <rect x="17" y="16" width="30" height="36" rx="4" fill="${C.white}"/>
    <rect x="24" y="5" width="16" height="10" rx="4" fill="${C.grapeDark}"/>
    <path d="M23 34l6 6 12-13" stroke="${C.leafDark}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Runner on the way: a jar with speed lines.
  runner: `
    <g stroke="#94A3B8" stroke-width="4" stroke-linecap="round"><path d="M3 28h11M1 38h13M5 48h9"/></g>
    <g transform="translate(14 3) scale(.86)">${jar()}</g>`,
  bottleNo: `
    <path d="M27 6h10v8l4 6v34a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6V20l4-6z" fill="${C.waterLight}"/>
    <path d="M23 32h18v22a6 6 0 0 1-6 6h-6a6 6 0 0 1-6-6z" fill="${C.water}"/>
    <rect x="26" y="3" width="12" height="6" rx="2" fill="${C.waterDark}"/>
    <circle cx="32" cy="33" r="25" fill="none" stroke="${C.coralDark}" stroke-width="6"/>
    <path d="M14 15l36 36" stroke="${C.coralDark}" stroke-width="6" stroke-linecap="round"/>`,
  stopwatch: `
    <rect x="27" y="3" width="10" height="7" rx="2" fill="${C.sunDark}"/>
    <path d="M50 15l4-4" stroke="${C.sunDark}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="32" cy="36" r="23" fill="${C.sun}"/><path d="M55 36a23 23 0 0 1-23 23 23 23 0 0 0 0-46 23 23 0 0 1 23 23z" fill="${C.sunDark}"/>
    <circle cx="32" cy="36" r="16" fill="${C.white}"/>
    <path d="M32 36V25" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/><path d="M32 36l7 5" stroke="${C.coralDark}" stroke-width="4" stroke-linecap="round"/>`,
  pin: `
    <path d="M32 4a20 20 0 0 1 20 20c0 15-20 36-20 36S12 39 12 24A20 20 0 0 1 32 4z" fill="${C.coral}"/>
    <path d="M52 24c0 15-20 36-20 36s6-13 9-24c2-8 0-20-9-32a20 20 0 0 1 20 20z" fill="${C.coralDark}"/>
    <circle cx="32" cy="24" r="8" fill="${C.white}"/>`,
  ready: `
    <circle cx="32" cy="34" r="23" fill="${C.leaf}"/><path d="M55 34a23 23 0 0 1-23 23 23 23 0 0 0 16-39 23 23 0 0 1 7 16z" fill="${C.leafDark}"/>
    <path d="M21 34l8 8 14-16" stroke="${C.white}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="5" y="7" width="6" height="6" rx="1" fill="${C.sun}" transform="rotate(20 8 10)"/><circle cx="56" cy="9" r="3.5" fill="${C.coral}"/>
    <rect x="53" y="50" width="5" height="5" rx="1" fill="${C.water}" transform="rotate(-15 55 52)"/>`,
  // Volunteer buttons.
  swap: `${jar(`<path d="M24 37a8 8 0 0 1 14-4l2-3v8h-8l3-2.5a5 5 0 0 0-8 2z" fill="${C.white}"/>`)}`,
  lastJar: `${jar(`<text x="32" y="47" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="18" fill="${C.white}">1</text>`)}`,
};

export function svg(name) {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${ART[name] || ''}</svg>`;
}

// Fills every <span data-art="name"> on the page.
export function mountArt(root = document) {
  for (const el of root.querySelectorAll('[data-art]')) {
    if (!el.firstElementChild) el.innerHTML = svg(el.dataset.art);
  }
}

export const artNames = Object.keys(ART);

// Status icons: small, single-colour (they take the text colour of their status), one distinct shape each,
// so a status never depends on colour alone.
const STATUS_ICON = {
  needs_jars: '<circle cx="12" cy="12" r="10" fill="currentColor"/><rect x="10.6" y="6" width="2.8" height="8" rx="1.4" style="fill:var(--icon-cut)"/><circle cx="12" cy="17.4" r="1.6" style="fill:var(--icon-cut)"/>',
  not_stocked: '<rect x="5" y="4" width="14" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="8.5" y="2" width="7" height="4" rx="1.5" fill="currentColor"/><path d="M8.5 11h7M8.5 15h4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  quiet: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="3.2 3"/><path d="M8.5 12h7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  cups_low: '<path d="M12 3 22 20.5H2z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><rect x="10.8" y="9" width="2.4" height="6.5" rx="1.2" style="fill:var(--icon-cut)"/><circle cx="12" cy="18" r="1.4" style="fill:var(--icon-cut)"/>',
  ok: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m7 12.5 3.3 3.3L17 9" fill="none" style="stroke:var(--icon-cut)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function statusIcon(status) {
  return `<svg class="st-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${STATUS_ICON[status] || ''}</svg>`;
}
