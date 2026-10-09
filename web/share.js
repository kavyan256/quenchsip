// Sharing that fits how teams already work: the phone's share sheet (WhatsApp etc.), else WhatsApp Web, else copy.
export async function shareText(text, title = 'Quench') {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const opened = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  if (opened) return 'whatsapp';
  await copyText(text);
  return 'copied';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / plain http: select-and-copy fallback.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// Calendar reminder (.ics) that opens in Google or Apple Calendar.
export function downloadReminder({ title, startsAt, minutesBefore = 30, details = '' }) {
  const at = new Date(Date.parse(startsAt) - minutesBefore * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(at.getTime() + 15 * 60000);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Quench//EN', 'BEGIN:VEVENT',
    `UID:${fmt(at)}-${Math.random().toString(36).slice(2)}@quench`,
    `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(at)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${title.replace(/[,;]/g, ' ')}`, `DESCRIPTION:${details.replace(/\n/g, '\\n').replace(/[,;]/g, ' ')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:Quench stock check', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'quench-stock-check.ics' });
  a.click();
  URL.revokeObjectURL(url);
}
