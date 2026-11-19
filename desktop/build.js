// Builds the standalone Windows app into ../dist/Focus (run: npm run build).
// No packaging tools needed: an Electron app is the Electron runtime folder plus our files in resources/app.
const fs = require('fs'), path = require('path');

const here = __dirname, root = path.join(here, '..');
const runtime = path.join(here, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist', 'Focus');

if (!fs.existsSync(path.join(runtime, 'electron.exe'))) {
  console.error('Electron is not installed: run "npm install" in desktop/ first (see CLAUDE.md if electron.exe is still missing).');
  process.exit(1);
}
// While the app is running Windows locks its exe. Then leave the runtime alone (never half-delete a live install)
// and refresh only our own files, which are read at start-up: the changes apply after the app is restarted.
const exe = path.join(out, 'Focus.exe');
let running = false;
if (fs.existsSync(exe)) { try { fs.closeSync(fs.openSync(exe, 'r+')); } catch (e) { running = true; } }

if (!running) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(runtime, out, { recursive: true });
  fs.renameSync(path.join(out, 'electron.exe'), exe);
  fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });
}

const appDir = path.join(out, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of ['main.js', 'preload.js', 'icon.js', 'mcp-stdio.js']) fs.copyFileSync(path.join(here, f), path.join(appDir, f));
fs.copyFileSync(path.join(root, 'server', 'mcp-tools.js'), path.join(appDir, 'mcp-tools.js')); // shared with the server
fs.copyFileSync(path.join(root, 'index.html'), path.join(appDir, 'index.html'));
fs.writeFileSync(path.join(appDir, 'icon.ico'), require('./icon').ico());
const pkg = require('./package.json');
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }, null, 2));

console.log(running
  ? 'The app is running: its files were updated in place. Restart it (tray icon → Quit, then open again) to apply.'
  : 'Built ' + exe);
