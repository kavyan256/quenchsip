// First-time help for organisers: welcome slides on the home page and a short tour of the event hub.
// Each shows once per device (localStorage). ?intro=off turns all of it off on this device (for recordings and tests).
import { svg } from './art.js';

const OFF_KEY = 'qs-intro-off';
const WELCOME_KEY = 'qs-welcome-seen';
const TOUR_KEY = 'qs-tour-seen';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k) => { try { localStorage.setItem(k, '1'); } catch {} },
};
// If storage is blocked we can't remember "seen", so show nothing rather than every time.
const storageWorks = () => { try { localStorage.setItem('qs-probe', '1'); localStorage.removeItem('qs-probe'); return true; } catch { return false; } };

if (new URLSearchParams(location.search).get('intro') === 'off') store.set(OFF_KEY);
export const introOff = () => store.get(OFF_KEY) === '1';
const shouldShow = (key) => !introOff() && storageWorks() && store.get(key) !== '1';

// ---------- Welcome slides ----------
const SLIDES = [
  { art: [['drop', 'big'], ['jar', ''], ['cup', 'sm']], title: 'Water without plastic bottles', text: 'Quench helps your event serve water from refill stations instead of plastic water bottles.' },
  { art: [['people', ''], ['calendar', 'sm'], ['jar', '']], title: 'Know what to order', text: 'Tell us your crowd and the time. We work out the jars and cups for each station.' },
  { art: [['phone', ''], ['runner', 'big']], title: 'No station runs dry', text: 'Volunteers tap once when they change a jar. Quench sends a runner before a station is empty.' },
  { art: [['bottleNo', ''], ['dropCheer', 'big']], title: 'See what you saved', text: 'After the event you see the litres served and how many plastic bottles you avoided.' },
];

export function maybeWelcome() {
  if (shouldShow(WELCOME_KEY)) showWelcome();
}

export function showWelcome() {
  const returnFocus = document.activeElement;
  const sheet = document.createElement('div');
  sheet.className = 'ob-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'obTitle');
  sheet.innerHTML = `<div class="ob-card">
      <div class="ob-top"><span class="ob-brand"><img src="icon.svg" width="28" height="28" alt="">Quench</span><button type="button" class="ob-skip" data-ob="skip">Skip</button></div>
      <div class="ob-stage" aria-live="polite">
        <div class="ob-art" aria-hidden="true"></div>
        <p class="ob-step" id="obStep"></p>
        <h2 class="ob-title" id="obTitle"></h2>
        <p class="ob-text" id="obText"></p>
      </div>
      <div class="ob-foot">
        <div class="ob-dots" aria-hidden="true">${SLIDES.map(() => '<span></span>').join('')}</div>
        <button type="button" class="primary-btn" data-ob="next">Next</button>
        <a class="link-btn" data-ob="look" href="#" hidden>Look around first</a>
      </div>
    </div>`;
  document.body.append(sheet);
  document.body.classList.add('ob-open');
  const q = (s) => sheet.querySelector(s);
  let i = 0;

  const render = () => {
    const s = SLIDES[i];
    const last = i === SLIDES.length - 1;
    q('.ob-art').innerHTML = `${s.art.map(([a, c]) => `<span class="art ${c}">${svg(a)}</span>`).join('')}<span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span>`;
    q('#obStep').textContent = `${i + 1} of ${SLIDES.length}`;
    q('#obTitle').textContent = s.title;
    q('#obText').textContent = s.text;
    sheet.querySelectorAll('.ob-dots span').forEach((d, n) => d.classList.toggle('on', n === i));
    q('[data-ob="next"]').textContent = last ? 'Set up my event' : 'Next';
    q('[data-ob="look"]').hidden = !last;
    q('[data-ob="skip"]').hidden = last;
  };
  const close = () => {
    store.set(WELCOME_KEY);
    sheet.remove();
    document.body.classList.remove('ob-open');
    removeEventListener('keydown', onKey);
    returnFocus?.focus?.();
  };
  const go = (n) => { i = Math.max(0, Math.min(SLIDES.length - 1, n)); render(); q('[data-ob="next"]').focus(); };
  const next = () => {
    if (i < SLIDES.length - 1) return go(i + 1);
    close();
    location.href = 'plan.html';
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Tab') trapFocus(e, sheet);
  };

  q('[data-ob="next"]').addEventListener('click', next);
  q('[data-ob="skip"]').addEventListener('click', close);
  q('[data-ob="look"]').addEventListener('click', (e) => { e.preventDefault(); close(); });
  // Swipe left / right on phones.
  let startX = null;
  sheet.addEventListener('pointerdown', (e) => { startX = e.clientX; });
  sheet.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
  });
  addEventListener('keydown', onKey);
  render();
  q('[data-ob="next"]').focus();
}

