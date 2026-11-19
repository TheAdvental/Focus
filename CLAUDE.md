# Focus (Фокус)

Personal anti-procrastination system: day plan, focus timer, distraction blocking, sync through the owner's home server. One user, no accounts. Setup instructions for humans are in `README.md`.

## Layout

| Path | What it is |
|---|---|
| `index.html` | **The whole app UI** — one file, no build step, no external resources. Shared by every shell below. |
| `server/server.js` | Zero-dependency Node server: sync storage (JSON file), iCal calendar reader, MCP endpoint for Claude, serves `index.html`. |
| `server/mcp-tools.js` | **The MCP tools for Claude, shared** by the server and the PC app (copied into `dist` by `build.js`, into the Docker image by `Dockerfile`). |
| `desktop/mcp-stdio.js` | stdio ↔ HTTP bridge that Claude Code / Claude Desktop launch; forwards to the PC app's `/mcp` with the key from `%APPDATA%\Focus\mcp-token`, starts the app if needed. |
| `desktop/` | Electron shell: window + tray, kills blocked programs during focus, serves focus state on `127.0.0.1:47600` for the extension. |
| `extension/` | Chrome/Edge MV3 extension: redirects blocked sites to `blocked.html` while focus is on. Depends on the desktop shell. |
| `android/` | Java app (no AndroidX, no Kotlin): WebView with the same `index.html` + accessibility service that covers blocked apps. |

## Rules that are easy to break

- **`index.html` must stay self-contained.** It runs from `file://`, inside Electron, inside an Android WebView and from the server. No CDN fonts/scripts, no ES module imports, no build tooling. Wrap every `localStorage` access in try/catch.
- **UI text is written in Ukrainian; English is a translation layer.** Every new or changed UI string needs its pair in the `EN` dictionary at the top of the script in `index.html` (or a pattern in `EN_RE` when it contains a variable). A `MutationObserver` translates whatever reaches the DOM; strings that never do — `alert`, `confirm`, `Notification`, `document.title` — must be wrapped in `tr()`. Strings joined with ` · ` are translated part by part. The shells have their own small tables: `TEXT` in `desktop/main.js` and `extension/blocked.js`, `values-en/strings.xml` on Android (which follows the phone's language, not the app's). Code comments are English.
- **To check a translation is complete:** open the app with `localStorage['focus-app-v1-lang'] = 'en'`, visit every tab and dialog, and scan text nodes for Cyrillic — wait a tick after each action, because the observer translates asynchronously.
- **Docs live in `docs/` (Ukrainian)** and describe behaviour in detail; update the matching file when behaviour changes. `README.md` is the short cheat-sheet.
- **Every synced record carries `u`** (last-change time, ms). Any code that mutates a task/session/stuck record must set `u = Date.now()`; for `timer`, `settings`, `blocklist` set `S.kvu.<key>`. Forgetting this means the change never syncs.
- **Never remove tasks from `S.tasks`** — mark `del: true` (tombstone) and read through `live()`.
- **Session ids are `'s' + timer.startAt`** so two devices finishing the same timer don't log it twice.
- **Shells talk to the page through two optional globals:** `window.desktop` (Electron preload) and `window.AndroidBridge` (WebView). Always call them with `?.`. `pushDesktop()` is the single place that reports focus state.
- **Habits are templates (`S.habits`); each due day becomes an ordinary task** with id `h:<habitId>:<date>`, `habitId` and `mini` — created lazily by `materializeHabits()` with `u` = start of that day (so every device makes the identical record and any real edit wins). Never give a materialized instance `u = Date.now()` at creation. Anything that lists tasks must decide what to do with `t.habitId`: they show only on their own day and are hidden from "Усі завдання". A missed day is not stored — it is a habit day without a done instance (`habitState()`). `server/mcp-tools.js` re-derives undone instances (`instance()`/`habitOn()`); keep that in step with the client. Per-day marks and notes (`openDay`, `#dlgDay`) write to that day's instance — `done`, `mini`, `note` — creating it on demand with a real `u`; the habit's own note is `habit.note`.
- **When testing in the browser pane, never `localStorage.clear()` and reload in one step:** a sync already in flight in the old page writes its state back before the page unloads, and the test then runs on stale data. Stub `Storage.prototype.setItem` first, clear, then navigate.
- **Reminders have two implementations on purpose.** In the page, `checkReminders()` (every 15 s) shows `#dlgRemind`; fired/snoozed state is per device in `localStorage['focus-app-v1-rem']`. On Android the page is paused in the background, so `pushReminders()` (called from `store()`) hands the upcoming list to `AndroidBridge.setReminders`, and `Reminders.java` schedules exact alarms. Change the "is this task due" rules in both places.
- **No system-drawn controls in the page.** Do not add `<select>` without `Dropdown()`, native `type="date"/"time"` inputs, bare number inputs, `alert()` or `confirm()`. Use: `Dropdown(sel)` (call `sel.refresh()` after changing its options), a hidden input plus `<button class="pick" data-pick="date|time" data-for="id">` (call `refreshPicks()` after setting the value from code), `.stepper` with `data-step` buttons, `class="switch"` on a check box, and `await ask(text, yesLabel)` / `tell(text)`. Rows that contain switches must not have class `task` — that class restyles check boxes into tick boxes. Calendar grids (`.cal`/`.cell`) must stay shrinkable: check new dialogs at 320 px width.
- **Themes are CSS variables only** (`:root`, `[data-theme=poster]`, `[data-theme=neon]`). New UI must use the variables, never hard-coded colours — the canvas scene reads `--sky1/--sky2/--bld/--win/--moon/--rain` via `cssVar()`.
- **The logo is defined in four places** with the same geometry (48-unit grid, pupil wedge from -70° to -20°): inline SVG in `index.html` (favicon, header, splash), `desktop/icon.js`, `android/.../drawable/ic_launcher.xml`, `extension/icon*.png` (generated). Change all together.
- Music is synthesised with WebAudio in `Music` — there are no audio files, and none should be added.
- The server is HTTP-only and meant for the home LAN. Auth is one bearer token (`FOCUS_TOKEN`). The iCal URL is stored server-side and never returned by the API.

