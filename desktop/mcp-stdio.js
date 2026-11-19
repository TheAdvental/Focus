#!/usr/bin/env node
// Connects Claude (Claude Code, Claude Desktop) to the Фокус PC app. Claude starts this script and talks MCP over
// stdin/stdout; the script passes every message on to the app's local endpoint http://127.0.0.1:47600/mcp,
// adding the access key the app keeps in %APPDATA%\Focus\mcp-token. If the app is not running, it starts it in the tray.
//
//   claude mcp add --scope user focus -- node "<path to this file>"
//
// Only JSON-RPC goes to stdout; anything else goes to stderr. Zero dependencies.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');

const PORT = +process.env.FOCUS_PORT || 47600; // FOCUS_PORT / FOCUS_TOKEN_FILE: only for testing next to the real app
const TOKEN_FILES = [process.env.FOCUS_TOKEN_FILE, process.env.APPDATA && path.join(process.env.APPDATA, 'Focus', 'mcp-token'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Focus', 'mcp-token')].filter(Boolean);
// the built app sits two folders up from resources/app; from source it is in ../dist/Focus
const APP_EXE = [path.join(__dirname, '..', '..', 'Focus.exe'), path.join(__dirname, '..', 'dist', 'Focus', 'Focus.exe')].find(f => fs.existsSync(f));
const log = (...a) => process.stderr.write('[focus] ' + a.join(' ') + '\n');

function token() {
  for (const f of TOKEN_FILES) { try { const t = fs.readFileSync(f, 'utf8').trim(); if (t) return t; } catch (e) {} }
  return '';
}
function post(text) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(text, 'utf8');
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, Authorization: 'Bearer ' + token() } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('the app did not answer in 60 s')));
    req.end(body);
  });
}
let starting = null;
function startApp() {
  if (starting) return starting;
  starting = (async () => {
    if (!APP_EXE) throw new Error('Фокус для ПК не запущений, і Focus.exe не знайдено поруч. Запусти програму вручну.');
    log('starting', APP_EXE);
    const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
    spawn(APP_EXE, ['--hidden'], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
    for (let i = 0; i < 60; i++) { // up to 30 s for the app to come up
      await new Promise(r => setTimeout(r, 500));
      try { await post('{"jsonrpc":"2.0","id":0,"method":"ping"}'); return; } catch (e) {}
    }
    throw new Error('Фокус для ПК не запустився за 30 секунд.');
  })().finally(() => { starting = null; });
  return starting;
}
async function forward(text) {
  try { return await post(text); }
  catch (e) {
    if (e.code !== 'ECONNREFUSED') throw e;
    await startApp();
    return post(text);
  }
}
const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
function errorFor(msg, message) {
  const one = m => m && m.id !== undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32000, message } } : null;
  const out = Array.isArray(msg) ? msg.map(one).filter(Boolean) : one(msg);
  if (out && (!Array.isArray(out) || out.length)) send(out);
}
async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  try {
    const r = await forward(line);
    if (r.status === 202 || !r.text) return;
    if (r.status === 401) return errorFor(msg, 'Немає доступу: ключ у %APPDATA%\\Focus\\mcp-token не підходить. Перезапусти Фокус для ПК.');
    if (r.status !== 200) return errorFor(msg, `Фокус для ПК відповів помилкою ${r.status}`);
    send(JSON.parse(r.text));
  } catch (e) { errorFor(msg, e.message); }
}

// Messages are handled one at a time, in order.
let buf = '', chain = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) chain = chain.then(() => handle(line));
  }
});
process.stdin.on('end', () => chain.then(() => process.exit(0)));
