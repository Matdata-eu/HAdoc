# HAdoc

**Home automation documentation.** One phone-friendly web app that answers, for anything in the house: *what is this, where does it get power, how is it wired, and what controls it?*

HAdoc keeps floor plans, cabling, power circuits, controller I/O (PLC channels, ESP pins) and the link to your home automation software in one place, as plain YAML files you keep in git.

> Status: early. The viewer, data format, validation, trace, editing in the app, the WAGO and ESPHome imports and the live connections to openHAB, UniFi, Tasmota and MQTT work; the PLC logic viewer and the AREI diagrams are on the [roadmap](#roadmap).

## What you get

- **Floor plan** per level, with rooms, points and cable routes. Pinch and drag on a phone, scroll and drag on a desktop.
- **Layers** for power, automation, data, hidden things and cables, and **colour by circuit** to see what each breaker feeds.
- **Cores and terminals**: list the cores of a cable and the terminal each one lands on; the cable then shows up on every port it touches.
- **Edit mode**: drag points, place new ones, draw cable routes and link PLC channels to points. Edits are written back into your YAML files (comments and layout kept) and can be committed to git.
- **Tap anything** to see its trace: the circuit and breaker that feed it, the cables and terminals it lands on, the device or PLC channel behind it, and the MQTT topic or openHAB item that reads it.
- **Live status** from UniFi, Tasmota and MQTT: online or offline and the IP address of every documented device.
- **openHAB**: the current state of each item and the rules that use it (by trigger, group trigger or in the script), with the script one tap away.
- **"Not documented yet"** report: openHAB items linked to a channel that no signal uses, unknown clients on your IoT subnet, Tasmota and ESPHome nodes on MQTT, and ESPHome pins without a signal.
- **"If it stops working"** notes in plain language, for everyone in the house.
- **Checks** that flag broken references, IDs that don't follow your scheme, and what is still undocumented.
- **Search** by room, ID, device, PLC name or openHAB item.
- Installs on a phone home screen and keeps showing the last copy when the server is down.

## Quick start

```bash
docker run -d --name hadoc -p 8090:8080 -v "$PWD/house:/data" ghcr.io/matdata-eu/hadoc:latest
```

Open http://localhost:8090. Without a volume the image shows the demo house from [`examples/demo-house`](examples/demo-house). See [`docker-compose.yml`](docker-compose.yml) for a compose example.

To run from source (Node 22):

```bash
npm install
npm run build
node server/dist/index.js examples/demo-house
```

For development, run `npm run dev -w server` and `npm run dev -w web` in two terminals and open the Vite URL.

## Your data

Copy [`examples/demo-house`](examples/demo-house) into its own (private) git repo and edit the YAML. Every file has a JSON Schema in [`schema/`](schema); the `# yaml-language-server` line at the top of each file gives completion and validation in VS Code with the YAML extension.

| File | Holds |
| --- | --- |
| `settings.yaml` | House name, the **point ID pattern** and the **level and type abbreviations** |
| `site.yaml` | Floors and rooms, in centimetres, with an optional plan image as tracing underlay |
| `points/*.yaml` | Switches, sensors, lights, sockets, hidden boards: anything you can touch |
| `enclosures.yaml` | Distribution boards, PLC cabinets, racks |
| `devices.yaml` | PLC and I/O modules, ESP boards, relays, breakers, with their ports |
| `cables.yaml` | Cables by the label on the cable, their ends and route |
| `circuits.yaml` | Breaker circuits and what they feed |
| `signals.yaml` | Where software sees a port: PLC name and address, MQTT topic, openHAB item |

Every list can also be split over a folder: `devices.yaml` and `devices/*.yaml` are read together, like `points/`.

Cable and circuit ends are written as a point or device ID, or as `device:port` (for example `plc-di01:DI 01.1`). Plan images go in `plans/`, photos in `photos/`.

### Point IDs

The default pattern is `{level}-{room}-{type}-{nr}`, for example `1-DRS-PIR-01`. The pattern and every abbreviation are settings:

```yaml
ids:
  pattern: "{level}-{room}-{type}-{nr}"
  nr_digits: 2
levels:
  - { code: MIN1, name: Basement }
  - { code: "0", name: Ground floor }
types:
  - { code: PIR, name: Motion sensor, layer: automation }
```

Room codes are defined per floor in `site.yaml`.

### Importing the WAGO PLC configuration

HAdoc reads the CODESYS 2.3 (WAGO-I/O-PRO) PLC configuration export directly, so the PLC side never has to be typed in:

1. In CODESYS, open the PLC configuration and choose **Project > Export**. Save it in your data folder, e.g. `imports/plc-configuration.exp`.
2. Point `settings.yaml` at it:

   ```yaml
   imports:
     wago:
       config: imports/plc-configuration.exp
       controller: plc     # device ID of the PLC, optional
       id_prefix: plc-     # optional, the default
   ```

Each I/O module becomes a device named after its comment (`DI 01` becomes `plc-di01`), with one port per channel (`DI 01.1` to `DI 01.4`). Each channel with a symbolic name becomes a signal `PLC-<name>` with its IEC address; a real channel comment becomes the signal's name. Channels without a name show as spare ports.

The export is read on every load, so re-exporting after a change in CODESYS updates HAdoc. To add something to an imported record, write an entry with the same ID; its fields are laid over the import:

```yaml
# signals.yaml
- id: PLC-SB_0_1L
  name: Hall switch
  point: 0-HAL-SW-01
```

Imported signals that are not linked to a point yet are listed under "To check".

### Importing ESPHome configs

Point `imports.esphome.dir` at the ESPHome config folder (mount it into the container, e.g. `-v /opt/esphome/config:/esphome:ro`). Each node becomes a device with its node name as ID, and every pin the config uses becomes a port with what it is used for. Add the location, MAC and power in `devices.yaml` under the same ID.

```yaml
imports:
  esphome:
    dir: /esphome
```

### Live connections

```yaml
integrations:
  poll_seconds: 60
  openhab: { url: "http://192.168.2.31:8080" }
  unifi: { url: "https://unifi.example.com", subnets: [192.168.20.0/24] }
  tasmota: {}
  mqtt: { url: "mqtt://192.168.2.9:1883" }
```

| Source | What it adds | Secret (environment variable) |
| --- | --- | --- |
| openHAB | Item state, the rules that use an item, items no signal uses | `HADOC_OPENHAB_TOKEN`, an API token (optional when anonymous access is allowed) |
| UniFi | Online and IP by MAC address (or by name), unknown clients | `HADOC_UNIFI_KEY`, an Integration API key from Settings > Control Plane > Integrations |
| Tasmota | Online, IP, MAC and firmware of every device with `firmware: Tasmota` and a `hostname` | `HADOC_TASMOTA_USER`, `HADOC_TASMOTA_PASSWORD` when a web password is set |
| MQTT | Tasmota (LWT, discovery) and ESPHome (`<node>/status`) nodes that announce themselves | `HADOC_MQTT_USER`, `HADOC_MQTT_PASSWORD` |

Each source can name another variable with `token_env`, `key_env`, `user_env`/`password_env` or `username_env`/`password_env`. For UniFi OS consoles set `api_path: /proxy/network/integration/v1`. A source that fails shows its error in `GET /api/live`; the plan keeps working without it.

### Validate

```bash
node server/dist/cli.js validate path/to/house
```

Errors (broken references, schema violations, IDs that contradict their fields) exit with code 1, so this works as a pre-commit hook or CI step in your data repo. Warnings list what is still undocumented.

## Editing in the app

Tap **Edit** in the top bar. Then you can:

- drag a point to move it, or use **Place on the plan** for a point that has no position yet;
- open a cable from a point or device and tap **Draw route**, then tap its corners on the plan (tapping a point snaps to it);
- link an unlinked PLC channel to a point from the device's port list, or create the point there and place it.

Edits go into the hand-written file that holds the record; imported records get an overlay entry in `signals.yaml`. New points go into the file that already has points of that level, else `points.yaml`. The number is the next free one for that level, room and type.

| Variable | Effect |
| --- | --- |
| `HADOC_READONLY=1` | Turns editing off; the Edit button disappears. |
| `HADOC_GIT_COMMIT=1` | Commits every edit to the git repository in the data folder, as `HAdoc <hadoc@localhost>` unless `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` are set. |

In Docker the app runs as uid 1000, so the data folder must be writable for that user. There is no login yet: anyone who can reach the app can edit, so keep it on your LAN or behind your reverse proxy's authentication, or set `HADOC_READONLY=1`.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/house` | All data plus error and warning counts |
| `GET /api/trace/:id` | The trace for a point, device or enclosure |
| `GET /api/issues` | Every error and warning, and what is not documented yet (`info`) |
| `GET /api/health` | Liveness and when the data was last loaded |
| `GET /api/live` | Status per source, live data per device, state and rules per openHAB item |
| `GET /api/live/rules/:uid` | The script of an openHAB rule |
| `PATCH /api/points/:id` | Move a point: `{ "pos": [x, y] }` or `{ "pos": null }` |
| `POST /api/points` | New point: `{ type, level, room, name?, pos?, signal? }`; `signal` links that signal to it |
| `PUT /api/cables/:id/route` | Route on one floor: `{ level, path: [[x, y], …] }`, or `path: null` to remove it |
| `PATCH /api/signals/:id` | Link a signal to a point: `{ "point": "0-HAL-SW-01" }` or `null` |

The server reloads the data when files in the data folder change.

## Roadmap

1. **MVP**: plan underlay, rooms, points, point pages, trace, checks *(done)*.
2. **WAGO import** from the CODESYS 2.3 PLC configuration export *(done)*.
3. **Cables and circuits**: drawing routes, terminals and cores, breaker colouring, editing in the app with git commits *(done)*.
4. **Importers**: openHAB, UniFi (status and IP), ESPHome, Tasmota, MQTT, plus the "undocumented" report and the rules behind each item *(done)*.
5. **PLC logic viewer** from POU exports, wall and enclosure views, QR labels.
6. **AREI** single-line diagram (eendraadschema) and situation sketch (situatieschets).
7. Importers for other systems (Home Assistant, KNX, Loxone, Shelly).

## Project layout

```
schema/     JSON Schemas for every data file
server/     Fastify API, YAML loader, checks, trace, CLI (TypeScript)
web/        Svelte app: floor plan, details, issues
examples/   Demo house
```

## License

[MIT](LICENSE)
