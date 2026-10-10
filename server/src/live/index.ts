// Live data from the systems around the house, polled while the app runs and
// matched to the documented devices and signals.

import type { Device, House, Integrations, Issue } from "../model.js";
import { connectMqtt, type MqttNode } from "./mqtt.js";
import { fetchOpenhab, type OpenhabData, type RuleUse } from "./openhab.js";
import { fetchTasmota, type TasmotaStatus } from "./tasmota.js";
import { fetchUnifi, inSubnet, type NetClient } from "./unifi.js";

export interface LiveDevice {
  online?: boolean;
  ip?: string;
  mac?: string;
  firmware?: string;
  /** Which systems said so, e.g. ["unifi", "mqtt"]. */
  from: string[];
}

export interface LiveItem {
  label?: string;
  type: string;
  state?: string;
  rules: RuleUse[];
}

export interface SourceStatus {
  ok: boolean;
  error?: string;
  at?: string;
}

export interface LiveSnapshot {
  sources: Record<string, SourceStatus>;
  /** By HAdoc device ID. */
  devices: Record<string, LiveDevice>;
  /** openHAB items that a signal refers to, by item name. */
  items: Record<string, LiveItem>;
}

const normMac = (mac: string | null | undefined) => mac?.toLowerCase().replace(/-/g, ":");
const env = (name: string | undefined, fallback: string) => process.env[name ?? fallback] || undefined;

