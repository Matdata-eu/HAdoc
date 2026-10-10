import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWagoConfig, wagoToHadoc } from "../src/importers/wago.js";
import { indexHouse } from "../src/index-house.js";
import { loadHouse } from "../src/load.js";
import { traceThing } from "../src/trace.js";

const DEMO = fileURLToPath(new URL("../../examples/demo-house/", import.meta.url));
const EXPORT = new URL("../../examples/demo-house/imports/plc-configuration.exp", import.meta.url);

describe("WAGO PLC configuration import", () => {
  it("reads every I/O module with its channels", async () => {
    const modules = parseWagoConfig(await readFile(EXPORT, "latin1"));
    expect(modules.map((m) => [m.comment, m.channels.length])).toEqual([
      ["DI 01", 4],
      ["DO 01", 4],
    ]);
    expect(modules[0]!.channels[0]).toMatchObject({ symbolicName: "SB_0_1L", address: "%IX4.0", mode: "I" });
  });

  it("makes a device per module and a signal per named channel", async () => {
    const { devices, signals } = wagoToHadoc(parseWagoConfig(await readFile(EXPORT, "latin1")), { controller: "plc" });

    expect(devices[0]).toMatchObject({
      id: "plc-di01",
      model: "WAGO 750-403 4 DI 24 V DC 0.2ms",
      label: "DI 01",
      location: "plc",
      ports: [
        { name: "DI 01.1", signal: "DI 24V" },
        { name: "DI 01.2", signal: "DI 24V" },
        { name: "DI 01.3", signal: "DI 24V" },
        { name: "DI 01.4", signal: "DI 24V" },
      ],
    });
    // The fourth channel of each module has no name, so it is a spare port without a signal.
    expect(signals.map((s) => s.id)).toEqual([
      "PLC-SB_0_1L",
      "PLC-SB_0_1R",
      "PLC-SM_0_A",
      "PLC-R_0_HAL",
      "PLC-R_1_BED_UP",
      "PLC-R_1_BED_DN",
    ]);
    // Default CODESYS comments are dropped; real ones become the signal name.
    expect(signals[0]!.name).toBeUndefined();
    expect(signals[2]).toMatchObject({ name: "Voordeur", port: "plc-di01:DI 01.3", plc: { address: "%IX4.2" } });
  });

  it("lets hand-written entries add to imported ones", async () => {
    const house = await loadHouse(DEMO);
    const hall = house.signals.find((s) => s.id === "PLC-SB_0_1L");
    expect(hall).toMatchObject({ name: "Hall switch", point: "0-HAL-SW-01", port: "plc-di01:DI 01.1", source: "wago" });

    const trace = traceThing(house, indexHouse(house), "plc-do01")!;
    expect(trace.ports.map((p) => [p.name, p.signals.map((s) => s.point)])).toEqual([
      ["DO 01.1", ["0-HAL-LGT-01"]],
      ["DO 01.2", ["1-BED-BLD-01"]],
      ["DO 01.3", ["1-BED-BLD-01"]],
      ["DO 01.4", []],
    ]);
  });

  it("reports a missing export file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hadoc-"));
    await cp(DEMO, dir, { recursive: true });
    const settings = path.join(dir, "settings.yaml");
    await writeFile(settings, (await readFile(settings, "utf8")).replace("imports/plc-configuration.exp", "imports/gone.exp"));

    const house = await loadHouse(dir);
    expect(house.issues).toContainEqual(
      expect.objectContaining({ severity: "error", message: "imports.wago.config: imports/gone.exp does not exist" }),
    );
  });
});
