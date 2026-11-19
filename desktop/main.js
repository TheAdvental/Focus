// Desktop shell: shows the same app in a window, lives in the tray,
// closes blocked programs during focus and tells the browser extension when focus is on.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http'), crypto = require('crypto'), { execFile } = require('child_process');

// The browser extension reads http://127.0.0.1:47600/state; Claude talks to /mcp on the same port.
// FOCUS_PORT is only for running a test copy next to the real app.
const STATE_PORT = +process.env.FOCUS_PORT || 47600;
const APP_ID = 'app.focus.desktop';
const PROTECTED = new Set(['explorer.exe', 'electron.exe', 'focus.exe', 'svchost.exe', 'csrss.exe', 'winlogon.exe', 'dwm.exe', 'taskmgr.exe']);
// The built app (see build.js) carries its own copy of the page; from source it is one folder up.
const PAGE = app.isPackaged ? path.join(__dirname, 'index.html') : path.join(__dirname, '..', 'index.html');
const START_HIDDEN = process.argv.includes('--hidden'); // how Windows launches us at sign-in: straight to the tray
let win, tray, quitting = false;
let state = { active: false, endAt: 0, title: '', sites: [], apps: [], lang: 'uk' };
const isActive = () => state.active && state.endAt > Date.now();

// Windows shows toast notifications only for apps with an id; in development that has to be the exe path
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function icon(size = 64) {
  const buf = require('./icon').drawIcon(size);
  for (let i = 0; i < buf.length; i += 4) { const r = buf[i]; buf[i] = buf[i + 2]; buf[i + 2] = r; } // RGBA -> BGRA
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
// The page tells us its language together with the focus state; the tray follows it.
const TEXT = {
  uk: { name: 'Фокус', running: 'сесія триває', open: 'Відкрити', quit: 'Вийти' },
  en: { name: 'Focus', running: 'session in progress', open: 'Open', quit: 'Quit' },
};
let menuLang = '';
function updateTray() {
  if (!tray) return;
  const t = TEXT[state.lang] || TEXT.uk;
  tray.setToolTip(isActive() ? `${t.name}: ${state.title || t.running}` : t.name);
  if (menuLang === state.lang) return;
  menuLang = state.lang;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t.open, click: () => win.show() },
    { label: t.quit, click: () => { quitting = true; app.quit(); } },
  ]));
}
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1120, height: 820, title: 'Фокус', autoHideMenuBar: true, icon: icon(), backgroundColor: '#0b0b0d',
    show: !START_HIDDEN,
    // no system title bar: the page's own header is the title bar; Windows only draws the three window buttons over it
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e0e10', symbolColor: '#efe9db', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
  win.loadFile(PAGE);
  shortcuts();
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });

  tray = new Tray(icon(32));
  tray.on('click', () => win.show());
  updateTray();
});
// Built app only. The Start menu shortcut carries the app id — Windows needs that to show our notifications.
// The desktop shortcut is made once; if the user deletes it, it stays deleted.
function shortcuts() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const link = { target: process.execPath, cwd: path.dirname(process.execPath), appUserModelId: APP_ID,
    description: 'Фокус — одна справа за раз', icon: path.join(__dirname, 'icon.ico'), iconIndex: 0 };
  try {
    const menu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Фокус.lnk');
    shell.writeShortcutLink(menu, fs.existsSync(menu) ? 'replace' : 'create', link);
    const marker = path.join(app.getPath('userData'), 'desktop-shortcut-made');
    if (!fs.existsSync(marker)) {
      const desk = path.join(app.getPath('desktop'), 'Фокус.lnk');
      shell.writeShortcutLink(desk, fs.existsSync(desk) ? 'replace' : 'create', link);
      fs.writeFileSync(marker, '');
    }
  } catch (e) { console.error('shortcuts:', e.message); }
}
const LOGIN = { args: ['--hidden'] };
ipcMain.handle('autostart-get', () => app.isPackaged ? app.getLoginItemSettings(LOGIN).openAtLogin : null);
ipcMain.handle('autostart-set', (e, on) => {
  if (!app.isPackaged) return null;
  app.setLoginItemSettings({ openAtLogin: !!on, args: LOGIN.args });
  return app.getLoginItemSettings(LOGIN).openAtLogin;
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; }); // let Windows shutdown / updates close the app for real

