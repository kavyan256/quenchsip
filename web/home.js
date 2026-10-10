import { escape, dayTime } from './api.js';
import { myEvents } from './store.js';
import { mountArt, svg } from './art.js';
import { maybeWelcome, showWelcome } from './onboarding.js';

mountArt();
document.getElementById('replayIntro').addEventListener('click', showWelcome);
maybeWelcome();

const list = myEvents();
if (list.length) {
  document.getElementById('mine').hidden = false;
  document.getElementById('eventList').innerHTML = list
    .map((e) => {
      const when = e.startsAt ? dayTime(e.startsAt) : '';
      const href = `event.html?e=${e.id}${e.key ? `#k=${e.key}` : ''}`;
      return `<li><a href="${href}"><span class="art sm">${svg('station')}</span><span class="grow"><strong>${escape(e.name)}</strong><span class="small">${escape(when)}${e.key ? '' : ' · view only'}</span></span><span aria-hidden="true">›</span></a></li>`;
    })
    .join('');
}
