// Reads ESPHome node configs and turns every pin they use into a device port.

import { parse } from "yaml";
import type { Device } from "../model.js";

export interface EsphomePin {
  pin: string;
  /** What uses it, e.g. "binary_sensor/gpio: Motion" or "i2c: sda". */
  use: string;
}

export interface EsphomeNode {
  name: string;
  board?: string;
  platform?: string;
  pins: EsphomePin[];
}

/** Top-level keys that never hold pins of their own. */
const SKIP = new Set(["esphome", "substitutions", "packages", "wifi", "api", "ota", "logger", "web_server", "captive_portal", "mqtt", "time"]);
const PLATFORMS = ["esp8266", "esp32", "rp2040", "bk72xx", "rtl87xx", "libretiny"];
const PIN_KEY = /^(pin|.*_pin|sda|scl|pin_[a-z])$/;

function substitute(value: string, subs: Record<string, string>): string {
  return value.replace(/\$\{?([A-Za-z0-9_]+)\}?/g, (m, key: string) => subs[key] ?? m);
}

function pinName(value: unknown, subs: Record<string, string>): string | null {
  if (typeof value === "string" || typeof value === "number") return substitute(String(value), subs);
  if (value && typeof value === "object" && "number" in value) return pinName((value as { number: unknown }).number, subs);
  return null;
}

/** Parses one node config. Returns null for files that are not a node (secrets, packages). */
export function parseEsphomeNode(text: string): EsphomeNode | null {
  // !secret, !include and !lambda are custom tags; unknown tags parse as plain strings.
  const doc = parse(text, { logLevel: "silent" }) as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object" || !doc.esphome) return null;
  const subs = Object.fromEntries(
    Object.entries((doc.substitutions as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]),
  );
  const esphome = doc.esphome as Record<string, unknown>;
  const name = substitute(String(esphome.name ?? ""), subs);
  if (!name) return null;

  const platform = PLATFORMS.find((p) => p in doc);
  const board = platform ? (doc[platform] as Record<string, unknown> | null)?.board : esphome.board;

  const pins: EsphomePin[] = [];
  const walk = (node: unknown, component: string, label: string) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, component, label);
      return;
    }
    if (!node || typeof node !== "object") return;
    const entry = node as Record<string, unknown>;
    const what = [component + (entry.platform ? `/${String(entry.platform)}` : ""), entry.name ?? entry.id ?? label]
      .filter(Boolean)
      .map((p) => substitute(String(p), subs));
    for (const [key, value] of Object.entries(entry)) {
      if (PIN_KEY.test(key)) {
        const pin = pinName(value, subs);
        if (pin) pins.push({ pin, use: key === "pin" ? what.join(": ") : `${what.join(": ")} (${key})` });
      } else if (typeof value === "object") {
        walk(value, component, label);
      }
    }
  };
  for (const [key, value] of Object.entries(doc)) {
    if (SKIP.has(key) || PLATFORMS.includes(key)) continue;
    walk(value, key, "");
  }
  return { name, board: board ? String(board) : undefined, platform, pins };
}

export function esphomeToHadoc(nodes: EsphomeNode[]): Device[] {
  return nodes.map((node) => {
    const ports = new Map<string, string>();
    for (const p of node.pins) ports.set(p.pin, ports.has(p.pin) ? `${ports.get(p.pin)}; ${p.use}` : p.use);
    return {
      id: node.name,
      kind: "esp",
      firmware: "ESPHome",
      hostname: node.name,
      ...(node.board ? { model: node.board } : {}),
      ports: [...ports].map(([name, use]) => ({ name, signal: "GPIO", use })),
      source: "esphome",
    };
  });
}