## Sync protocol

`POST /api/sync {since, changes:{tasks,sessions,stuck,kv}}` → server keeps a record only if its `u` is newer than the stored one, stamps it with an increasing `rev`, and returns everything with `rev > since`. The client sends records with `u >= SY.pushedAt`. `kv` holds singletons: `timer`, `settings`, `blocklist`.

The response also carries `epoch`, a random id of the server database. If it differs from the one the client remembers, the database was recreated, so the client resets `SY.rev`/`SY.pushedAt` and resends everything.

Other endpoints: `GET /api/state` (current timer, polled by the Android service), `GET /api/calendar?from&to`, `PUT /api/config {icalUrl}`, `POST /mcp` (stateless JSON-RPC, tools from `server/mcp-tools.js`).

## Claude (MCP)

- Tools live in `server/mcp-tools.js` and take an adapter `{ load, put, events }`. Server adapter: its db. PC adapter: `desktop/main.js` → `executeJavaScript` → `window.FocusStore` in `index.html` (`snapshot`, `put` with the sync rule, `events`). Add a tool once there; both homes get it.
- Every record a tool writes must carry a fresh `u`; tool errors meant for Claude are thrown with `fail()` (`isError` result), anything else is an internal error.
- The PC endpoint `127.0.0.1:47600/mcp` requires the bearer key from `<userData>/mcp-token` and rejects requests with an `Origin` header or a foreign `Host` (browser pages / DNS rebinding). Keep those checks.
- Testing next to the user's running app: start a copy with `FOCUS_PORT=47611 dist/Focus/Focus.exe --user-data-dir=<scratch>` and point the bridge at it with `FOCUS_PORT` + `FOCUS_TOKEN_FILE=<scratch>/mcp-token`. Never test tools against the user's real app — they write real data. The bridge's auto-start would launch the real profile, so it is not tested this way.
- The `claude` CLI on this machine is not logged in, so a real Claude cannot be scripted here; test with a JSON-RPC client through the bridge.

## Commands

Run the server locally (data goes to `server/data/`; token must be 16+ characters):

