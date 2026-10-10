import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { checkHouse } from "./checks.js";
import type { House, Issue } from "./model.js";

const DEFAULT_SCHEMA_DIR = fileURLToPath(new URL("../../schema/", import.meta.url));

const FILES = {
  settings: "settings.yaml",
  site: "site.yaml",
  enclosures: "enclosures.yaml",
  devices: "devices.yaml",
  cables: "cables.yaml",
  circuits: "circuits.yaml",
  signals: "signals.yaml",
} as const;

type FileKey = keyof typeof FILES;
const REQUIRED: FileKey[] = ["settings", "site"];

let validators: Map<string, ValidateFunction> | undefined;

async function loadValidators(schemaDir: string): Promise<Map<string, ValidateFunction>> {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const map = new Map<string, ValidateFunction>();
  for (const name of [...Object.keys(FILES), "points"]) {
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

function validate(
  validator: ValidateFunction,
  data: unknown,
  label: string,
  issues: Issue[],
): boolean {
  if (validator(data)) return true;
  for (const err of validator.errors ?? []) {
    issues.push({
      severity: "error",
      file: label,
      message: `${err.instancePath || "/"} ${err.message ?? "is invalid"}`,
    });
  }
  return false;
}

/**
 * Loads a HAdoc data folder. Never throws on bad data: every problem lands in
 * `house.issues`, so the app can still show what is valid.
 */
export async function loadHouse(dataDir: string, schemaDir = DEFAULT_SCHEMA_DIR): Promise<House> {
  const v = await loadValidators(schemaDir);
  const issues: Issue[] = [];
  const raw: Partial<Record<FileKey, unknown>> = {};

  for (const [key, file] of Object.entries(FILES) as [FileKey, string][]) {
    const full = path.join(dataDir, file);
    if (!existsSync(full)) {
      if (REQUIRED.includes(key)) issues.push({ severity: "error", file, message: "File is missing" });
      continue;
    }
    const data = await readYaml(full, issues, file);
    if (data !== undefined && validate(v.get(key)!, data, file, issues)) raw[key] = data;
  }

  const points: House["points"] = [];
  const pointsDir = path.join(dataDir, "points");
  if (existsSync(pointsDir)) {
    const files = (await readdir(pointsDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
    for (const f of files) {
      const label = `points/${f}`;
      const data = await readYaml(path.join(pointsDir, f), issues, label);
      if (data === null) continue;
      if (data !== undefined && validate(v.get("points")!, data, label, issues)) {
        points.push(...(data as House["points"]));
      }
    }
  }

  const house: House = {
    settings: (raw.settings as House["settings"]) ?? { ids: { pattern: "{level}-{room}-{type}-{nr}" }, levels: [], types: [] },
    site: (raw.site as House["site"]) ?? { floors: [] },
    points,
    enclosures: (raw.enclosures as House["enclosures"]) ?? [],
    devices: (raw.devices as House["devices"]) ?? [],
    cables: (raw.cables as House["cables"]) ?? [],
    circuits: (raw.circuits as House["circuits"]) ?? [],
    signals: (raw.signals as House["signals"]) ?? [],
    issues,
  };
  house.issues.push(...checkHouse(house));
  return house;
}
