// Focus server: sync storage, Google Calendar (iCal) reader and MCP endpoint for Claude.
// No dependencies — plain Node.js 18+.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const TOKEN = process.env.FOCUS_TOKEN;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!TOKEN || TOKEN.length < 16) { console.error('Set FOCUS_TOKEN (at least 16 characters).'); process.exit(1); }

const FILE = path.join(DATA, 'db.json');
const COLS = ['tasks', 'habits', 'sessions', 'stuck', 'kv'];
let db = { rev: 0, tasks: {}, habits: {}, sessions: {}, stuck: {}, kv: {}, config: {} };
fs.mkdirSync(DATA, { recursive: true });
if (fs.existsSync(FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));

let saveT = null;
function flush() {
  if (!saveT) return;
  clearTimeout(saveT); saveT = null;
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(FILE + '.tmp', FILE);
}
function persist() { if (!saveT) saveT = setTimeout(flush, 200); }
// Identifies this particular database. If it is ever lost and recreated, clients notice the new
// epoch and send their full copy again instead of only recent changes.
if (!db.epoch) { db.epoch = crypto.randomBytes(8).toString('hex'); persist(); }
// `docker stop` sends SIGTERM: write pending changes before exiting
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flush(); process.exit(0); });
// Last write wins by the record's own timestamp `u`; every accepted write gets a new revision.
function put(col, rec) {
  const cur = db[col][rec.id];
  if (cur && cur.u >= rec.u) return false;
  db[col][rec.id] = Object.assign({}, rec, { rev: ++db.rev });
  persist();
  return true;
}
function sync(body) {
  for (const col of COLS)
    for (const rec of (body.changes && body.changes[col]) || [])
      if (rec && typeof rec.id === 'string' && typeof rec.u === 'number') put(col, rec);
  const since = +body.since || 0, changes = {};
  for (const col of COLS) changes[col] = Object.values(db[col]).filter(r => r.rev > since);
  return { rev: db.rev, epoch: db.epoch, changes };
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => dstr(new Date());

/* ---------- calendar (iCal) ---------- */
let cal = { at: 0, events: [] };
function tzOffset(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
function parseDT(value, params) {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?/.exec(value || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { date: new Date(+y, mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, mo - 1, +d, +h, +mi)) };
  if (params.TZID) {
    try { const g = Date.UTC(+y, mo - 1, +d, +h, +mi); return { date: new Date(g - tzOffset(g, params.TZID)) }; } catch (e) {}
  }
  return { date: new Date(+y, mo - 1, +d, +h, +mi) };
}
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/), events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';'), value = line.slice(i + 1), params = {};
    ps.forEach(p => { const [k, v] = p.split('='); params[k] = v; });
    const text = () => value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    if (name === 'SUMMARY') ev.title = text();
    else if (name === 'LOCATION') ev.location = text();
    else if (name === 'UID') ev.uid = value;
    else if (name === 'STATUS') ev.status = value;
    else if (name === 'DTSTART') { const p = parseDT(value, params); if (p) { ev.start = p.date; ev.allDay = !!p.allDay; } }
    else if (name === 'DTEND') { const p = parseDT(value, params); if (p) ev.end = p.date; }
    else if (name === 'RRULE') { ev.rrule = {}; value.split(';').forEach(x => { const [k, v] = x.split('='); ev.rrule[k] = v; }); }
    else if (name === 'EXDATE') value.split(',').forEach(v => { const p = parseDT(v, params); if (p) ev.exdates.push(+p.date); });
    else if (name === 'RECURRENCE-ID') { const p = parseDT(value, params); if (p) ev.recId = +p.date; }
  }
  return events;
}
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function* occurrences(ev) {
  const r = ev.rrule, s = ev.start;
  if (!r) { yield s; return; }
  const at = (y, m, d) => new Date(y, m, d, s.getHours(), s.getMinutes());
  const interval = +r.INTERVAL || 1, count = +r.COUNT || Infinity;
  const until = r.UNTIL ? parseDT(r.UNTIL, {}) : null;
  const untilMs = until ? +until.date + (until.allDay ? 864e5 : 0) : Infinity;
  const days = r.BYDAY ? r.BYDAY.split(',').map(x => WD.indexOf(x.slice(-2))).filter(x => x >= 0) : [s.getDay()];
  const monday = s.getDate() - (s.getDay() + 6) % 7;
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    let c = [];
    if (r.FREQ === 'DAILY') c = [at(s.getFullYear(), s.getMonth(), s.getDate() + i * interval)];
    else if (r.FREQ === 'WEEKLY') c = days.map(wd => at(s.getFullYear(), s.getMonth(), monday + i * interval * 7 + (wd + 6) % 7)).filter(d => d >= s).sort((a, b) => a - b);
    else if (r.FREQ === 'MONTHLY') { const d = at(s.getFullYear(), s.getMonth() + i * interval, s.getDate()); if (d.getDate() === s.getDate()) c = [d]; }
    else if (r.FREQ === 'YEARLY') { const d = at(s.getFullYear() + i * interval, s.getMonth(), s.getDate()); if (d.getDate() === s.getDate()) c = [d]; }
    else { yield s; return; }
    for (const d of c) { if (+d > untilMs || ++n > count) return; yield d; }
  }
}
async function calendar(from, to) {
  if (!db.config.icalUrl) return [];
  if (Date.now() - cal.at > 10 * 60000) {
    const r = await fetch(db.config.icalUrl, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('calendar fetch failed: ' + r.status);
    cal = { at: Date.now(), events: parseICS(await r.text()) };
  }
  const overridden = new Set(cal.events.filter(e => e.recId).map(e => e.uid + '|' + e.recId));
  const out = [];
  for (const ev of cal.events) {
    if (ev.status === 'CANCELLED') continue;
    const dur = ev.end ? ev.end - ev.start : 0;
    for (const d of occurrences(ev)) {
      const day = dstr(d);
      if (day > to) break;
      if (day < from || ev.exdates.includes(+d) || (ev.rrule && overridden.has(ev.uid + '|' + +d))) continue;
      out.push({ date: day, start: ev.allDay ? null : hm(d), end: ev.allDay || !dur ? null : hm(new Date(+d + dur)),
        allDay: !!ev.allDay, title: ev.title || '(без назви)', location: ev.location || '' });
    }
  }
  return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}

/* ---------- MCP (Claude) ---------- */
// The tools themselves live in mcp-tools.js and are shared with the PC app; here they work on the server's database.
const rpc = require('./mcp-tools').createMcp({
  load: async () => ({ tasks: Object.values(db.tasks), habits: Object.values(db.habits), sessions: Object.values(db.sessions),
    stuck: Object.values(db.stuck), timer: (db.kv.timer && db.kv.timer.v) || null }),
  put: async (col, rec) => { put(col, rec); },
  async events(from, to) {
    if (!db.config.icalUrl) return { configured: false, events: [] };
    try { return { configured: true, events: await calendar(from, to) }; } catch (e) { return { configured: true, events: [], error: e.message }; }
  },
});

/* ---------- HTTP ---------- */
const INDEX = [process.env.PUBLIC_FILE, path.join(__dirname, 'public', 'index.html'), path.join(__dirname, '..', 'index.html')].find(f => f && fs.existsSync(f));
const authed = req => {
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, '')), want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
function readBody(req) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20e6) { rej(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' });
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  };
  try {
    if (req.method === 'OPTIONS') return send(204);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return INDEX ? send(200, fs.readFileSync(INDEX, 'utf8'), 'text/html; charset=utf-8') : send(404, { error: 'no app file' });
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/mcp') return send(404, { error: 'not found' });
    if (!authed(req)) return send(401, { error: 'unauthorized' });

    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      const body = await readBody(req);
      const out = await rpc(body);
      return out ? send(200, out) : send(202);
    }
    if (url.pathname === '/api/sync' && req.method === 'POST') return send(200, sync(await readBody(req)));
    if (url.pathname === '/api/state' && req.method === 'GET') return send(200, { timer: (db.kv.timer && db.kv.timer.v) || null });
    if (url.pathname === '/api/calendar' && req.method === 'GET') {
      const from = url.searchParams.get('from') || today(), to = url.searchParams.get('to') || from;
      return send(200, { configured: !!db.config.icalUrl, events: await calendar(from, to) });
    }
    if (url.pathname === '/api/config' && req.method === 'PUT') {
      const { icalUrl } = await readBody(req);
      if (icalUrl && !(process.env.FOCUS_DEV ? /^https?:\/\//.test(icalUrl) : /^https:\/\//.test(icalUrl))) return send(400, { error: 'icalUrl must start with https://' });
      db.config.icalUrl = icalUrl || ''; cal.at = 0; persist();
      return send(200, { configured: !!db.config.icalUrl });
    }
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: e.message }); }
}).listen(PORT, () => console.log(`Focus server on :${PORT}, data in ${DATA}`));
