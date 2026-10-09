import { param } from './api.js';
import { mountSummary } from './summary-view.js';

const $ = (id) => document.getElementById(id);
const eventId = param('e');

if (!eventId) {
  $('loadError').textContent = 'No event in the link.';
  $('loadError').hidden = false;
} else {
  $('back').href = `event.html?e=${eventId}&tab=summary`;
  mountSummary($('mount'), eventId)
    .then((s) => {
      document.title = `${s.event.name} · Summary · Quench`;
      $('title').textContent = `${s.event.name}: summary`;
    })
    .catch((err) => {
      $('loadError').textContent = err.message;
      $('loadError').hidden = false;
    });
}
