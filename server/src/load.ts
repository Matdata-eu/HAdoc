import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { checkHouse } from "./checks.js";
import { runImports } from "./importers/index.js";
import type { Device, House, Issue } from "./model.js";

const DEFAULT_SCHEMA_DIR = fileURLToPath(new URL("../../schema/", import.meta.url));

/** Single-object files. */
const OBJECTS = ["settings", "site"] as const;
/**
 * List files. Each is read from `<name>.yaml` and from every `<name>/*.yaml`,
 * so a big house can split them up (points per floor, devices per cabinet).
 */
const LISTS = ["points", "enclosures", "devices", "cables", "circuits", "signals"] as const;

type ListKey = (typeof LISTS)[number];

let validators: Map<string, ValidateFunction> | undefined;

async function loadValidators(schemaDir: string): Promise<Map<string, ValidateFunction>> {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const map = new Map<string, ValidateFunction>();
  for (const name of [...OBJECTS, ...LISTS]) {
    const schema = JSON.parse(await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"));
    map.set(name, ajv.compile(schema));
  }
  validators = map;
  return map;
}

async function readYaml(file: string, issues: Issue[], label: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(file, "utf8")) ?? null;
  } catch (err) {
    issues.push({ severity: "error", file: label, message: `Cannot parse YAML: ${(err as Error).message}` });
    return undefined;
  }
}

function validate(validator: ValidateFunction, data: unknown, label: string, issues: Issue[]): boolean {
  if (validator(data)) return true;
  for (const err of validator.errors ?? []) {
    issues.push({ severity: "error", file: label, message: `${err.instancePath || "/"} ${err.message ?? "is invalid"}` });
  }
  return false;
}

/** The files a list is read from, relative to the data folder, in load order. */
async function listFiles(dataDir: string, name: ListKey): Promise<string[]> {
  const files: string[] = [];
  if (existsSync(path.join(dataDir, `${name}.yaml`))) files.push(`${name}.yaml`);
  const dir = path.join(dataDir, name);
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort()) files.push(`${name}/${f}`);
  }
  return files;
}

/**
 * Hand-written records win over imported ones with the same ID: their fields are
 * laid over the imported record, so you can add a location or a note to an
 * imported PLC module without copying it.
 */
function overlay<T extends { id: string }>(imported: T[], written: T[], merge = (base: T, over: T): T => ({ ...base, ...over })): T[] {
  const byId = new Map(imported.map((item) => [item.id, item]));
  const result = [...imported];
  for (const item of written) {
    const base = byId.get(item.id);
    if (base) result[result.indexOf(base)] = merge(base, item);
    else result.push(item);
  }
  return result;
}

/** Ports are matched by name, so a hand-written device can annotate one port without dropping the others. */
function mergeDevice(base: Device, over: Device): Device {
  if (!over.ports || !base.ports) return { ...base, ...over };
  const ports = base.ports.map((p) => ({ ...p, ...over.ports!.find((o) => o.name === p.name) }));
  for (const p of over.ports) if (!ports.some((q) => q.name === p.name)) ports.push(p);
  return { ...base, ...over, ports };
}

/**
 * Loads a HAdoc data folder. Never throws on bad data: every problem lands in
 * `house.issues`, so the app can still show what is valid.
 */
export async function loadHouse(dataDir: string, schemaDir = DEFAULT_SCHEMA_DIR): Promise<House> {
  const v = await loadValidators(schemaDir);
  const issues: Issue[] = [];

  const objects: Partial<Record<(typeof OBJECTS)[number], unknown>> = {};
  for (const key of OBJECTS) {
    const file = `${key}.yaml`;
    const full = path.join(dataDir, file);
    if (!existsSync(full)) {
      issues.push({ severity: "error", file, message: "File is missing" });
      continue;
    }
    const data = await readYaml(full, issues, file);
    if (data !== undefined && validate(v.get(key)!, data, file, issues)) objects[key] = data;
  }

  const lists = Object.fromEntries(LISTS.map((k) => [k, [] as unknown[]])) as Record<ListKey, unknown[]>;
  for (const key of LISTS) {
    for (const file of await listFiles(dataDir, key)) {
      const data = await readYaml(path.join(dataDir, file), issues, file);
      if (data === null || data === undefined) continue;
      if (validate(v.get(key)!, data, file, issues)) lists[key].push(...(data as unknown[]));
    }
  }

  const settings = (objects.settings as House["settings"]) ?? {
    ids: { pattern: "{level}-{room}-{type}-{nr}" },
    levels: [],
    types: [],
  };
  const imported = await runImports(dataDir, settings, issues);

  const house: House = {
    settings,
    site: (objects.site as House["site"]) ?? { floors: [] },
    points: lists.points as House["points"],
    enclosures: lists.enclosures as House["enclosures"],
    devices: overlay(imported.devices, lists.devices as House["devices"], mergeDevice),
    cables: lists.cables as House["cables"],
    circuits: lists.circuits as House["circuits"],
    signals: overlay(imported.signals, lists.signals as House["signals"]),
    issues,
  };
  house.issues.push(...checkHouse(house));
  return house;
}
