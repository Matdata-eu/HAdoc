// Parser for the CODESYS 2.3 PLC configuration export ("PLC CONFIGURATION.EXP"),
// as written by WAGO-I/O-PRO / CODESYS 2.3 via Project > Export.

import type { Device, Signal } from "../model.js";

export interface WagoChannel {
  index: number;
  symbolicName: string;
  comment: string;
  mode: "I" | "Q";
  address: string;
  section: string;
}

export interface WagoModule {
  /** Order code as exported, e.g. "0750-0403 4 DI 24 V DC 0.2ms". */
  name: string;
  /** The comment, which by convention holds the physical label, e.g. "DI 01". */
  comment: string;
  channels: WagoChannel[];
}

export interface WagoImportOptions {
  /** Device ID of the controller the modules plug into. */
  controller?: string;
  /** Prefix for module device IDs; "plc-" gives "plc-di01". */
  idPrefix?: string;
}

const DEFAULT_COMMENT = /^(Ch_\d+ Digital (input|output)|First Byte of \d+)?$/i;

function unquote(value: string): string {
  const v = value.trim();
  return v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v;
}

/** Reads every module that has channels. Fieldbus and flag sections are skipped. */
export function parseWagoConfig(text: string): WagoModule[] {
  const modules: WagoModule[] = [];
  const stack: { fields: Record<string, string>; channels: WagoChannel[] }[] = [];
  let channel: Record<string, string> | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("_MODULE:")) {
      stack.push({ fields: {}, channels: [] });
    } else if (line === "_END_MODULE") {
      const mod = stack.pop();
      if (mod && mod.channels.length > 0) {
        modules.push({ name: mod.fields._MODULE_NAME ?? "", comment: mod.fields._COMMENT ?? "", channels: mod.channels });
      }
    } else if (line === "_CHANNEL") {
      channel = {};
    } else if (line === "_END_CHANNEL") {
      const mod = stack.at(-1);
      if (channel && mod) {
        mod.channels.push({
          index: Number(channel._INDEX_IN_PARENT ?? mod.channels.length + 1),
          symbolicName: channel._SYMBOLIC_NAME ?? "",
          comment: channel._COMMENT ?? "",
          mode: channel._CHANNEL_MODE === "Q" ? "Q" : "I",
          address: channel._IECADR ?? "",
          section: channel._SECTION_NAME ?? "",
        });
      }
      channel = null;
    } else {
      const m = /^(_[A-Z_]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const target = channel ?? stack.at(-1)?.fields;
      if (target && !(m[1]! in target)) target[m[1]!] = unquote(m[2]!);
    }
  }
  // I/O modules close before the next one opens, so this is already K-bus order.
  return modules;
}

function modelName(orderCode: string): string {
  // "0750-0403 4 DI 24 V DC 0.2ms" -> "WAGO 750-403 4 DI 24 V DC 0.2ms"
  return `WAGO ${orderCode.replace(/^0*(\d+)-0*(\d+)/, "$1-$2")}`.replace(/#\d+/, "");
}

function signalType(module: WagoModule, ch: WagoChannel): string {
  const volts = /(\d+)\s*V\s*DC/i.exec(module.name)?.[1];
  if (ch.section.startsWith("BYTE")) return ch.mode === "I" ? "byte in" : "byte out";
  return `${ch.mode === "I" ? "DI" : "DO"}${volts ? ` ${volts}V` : ""}`;
}

/** Turns the export into HAdoc devices (one per module, with ports) and signals (one per named channel). */
export function wagoToHadoc(modules: WagoModule[], options: WagoImportOptions = {}) {
  const prefix = options.idPrefix ?? "plc-";
  const devices: Device[] = [];
  const signals: Signal[] = [];
  const usedIds = new Set<string>();

  modules.forEach((module, i) => {
    const label = module.comment.trim() || `M${String(i + 1).padStart(2, "0")}`;
    let id = `${prefix}${label.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
    while (usedIds.has(id)) id += "x";
    usedIds.add(id);

    const ports = module.channels.map((ch) => ({ name: `${label}.${ch.index}`, signal: signalType(module, ch) }));
    devices.push({
      id,
      kind: "io-module",
      model: modelName(module.name),
      label,
      ...(options.controller ? { location: options.controller } : {}),
      ports,
      source: "wago",
    });

    for (const ch of module.channels) {
      if (!ch.symbolicName) continue;
      const custom = DEFAULT_COMMENT.test(ch.comment.trim()) ? undefined : ch.comment.trim();
      signals.push({
        id: `PLC-${ch.symbolicName}`,
        ...(custom ? { name: custom } : {}),
        port: `${id}:${label}.${ch.index}`,
        point: null,
        plc: { name: ch.symbolicName, address: ch.address },
        logic: "plc",
        source: "wago",
      });
    }
  });

  return { devices, signals };
}