```bash
FOCUS_TOKEN=local-dev-token-0123456789 PORT=8765 node server/server.js
```

Desktop shell from source:

```bash
cd desktop && npm start
```

Build the standalone Windows app into `dist/Focus/Focus.exe` (plain copy of the Electron runtime plus our files in `resources/app`; no packaging tools). The user runs this build from Desktop/Start-menu shortcuts, so **rebuild after changing `index.html` or anything in `desktop/`**, and the build fails while the app is running — quit it from the tray first:

```bash
cd desktop && npm run build
```

In the built app `app.isPackaged` is true: it loads its own copy of `index.html`, creates the shortcuts (the Start-menu one carries the app id needed for Windows notifications), and offers autostart (`--hidden` = start in the tray). Its data lives in `%APPDATA%\Focus`. To test it without touching that profile, launch `dist/Focus/Focus.exe --user-data-dir=<scratch dir>`.

Regenerate the extension PNG icons after changing `desktop/icon.js`:

```bash
node desktop/icon.js
```

Android debug build (copies the current `index.html` into the APK; needs JDK 17+):

```bash
cd android && ./gradlew assembleDebug
```

## How to verify changes

- **UI / sync:** start the local server and open `http://localhost:8765/` in the browser pane. The pane's `file://` preview blocks `localStorage`, so persistence and sync can only be tested over http. Two "devices" = `localhost:8765` and `127.0.0.1:8765` (separate storage).
- **Desktop:** launch with `--remote-debugging-port=9223 --user-data-dir=<scratch dir>` so the user's real profile is untouched, drive it over CDP, and check `curl http://127.0.0.1:47600/state`. For the kill test use a harmless program (e.g. `charmap.exe`), never something the user may have open.
- **Android:** emulator AVD `Medium_Phone_API_36.1` exists. Enable the service with `adb shell settings put secure enabled_accessibility_services app.focus/app.focus.BlockService`; inspect state with `adb shell run-as app.focus cat shared_prefs/focus.xml`.
- **Driving the page inside the Android app:** debug builds enable WebView debugging. `adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof app.focus)` and talk CDP to it; run `adb forward --remove-all` afterwards or the port stays taken.
- The browser extension cannot be loaded from here — it has to be checked by hand in Chrome.

## Environment gotchas (this machine)

- Gradle is not on PATH and the connection is slow. Build offline with the cached distribution and AGP 8.13.1:
  `JAVA_HOME='C:\Program Files\Android\openjdk\jdk-21.0.8' ~/.gradle/wrapper/dists/gradle-9.1.0-all/*/gradle-9.1.0/bin/gradle --offline assembleDebug -Pandroid.aapt2FromMavenOverride=C:/Users/minec/AppData/Local/Android/Sdk/build-tools/36.0.0/aapt2.exe`
  (`JAVA_HOME` must be a Windows-style path; `local.properties` needs forward slashes.)
- AGP 9.x and the plugin-marker (`plugins { id ... version }`) form do not resolve offline here — keep the `buildscript { classpath }` form.
- npm blocks Electron's postinstall until approved (`allowScripts` in `desktop/package.json`). If `node_modules/electron/dist/electron.exe` is missing after install, unzip the cached archive from `%LOCALAPPDATA%\electron\Cache\*\electron-*.zip` into `node_modules/electron/dist` and write `electron.exe` into `node_modules/electron/path.txt`.
- In Git Bash, `adb shell` arguments starting with `/` get rewritten to Windows paths.
- Android: targetSdk 36 means `onBackPressed()` is not called — use `OnBackInvokedCallback`. A WebView ignores its own padding, so window insets are applied to a wrapper `FrameLayout`.
- Android blocking must not start an Activity from the service: the user's phone is a POCO (HyperOS, Android 16), which silently refuses background activity starts. `BlockService.block()` presses Home and draws a `TYPE_ACCESSIBILITY_OVERLAY` window instead. Things that pass on the emulator can still fail on that phone — say so when only the emulator was tested.
- With the phone and the emulator both attached, pass `-s emulator-5554` (or the phone's serial) to every `adb` call.
