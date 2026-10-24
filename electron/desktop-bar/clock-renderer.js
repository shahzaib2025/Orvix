const time = document.getElementById('clockTime');
const hours = document.getElementById('clockHours');
const minutes = document.getElementById('clockMinutes');
const date = document.getElementById('clockDate');
const period = document.getElementById('clockPeriod');
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
let timer;
function refreshClock() {
  clearTimeout(timer);
  const now = new Date();
  const parts = timeFormat.formatToParts(now);
  const value = type => parts.find(part => part.type === type)?.value || '';
  hours.textContent = value('hour');
  minutes.textContent = value('minute');
  period.textContent = value('dayPeriod');
  date.textContent = dateFormat.format(now);
  time.dateTime = now.toISOString();
  time.setAttribute('aria-label', timeFormat.format(now));
  if (!document.hidden) timer = setTimeout(refreshClock, 60000 - Date.now() % 60000 + 25);
}
document.addEventListener('visibilitychange', refreshClock);
refreshClock();
