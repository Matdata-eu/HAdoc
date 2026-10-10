import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Device, Issue, Settings, Signal } from "../model.js";
import { parseWagoConfig, wagoToHadoc } from "./wago.js";

/** Runs the file imports configured in settings.imports. */
export async function runImports(dataDir: string, settings: Settings, issues: Issue[]) {
  const devices: Device[] = [];
  const signals: Signal[] = [];

  const wago = settings.imports?.wago;
  if (wago) {
    const file = path.join(dataDir, wago.config);
    if (!existsSync(file)) {
      issues.push({ severity: "error", file: "settings.yaml", message: `imports.wago.config: ${wago.config} does not exist` });
    } else {
      // CODESYS 2.3 writes Windows-1252; latin1 decodes it without loss for the characters it uses.
      const modules = parseWagoConfig(await readFile(file, "latin1"));
      if (modules.length === 0) {
        issues.push({ severity: "error", file: wago.config, message: "No I/O modules found; is this a PLC configuration export?" });
      }
      const result = wagoToHadoc(modules, { controller: wago.controller, idPrefix: wago.id_prefix });
      devices.push(...result.devices);
      signals.push(...result.signals);
    }
  }

  return { devices, signals };
}