// ---------- Hub tour ----------
const TOUR = [
  ['.progress-card', 'This checklist ticks itself. Finish the 4 steps before the gates open.'],
  ['#step3', 'Print one QR code per station. Volunteers scan it: no app, no login.'],
  ['#tabBtn-live', 'On the day, open Live. Stations that need help come first.'],
  ['#tabBtn-summary', 'After the event: water served and plastic bottles avoided.'],
];

export function maybeTour() {
  if (shouldShow(TOUR_KEY)) startTour();
}

export function startTour() {
  const returnFocus = document.activeElement;
  const spot = Object.assign(document.createElement('div'), { className: 'ob-spot' });
  const tip = document.createElement('div');
  tip.className = 'ob-tip';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-modal', 'true');
  tip.setAttribute('aria-labelledby', 'obTipText');
  tip.innerHTML = `<span class="art">${svg('drop')}</span><div class="ob-tip-body"><p class="ob-step" id="obTipStep"></p><p id="obTipText"></p>
    <div class="ob-tip-row"><button type="button" class="ob-skip" data-ob="skip">Skip tour</button><button type="button" class="primary-btn" data-ob="next">Next</button></div></div>`;
  const shield = Object.assign(document.createElement('div'), { className: 'ob-shield' }); // stops clicks on the page underneath
  document.body.append(shield, spot, tip);
  let i = 0;

  const place = () => {
    const target = document.querySelector(TOUR[i][0]);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const tipH = tip.offsetHeight;
    const below = r.bottom + 18 + tipH < innerHeight || r.top - 18 - tipH < 0;
    const left = Math.min(Math.max(16, r.left), innerWidth - tip.offsetWidth - 16);
    Object.assign(tip.style, { left: `${Math.max(16, left)}px`, top: `${below ? r.bottom + 18 : r.top - tipH - 18}px` });
  };
  const show = () => {
    const target = document.querySelector(TOUR[i][0]);
    if (!target) return i < TOUR.length - 1 ? ((i += 1), show()) : close();
    tip.querySelector('#obTipStep').textContent = `Step ${i + 1} of ${TOUR.length}`;
    tip.querySelector('#obTipText').textContent = TOUR[i][1];
    tip.querySelector('[data-ob="next"]').textContent = i === TOUR.length - 1 ? 'Done' : 'Next';
    // The tabs sit at the top of the page: show them from the top, not wherever step 2 left the scroll.
    if (target.getAttribute('role') === 'tab') scrollTo({ top: 0, behavior: 'instant' });
    else target.scrollIntoView({ block: 'center', behavior: 'instant' });
    place();
    tip.querySelector('[data-ob="next"]').focus({ preventScroll: true });
  };
  const close = () => {
    store.set(TOUR_KEY);
    for (const el of [shield, spot, tip]) el.remove();
    removeEventListener('keydown', onKey);
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    returnFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') trapFocus(e, tip);
  };
  tip.querySelector('[data-ob="next"]').addEventListener('click', () => (i < TOUR.length - 1 ? ((i += 1), show()) : close()));
  tip.querySelector('[data-ob="skip"]').addEventListener('click', close);
  addEventListener('keydown', onKey);
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  show();
}

// Keep Tab inside an open dialog.
function trapFocus(e, root) {
  const items = [...root.querySelectorAll('button:not([hidden]), a[href]:not([hidden])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