export function liveService(house: () => House, options: { fetch?: typeof fetch; log?: (msg: string) => void } = {}) {
  const fetchFn = options.fetch ?? fetch;
  const log = options.log ?? (() => {});

  let config: Integrations = {};
  let configKey = "";
  let timer: NodeJS.Timeout | undefined;
  let mqtt: ReturnType<typeof connectMqtt> | undefined;

  const sources: Record<string, SourceStatus> = {};
  let openhab: OpenhabData | undefined;
  let clients: NetClient[] | undefined;
  const tasmota = new Map<string, TasmotaStatus | null>();

  const done = (name: string, error?: unknown) => {
    sources[name] = { ok: !error, error: error ? (error as Error).message : undefined, at: new Date().toISOString() };
    if (error) log(`${name}: ${(error as Error).message}`);
  };

  async function poll() {
    const tasks: Promise<void>[] = [];
    if (config.openhab) {
      const cfg = config.openhab;
      tasks.push(
        fetchOpenhab(cfg.url, env(cfg.token_env, "HADOC_OPENHAB_TOKEN"), fetchFn).then(
          (data) => ((openhab = data), done("openhab")),
          (err) => done("openhab", err),
        ),
      );
    }
    if (config.unifi) {
      const cfg = config.unifi;
      const key = env(cfg.key_env, "HADOC_UNIFI_KEY");
      if (!key) done("unifi", new Error(`Set ${cfg.key_env ?? "HADOC_UNIFI_KEY"} to an Integration API key`));
      else {
        tasks.push(
          fetchUnifi(cfg, key, fetchFn).then(
            (data) => ((clients = data), done("unifi")),
            (err) => done("unifi", err),
          ),
        );
      }
    }
    if (config.tasmota) {
      const auth = { user: env(config.tasmota.user_env, "HADOC_TASMOTA_USER"), password: env(config.tasmota.password_env, "HADOC_TASMOTA_PASSWORD") };
      const hosts = house().devices.filter((d) => /tasmota/i.test(d.firmware ?? "") && d.hostname);
      tasks.push(
        Promise.all(
          hosts.map((d) =>
            fetchTasmota(d.hostname!, auth, fetchFn).then(
              (s) => void tasmota.set(d.id, s),
              () => void tasmota.set(d.id, null),
            ),
          ),
        ).then(() => {
          const failed = hosts.filter((d) => tasmota.get(d.id) === null).length;
          done("tasmota", failed === hosts.length && hosts.length > 0 ? new Error("No Tasmota device answered") : undefined);
        }),
      );
    }
    await Promise.all(tasks);
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    mqtt?.close();
    mqtt = undefined;
  }

  /** (Re)starts polling when the integrations in settings change. */
  function configure(next: Integrations | undefined) {
    const key = JSON.stringify(next ?? {});
    if (key === configKey) return;
    stop();
    config = next ?? {};
    configKey = key;
    for (const k of Object.keys(sources)) delete sources[k];
    openhab = undefined;
    clients = undefined;
    tasmota.clear();

    if (config.mqtt) {
      mqtt = connectMqtt(
        config.mqtt.url,
        { username: env(config.mqtt.username_env, "HADOC_MQTT_USER"), password: env(config.mqtt.password_env, "HADOC_MQTT_PASSWORD") },
        (msg) => log(`mqtt: ${msg}`),
      );
    }
    if (config.openhab || config.unifi || config.tasmota) {
      void poll();
      timer = setInterval(() => void poll(), (config.poll_seconds ?? 60) * 1000);
      timer.unref();
    }
  }

  function mqttNodes(): MqttNode[] {
    return mqtt ? [...mqtt.nodes.values()] : [];
  }

  /** The live view of each documented device, from every source that knows it. */
  function devices(h: House): Record<string, LiveDevice> {
    const out: Record<string, LiveDevice> = {};
    const add = (d: Device, from: string, patch: Omit<LiveDevice, "from">) => {
      const cur = out[d.id] ?? { from: [] };
      out[d.id] = {
        ...cur,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
        // Any source that sees it online wins over one that does not.
        online: cur.online || patch.online,
        from: [...cur.from, from],
      };
    };
    const byMac = new Map(clients?.map((c) => [c.mac, c]));
    const nodes = mqttNodes();
    for (const d of h.devices) {
      const names = new Set([d.id, d.hostname].filter(Boolean).map((n) => n!.toLowerCase()));
      const mac = normMac(d.mac);
      if (clients) {
        const c = (mac && byMac.get(mac)) || clients.find((c) => c.name && names.has(c.name.toLowerCase()));
        if (c) add(d, "unifi", { online: true, ip: c.ip, mac: c.mac });
        else if (mac) add(d, "unifi", { online: false });
      }
      const t = tasmota.get(d.id);
      if (t) add(d, "tasmota", { online: true, ip: t.ip, mac: t.mac, firmware: t.firmware });
      else if (t === null) add(d, "tasmota", { online: false });
      const n = nodes.find((n) => names.has(n.name.toLowerCase()) || (mac && n.mac === mac));
      if (n) add(d, "mqtt", { online: n.online, ip: n.ip, mac: n.mac });
    }
    return out;
  }

  function snapshot(): LiveSnapshot {
    const h = house();
    const items: Record<string, LiveItem> = {};
    if (openhab) {
      for (const s of h.signals) {
        const name = s.openhab?.item;
        const item = name ? openhab.items.get(name) : undefined;
        if (name && item) items[name] = { label: item.label, type: item.type, state: item.state, rules: openhab.uses.get(name) ?? [] };
      }
    }
    const status = { ...sources };
    if (mqtt) status.mqtt = mqtt.status();
    return { sources: status, devices: devices(h), items };
  }

  /** What the other systems know about that HAdoc does not, and documented devices that are offline. */
  function report(): Issue[] {
    const h = house();
    const issues: Issue[] = [];
    const info = (file: string, id: string, message: string) => issues.push({ severity: "info", file, id, message });

    const live = devices(h);
    for (const d of h.devices) {
      if (live[d.id]?.online === false) {
        issues.push({ severity: "warning", file: "live", id: d.id, message: `Offline according to ${live[d.id]!.from.join(", ")}` });
      }
    }

    if (openhab) {
      const used = new Set(h.signals.map((s) => s.openhab?.item).filter(Boolean));
      for (const item of openhab.items.values()) {
        if (item.channels.length && !used.has(item.name)) {
          info("openHAB", item.name, `${item.label ? `"${item.label}" ` : ""}is linked to ${item.channels[0]} but no signal uses it`);
        }
      }
      for (const s of h.signals) {
        if (s.openhab?.item && !openhab.items.has(s.openhab.item)) {
          issues.push({ severity: "warning", file: "openHAB", id: s.id, message: `Item ${s.openhab.item} does not exist in openHAB` });
        }
      }
    }

    if (clients) {
      const known = new Set(h.devices.map((d) => normMac(d.mac)).filter(Boolean));
      const names = new Set(h.devices.flatMap((d) => [d.id, d.hostname]).filter(Boolean).map((n) => n!.toLowerCase()));
      const subnets = config.unifi?.subnets;
      for (const c of clients) {
        if (c.type === "DEVICE" || known.has(c.mac) || (c.name && names.has(c.name.toLowerCase()))) continue;
        if (subnets?.length && !(c.ip && subnets.some((s) => inSubnet(c.ip!, s)))) continue;
        info("UniFi", c.name ?? c.mac, `${[c.ip, c.mac].filter(Boolean).join(", ")} is on the network but not documented`);
      }
    }

    const names = new Set(h.devices.flatMap((d) => [d.id, d.hostname]).filter(Boolean).map((n) => n!.toLowerCase()));
    const macs = new Set(h.devices.map((d) => normMac(d.mac)).filter(Boolean));
    for (const n of mqttNodes()) {
      if (names.has(n.name.toLowerCase()) || (n.hostname && names.has(n.hostname.toLowerCase())) || (n.mac && macs.has(n.mac))) continue;
      info("MQTT", n.name, `${n.firmware} node${n.ip ? ` at ${n.ip}` : ""} announces itself but is not documented`);
    }

    return issues;
  }

  return {
    configure,
    poll,
    stop,
    snapshot,
    report,
    /** Script source of an openHAB rule, for showing it next to the item. */
    rule: (uid: string) => openhab?.rules.get(uid),
  };
}

export type LiveService = ReturnType<typeof liveService>;

/** ESPHome pins that no signal documents yet. Static, so it works without any live connection. */
export function undocumentedPins(h: House): Issue[] {
  const issues: Issue[] = [];
  for (const d of h.devices) {
    if (d.source !== "esphome") continue;
    for (const p of d.ports ?? []) {
      const ref = `${d.id}:${p.name}`;
      if (h.signals.some((s) => s.port === ref) || h.cables.some((c) => c.from === ref || c.to === ref)) continue;
      issues.push({ severity: "info", file: "ESPHome", id: ref, message: `${p.use ?? "Pin"} is not documented as a signal or cable` });
    }
  }
  return issues;
}
