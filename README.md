# Focus

**English** · [Українська](#фокус)

An anti-procrastination system: day plan, focus timer, distraction blocking, sync through your own server.

**Detailed documentation is in the [docs](docs/README.md) folder** (in Ukrainian): user guide, installation, architecture, API reference, troubleshooting. Below is a short cheat-sheet.

The interface is available in Ukrainian and English: "Settings" → "Appearance" → "Language".

| Folder / file | What it is |
|---|---|
| `index.html` | The app itself. Works locally; with the server it also syncs |
| `server/` | Server: data storage, Google Calendar reader, connection to Claude |
| `desktop/` | PC version: window, tray icon, closes programs during focus |
| `extension/` | Chrome/Edge extension: blocks sites during focus |
| `android/` | Android app: the same interface plus app blocking during focus |

## Themes, focus screen, music

- "Settings" has three themes: "Noir", "Poster", "Neon". The choice is remembered separately on each device.
- When a session starts, the focus screen opens with a night city; the moon is "eaten" as time runs out. "Minimise" returns to the plan, "Focus screen" on the timer card opens it again.
- The button next to the record turns music on and off. The music is generated on the fly (there are no audio files) and stops together with the timer. The choice is remembered: if music was on, the next session starts with it.
- The splash screen at launch can be skipped with a click.

## Plan reminders

When the time set in a task arrives, the app shows an "On the plan — now" window with the first step and buttons: start focus, just 5 minutes, snooze for 10 minutes.

- **PC:** the PC version must be running (at least in the tray) — it raises the window and shows a Windows notification.
- **Phone:** the notification arrives even if the app is closed; tasks are scheduled ahead as system alarms.
- Reminders don't disturb you during a focus session — they appear after it, if less than an hour has passed.
- If there was already a session for the task today, there is no reminder.
- To turn off: "Settings" → "Timer and data".

## 1. Server (Linux with Docker)

Copy the `Focus` folder to the server (you need `server/`, `index.html`, `Dockerfile`, `docker-compose.yml`, `.env.example`).

```bash
cp .env.example .env
```

Put your own long random key into `FOCUS_TOKEN` in `.env` (generate one with `openssl rand -hex 24`), then:

```bash
docker compose up -d --build
```

The server listens on port 8080. Data lives in the `focus-data` volume.

The server also serves the app itself: from a phone on your home network open `http://SERVER-ADDRESS:8080`.

> The server speaks plain HTTP without encryption — keep it on your home network only, don't expose the port to the internet.

## 2. PC version

The ready-made program is `dist\Focus\Focus.exe`. If it isn't there yet (freshly cloned repository), build it: `npm install`, then `npm run build` in the `desktop` folder (Node.js required). Launch it from the "Фокус" shortcut on the desktop or in the Start menu — the program creates them itself on first launch.

- Closing the window hides the program to the tray; to quit completely use the tray icon menu.
- "Settings" → "Timer and data" → start with Windows: the program will start in the tray when you sign in. Without it, reminders and blocking work only while you've launched it yourself.
- Data is stored in `%APPDATA%\Focus`.
- Don't move the `dist\Focus` folder: the shortcuts and autostart point to it. If you did, run `Focus.exe` from the new location (the Start-menu shortcut updates itself) and turn autostart off and on again.

After code changes the program must be rebuilt (quit it from the tray first):

```bash
cd desktop
```

```bash
npm run build
```

Running from source without building, for development: `npm install`, then `npm start` in the `desktop` folder.

In the "Settings" tab:

- **Sync** — server address (`http://192.168.x.x:8080`) and the key from `.env`.
- **Blocking** — list of sites and programs (file name, e.g. `Telegram.exe`).
  A program from the list is first asked to close, and if it hasn't closed within a few seconds it is killed, so unsaved work in it may be lost.

## 3. Browser extension

1. Open `chrome://extensions` (in Edge — `edge://extensions`).
2. Turn on "Developer mode".
3. Click "Load unpacked" and choose the `extension` folder.

The extension works only while the PC version is running: it asks it whether focus is on.
An already open tab is blocked as soon as you switch to it, or within 30 seconds.

## 4. Google Calendar

1. In Google Calendar: Settings → your calendar → "Integrate calendar" → "Secret address in iCal format".
2. Paste it into "Settings → Google Calendar" and click "Save on the server".

Today's events appear above the task list. Reading is one-way; recurring events are supported (daily, weekly, monthly by date, yearly).

## 5. Claude

Claude can add and change tasks and habits, set days and times, mark habits and show statistics. It connects to the PC version — no server needed. A ready command for Claude Code and a snippet for Claude Desktop are in the program: "Settings" → "Claude". Details — [docs/installation.md](docs/installation.md#6-claude).

## 6. Android

The installable file is `android/app/build/outputs/apk/debug/app-debug.apk`. It appears after a build (see below). Copy it to the phone and open it, or with the phone connected over USB:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

After installing, in the app's "Settings" tab:

1. **"Choose apps"** — mark what to block during focus (the list is saved when you leave the screen).
2. **"Turn on blocking"** — Android accessibility settings open; turn on "Focus" there.
   On Android 13+ this switch is greyed out at first for apps not from the Play Store: open Focus's "App info" → ⋮ menu → "Allow restricted settings", then repeat.
3. **Sync** — the same server address and key as on the PC.

How it works:

- During a focus session a blocked app is minimised at once and an overlay with the timer appears on top of the screen. "Got it" dismisses it.
- If the session was started on the PC, the phone learns about it from the server — that is, only on the home network.
- The service sees only the name of the app that opened; it does not read screen contents.
- The "Save a backup" and "Restore from backup" buttons don't work in the phone app — use sync instead.

To rebuild the APK after changes, open the `android` folder in Android Studio or run inside it (Java 17+ required):

```bash
gradlew.bat assembleDebug
```

The build picks up the fresh `index.html` from the project root by itself.

## How sync works

Every record carries the time of its last change; on conflict the newer one wins. The app always works with its local copy and syncs when the server is reachable — so everything works away from home, and changes catch up later.

## License

[MIT](LICENSE)

---

# Фокус

[English](#focus) · **Українська**

Система проти прокрастинації: план дня, таймер фокусу, блокування відволікань, синхронізація через власний сервер.

**Детальна документація — у папці [docs](docs/README.md):** посібник користувача, встановлення, будова системи, довідник з API, вирішення проблем. Нижче — коротка шпаргалка.

Інтерфейс є українською та англійською: «Налаштування» → «Оформлення» → «Мова».

| Папка / файл | Що це |
|---|---|
| `index.html` | Сам додаток. Працює локально; із сервером — ще й синхронізується |
| `server/` | Сервер: зберігання даних, читання Google Календаря, підключення до Claude |
| `desktop/` | Версія для ПК: вікно, значок у треї, закривання програм під час фокусу |
| `extension/` | Розширення для Chrome/Edge: блокує сайти під час фокусу |
| `android/` | Додаток для Android: той самий інтерфейс і блокування програм під час фокусу |

## Оформлення, екран фокусу, музика

- У «Налаштуваннях» є три оформлення: «Нуар», «Афіша», «Неон». Вибір запам'ятовується окремо на кожному пристрої.
- Коли стартує сесія, відкривається екран фокусу з нічним містом; місяць «з'їдається» в міру того, як спливає час. Кнопка «Згорнути» повертає до плану, «Екран фокусу» на картці таймера відкриває його знову.
- Кнопка біля платівки вмикає і вимикає музику. Музика генерується на льоту (файлів немає) і зупиняється разом із таймером. Вибір запам'ятовується: якщо музика була ввімкнена, наступна сесія почнеться з нею.
- Заставку при запуску можна пропустити клацанням.

## Нагадування за планом

Коли настає час, указаний у завданні, додаток показує вікно «За планом — зараз» із першим кроком і кнопками: почати фокус, лише 5 хвилин, відкласти на 10 хвилин.

- **ПК:** версія для ПК має бути запущена (хоча б у треї) — вона підніме вікно і покаже сповіщення Windows.
- **Телефон:** сповіщення приходить, навіть якщо додаток закритий; завдання плануються наперед як системні будильники.
- Під час сесії фокусу нагадування не турбують — з'являться після неї, якщо минуло менше години.
- Якщо за завданням сьогодні вже була сесія, нагадування не буде.
- Вимкнути: «Налаштування» → «Таймер і дані».

## 1. Сервер (Linux з Docker)

Скопіюй на сервер папку `Focus` (потрібні `server/`, `index.html`, `Dockerfile`, `docker-compose.yml`, `.env.example`).

```bash
cp .env.example .env
```

Впиши в `.env` свій довгий випадковий ключ у `FOCUS_TOKEN` (згенерувати можна командою `openssl rand -hex 24`), потім:

```bash
docker compose up -d --build
```

Сервер слухає порт 8080. Дані лежать у томі `focus-data`.

Сервер віддає і сам додаток: з телефона в домашній мережі відкрий `http://АДРЕСА-СЕРВЕРА:8080`.

> Сервер працює по HTTP без шифрування — тримай його лише в домашній мережі, не відкривай порт в інтернет.

## 2. Версія для ПК

Готова програма лежить у `dist\Focus\Focus.exe`. Якщо її ще немає (щойно склонований репозиторій) — збери: `npm install`, потім `npm run build` у папці `desktop` (потрібен Node.js). Запускай її з ярлика «Фокус» на робочому столі або з меню «Пуск» — програма створює їх сама при першому запуску.

- Закриття вікна ховає програму в трей; повністю вийти — через меню значка в треї.
- «Налаштування» → «Таймер і дані» → «Запускати разом із Windows»: програма стартуватиме при вході в систему одразу в трей. Без цього нагадування і блокування працюють, лише поки ти запустив її сам.
- Дані зберігаються в `%APPDATA%\Focus`.
- Папку `dist\Focus` не переміщуй: ярлики й автозапуск вказують саме на неї. Якщо перемістив — запусти `Focus.exe` з нового місця, ярлик у «Пуску» оновиться; автозапуск вимкни й увімкни знову.

Після змін у коді програму треба зібрати заново (спершу закрий її через трей):

```bash
cd desktop
```

```bash
npm run build
```

Запуск із коду без збірки, для розробки: `npm install`, потім `npm start` у папці `desktop`.

У вкладці «Налаштування»:

- **Синхронізація** — адреса сервера (`http://192.168.x.x:8080`) і ключ із `.env`.
- **Блокування** — список сайтів і програм (назва файлу, напр. `Telegram.exe`).
  Програму зі списку спершу просять закритися, а якщо вона не закрилась за кілька секунд — закривають примусово, тож незбережене в ній може зникнути.

## 3. Розширення для браузера

1. Відкрий `chrome://extensions` (в Edge — `edge://extensions`).
2. Увімкни «Режим розробника».
3. Натисни «Завантажити розпаковане» і вибери папку `extension`.

Розширення працює, лише коли запущена версія для ПК: воно питає в неї, чи триває фокус.
Уже відкрита вкладка заблокується, щойно ти на неї перемкнешся, або протягом 30 секунд.

## 4. Google Календар

1. У Google Календарі: Налаштування → твій календар → «Інтеграція календаря» → «Таємна адреса у форматі iCal».
2. Встав її в «Налаштування → Google Календар» і натисни «Зберегти на сервері».

Події сьогоднішнього дня з'являться над списком завдань. Читання одностороннє; повторювані події підтримуються (щоденні, щотижневі, щомісячні за числом, щорічні).

## 5. Claude

Claude може додавати й змінювати завдання та звички, ставити дні й час, відмічати звички й показувати статистику. Підключається до програми для ПК — сервер не потрібен. Готова команда для Claude Code і фрагмент для Claude Desktop — у програмі: «Налаштування» → «Claude». Докладно — [docs/installation.md](docs/installation.md#6-claude).

## 6. Android

Готовий файл для встановлення: `android/app/build/outputs/apk/debug/app-debug.apk`. Він з'являється після збірки (див. нижче). Скопіюй його на телефон і відкрий, або з підключеним по USB телефоном:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Після встановлення, у вкладці «Налаштування» додатка:

1. **«Обрати програми»** — познач, що блокувати під час фокусу (список зберігається, коли виходиш з екрана).
2. **«Увімкнути блокування»** — відкриються спеціальні можливості Android; увімкни там «Фокус».
   На Android 13+ для додатків не з Play Store цей перемикач спершу сірий: відкрий «Про додаток» Фокуса → меню ⋮ → «Дозволити обмежені налаштування», тоді повтори.
3. **Синхронізація** — та сама адреса сервера і ключ, що й на ПК.

Як це працює:

- Під час сесії фокусу заблокована програма одразу згортається, а поверх екрана з'являється накладка з таймером. «Зрозуміло» прибирає її.
- Якщо сесію запущено на ПК, телефон дізнається про неї від сервера — тобто лише в домашній мережі.
- Служба бачить тільки назву програми, що відкрилась; вміст екрана вона не читає.
- Кнопки «Зберегти копію даних» і «Відновити з копії» в телефонному додатку не працюють — користуйся синхронізацією.

Щоб зібрати APK заново після змін, відкрий папку `android` в Android Studio або виконай у ній (потрібна Java 17+):

```bash
gradlew.bat assembleDebug
```

Збірка сама бере свіжий `index.html` з кореня проєкту.

## Як влаштована синхронізація

Кожен запис має час останньої зміни; при розбіжності перемагає новіший. Додаток завжди працює з локальною копією і синхронізується, коли сервер доступний, — тож поза домом усе працює, а зміни доїдуть пізніше.

## Ліцензія

[MIT](LICENSE)
