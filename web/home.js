import { escape } from './api.js';
import { myEvents } from './store.js';
import { mountArt, svg } from './art.js';

mountArt();

const list = myEvents();
if (list.length) {
  document.getElementById('mine').hidden = false;
  document.getElementById('eventList').innerHTML = list
    .map((e) => {
      const when = e.startsAt ? new Date(e.startsAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const href = `event.html?e=${e.id}${e.key ? `#k=${e.key}` : ''}`;
      return `<li><a href="${href}"><span class="art sm">${svg('station')}</span><span class="grow"><strong>${escape(e.name)}</strong><span class="small">${escape(when)}${e.key ? '' : ' · view only'}</span></span><span aria-hidden="true">›</span></a></li>`;
    })
    .join('');
}
