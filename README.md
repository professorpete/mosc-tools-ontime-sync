# Mosc-tools — Ontime Show Flow Sync

Turn a Google Sheet show flow into an [Ontime](https://www.getontime.no/) rundown, preview the
diff, and push it to any Ontime instance — cloud or on your venue's local network.

Runs like [Bitfocus Companion](https://bitfocus.io/companion): download one file, run it, and a
local web app opens in your browser. Because it runs on **your** machine, it can reach Ontime
instances on your LAN (`http://192.168.x.x:4001`) that no hosted tool ever could.

## Download & run (Windows)

1. Download [`MoscToolsOntimeSync.exe`](https://github.com/professorpete/mosc-tools-ontime-sync/raw/windows-download/MoscToolsOntimeSync.exe) (44 MB) — also linked from the
   [latest release](https://github.com/professorpete/mosc-tools-ontime-sync/releases/latest).
2. Double-click it. A console window opens, and your browser opens to
   `http://localhost:5000` automatically.
   - Windows SmartScreen may warn about an unsigned app — choose "More info" → "Run anyway".
   - Keep the console window open while you work; press `Ctrl+C` (or close it) to quit.
3. Click the gear icon (top right), paste your Google Sheet ID and tab name, and fetch.

Your settings and sync history are saved in `%APPDATA%\MoscTools\OntimeSync\data.json` and
survive restarts. Other devices on your network (a stage manager's tablet, for example) can open
the console-printed LAN URL to use the same instance.

- Set `PORT=xxxx` before launching to use a different port.
- Set `NO_OPEN=1` to skip the automatic browser launch.

## What it does

- **Fetch** a published Google Sheet (File → Share → Publish to web, or a link-viewable sheet).
- **Convert** the show flow to an Ontime v4 rundown: cue numbers, start/duration/end times,
  linked starts, colours, timer types — extra columns become Ontime custom fields
  (key = label with spaces as underscores), and a `Notes` column fills Ontime's note field.
- **Preview the diff** against what's already in the target before touching anything.
- **Push** to any number of targets: Ontime Cloud URLs or local instances like
  `http://localhost:4001` / `http://192.168.1.50:4001`. Sync is always manual.
- An Excel template for the expected sheet layout is available in-app
  (`/showflow-template.xlsx`).

## Run from source (macOS / Linux / Windows)

Requires Node 20+.

```bash
git clone https://github.com/professorpete/mosc-tools-ontime-sync.git
cd mosc-tools-ontime-sync
npm start          # the app is prebuilt in dist/ — this just runs it
```

Then open <http://localhost:5000>.

To hack on it: `npm install`, then `npm run dev` (dev server) and `npm run build:full`
(rebuild `dist/`). `npm run build:exe` packages the Windows executable into `release/`
(requires the prebuilt `dist/`).

## Hosting it on a server (optional)

The app also runs fine as a hosted multi-user web app — every browser session gets its own
isolated settings, targets, and history, expiring after 30 idle days (`SESSION_TTL_DAYS` to
change). See [`deploy/DEPLOY.md`](deploy/DEPLOY.md). The one caveat: a hosted copy cannot reach
`192.168.x.x` addresses — that's exactly why the desktop build exists.

## Storage

Plain JSON (`data.json`) — no database server, no native modules.

| Mode | Location |
| --- | --- |
| Windows executable | `%APPDATA%\MoscTools\OntimeSync\data.json` |
| From source / hosted | `./data.json` (override dir with `SHOWFLOW_DATA=/path`) |

## Support

Questions or ideas: [mosc-tools@moscone.ca](mailto:mosc-tools@moscone.ca)

MIT licensed.