ipcMain.on('remind', () => {
  if (!win) return;
  if (!win.isVisible() || win.isMinimized()) win.showInactive();
  win.flashFrame(true);
  win.once('focus', () => win.flashFrame(false));
});
ipcMain.on('show-window', () => { if (win) { win.show(); win.focus(); } });
// the page's theme changed: recolour the window buttons to match its header
ipcMain.on('chrome', (e, color, symbolColor) => {
  if (!win || !/^#[0-9a-f]{3,8}$/i.test(color) || !/^#[0-9a-f]{3,8}$/i.test(symbolColor)) return;
  try { win.setTitleBarOverlay({ color, symbolColor, height: 44 }); win.setBackgroundColor(color); } catch (err) {}
});

ipcMain.on('focus-state', (e, s) => {
  if (!s || typeof s !== 'object') return;
  state = { active: !!s.active, endAt: +s.endAt || 0, title: String(s.title || ''), lang: s.lang === 'en' ? 'en' : 'uk',
    sites: (Array.isArray(s.sites) ? s.sites : []).map(String),
    apps: (Array.isArray(s.apps) ? s.apps : []).map(String).filter(a => /^[\w .()+-]+\.exe$/i.test(a) && !PROTECTED.has(a.toLowerCase())) };
  updateTray();
});

/* ---------- MCP for Claude ---------- */
// The tools are shared with the server (mcp-tools.js); here they read and write the page's data through window.FocusStore,
// so every change Claude makes is saved, shown and synced exactly like one made by hand.
const TOOLS_FILE = [path.join(__dirname, 'mcp-tools.js'), path.join(__dirname, '..', 'server', 'mcp-tools.js')].find(f => fs.existsSync(f));
const BRIDGE_FILE = path.join(__dirname, 'mcp-stdio.js');
// Access key for /mcp. The stdio bridge reads it from this file, so the user never has to copy it.
const TOKEN_FILE = path.join(app.getPath('userData'), 'mcp-token');
let TOKEN = '';
try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) {}
if (TOKEN.length < 32) {
  TOKEN = crypto.randomBytes(24).toString('hex');
  try { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, TOKEN); } catch (e) { console.error('mcp token:', e.message); }
}
async function page(code) {
  if (!win) throw new Error('the window is not ready yet');
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  for (let i = 0; i < 50; i++) { // the page defines FocusStore at the end of its script
    if (await win.webContents.executeJavaScript('typeof FocusStore === "object"')) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return win.webContents.executeJavaScript(code);
}
const rpc = TOOLS_FILE && require(TOOLS_FILE).createMcp({
  load: () => page('FocusStore.snapshot()'),
  put: (col, rec) => page(`FocusStore.put(${JSON.stringify(col)}, ${JSON.stringify(rec)})`),
  events: (from, to) => page(`FocusStore.events(${JSON.stringify(from)}, ${JSON.stringify(to)})`),
});
ipcMain.handle('mcp-info', () => rpc && fs.existsSync(BRIDGE_FILE) ? { bridge: BRIDGE_FILE } : null);

// A web page in any browser can also send requests to 127.0.0.1. Browsers always add an Origin header to those, and a
// page that tricks DNS into pointing at us still sends its own host name — so /mcp refuses both, and needs the key.
const LOCAL_HOSTS = new Set([`127.0.0.1:${STATE_PORT}`, `localhost:${STATE_PORT}`]);
const keyOk = req => {
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, '')), want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 1e6) { rej(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { res(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}

// Local-only endpoints: /state for the browser extension, /mcp for Claude.
http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  if (url === '/mcp') {
    if (req.headers.origin || !LOCAL_HOSTS.has(req.headers.host)) return json(403, { error: 'forbidden' });
    if (!keyOk(req)) return json(401, { error: 'unauthorized' });
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    if (!rpc) return json(500, { error: 'tools are missing' });
    try { const out = await rpc(await readBody(req)); return out ? json(200, out) : json(202); }
    catch (e) { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }); }
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ active: isActive(), endAt: state.endAt, title: state.title, lang: state.lang, sites: isActive() ? state.sites : [] }));
}).on('error', err => console.error('local endpoint:', err.message)).listen(STATE_PORT, '127.0.0.1');

// Close blocked programs: ask politely first, force only if the program is still there on the next check.
const asked = new Set();
setInterval(() => {
  if (!isActive() || !state.apps.length || process.platform !== 'win32') { asked.clear(); return; }
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
    if (err) return;
    const running = new Set(out.split(/\r?\n/).map(l => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()));
    for (const name of state.apps) {
      const key = name.toLowerCase();
      if (!running.has(key)) { asked.delete(key); continue; }
      execFile('taskkill', asked.has(key) ? ['/IM', name, '/F'] : ['/IM', name], { windowsHide: true }, () => {});
      asked.add(key);
    }
  });
}, 4000);
