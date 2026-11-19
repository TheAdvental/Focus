const target = new URLSearchParams(location.search).get('u') || '';
const safe = /^https?:\/\//i.test(target);
const pad = n => String(n).padStart(2, '0');
const $ = id => document.getElementById(id);

// The page follows the language chosen in the Focus app (reported with the focus state).
const TEXT = {
  uk: { head: 'Зараз час фокусу', blocked: 'Заблоковано: ', task: 'Ти працюєш над: ', back: 'Сторінка повернеться сама, щойно сесія закінчиться.' },
  en: { head: 'It is focus time', blocked: 'Blocked: ', task: 'You are working on: ', back: 'The page will come back by itself as soon as the session ends.' },
};
let endAt = 0;
function paint(st) {
  const t = TEXT[st.lang] || TEXT.uk;
  document.documentElement.lang = st.lang === 'en' ? 'en' : 'uk';
  document.title = st.lang === 'en' ? 'Focus' : 'Фокус';
  $('head').textContent = t.head;
  $('back').textContent = t.back;
  $('site').textContent = safe ? t.blocked + new URL(target).hostname : '';
  $('task').textContent = st.title ? t.task + st.title : '';
}
async function poll() {
  let st = { active: false };
  try { st = await (await fetch('http://127.0.0.1:47600/state', { cache: 'no-store' })).json(); } catch (e) {}
  if (!st.active) { if (safe) location.replace(target); return; }
  endAt = st.endAt;
  paint(st);
}
function tick() {
  const sec = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  $('left').textContent = endAt ? `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}` : '';
}
paint({}); poll(); setInterval(poll, 3000); setInterval(tick, 500);
