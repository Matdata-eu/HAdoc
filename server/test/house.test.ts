import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { idScheme } from "../src/ids.js";
import { indexHouse } from "../src/index-house.js";
import { loadHouse } from "../src/load.js";
import { traceThing } from "../src/trace.js";

const DEMO = fileURLToPath(new URL("../../examples/demo-house/", import.meta.url));

async function demoCopy(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "hadoc-"));
  await cp(DEMO, dir, { recursive: true });
  return dir;
}

describe("id scheme", () => {
  const scheme = idScheme({
    ids: { pattern: "{level}-{room}-{type}-{nr}", nr_digits: 2 },
    levels: [],
    types: [],
  });

  it("parses and formats", () => {
    expect(scheme.parse("MIN1-GAR-SW-03")).toEqual({ level: "MIN1", room: "GAR", type: "SW", nr: "03" });
    expect(scheme.format({ level: "1", room: "DRS", type: "PIR", nr: 1 })).toBe("1-DRS-PIR-01");
  });

  it("rejects IDs that do not follow the pattern", () => {
    expect(scheme.parse("1-DRS-PIR-1")).toBeNull();
    expect(scheme.parse("DRS-PIR-01")).toBeNull();
  });

  it("supports a custom pattern", () => {
    const custom = idScheme({ ids: { pattern: "{room}.{type}{nr}@{level}", nr_digits: 3 }, levels: [], types: [] });
    expect(custom.parse("KIT.SKT007@0")).toEqual({ level: "0", room: "KIT", type: "SKT", nr: "007" });
  });
});

describe("demo house", () => {
  it("loads without errors", async () => {
    const house = await loadHouse(DEMO);
    const errors = house.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(house.points.length).toBeGreaterThan(0);
  });

  it("warns about what is still undocumented", async () => {
    const house = await loadHouse(DEMO);
    const warnings = house.issues.filter((i) => i.severity === "warning").map((i) => `${i.id}: ${i.message}`);
    expect(warnings).toContain("K-0107: Cable type is unknown");
    expect(warnings).toContain("esp-dressing: No MAC address, so network status cannot be matched");
  });

  it("traces the dressing room motion sensor to its ESP, power and signal", async () => {
    const house = await loadHouse(DEMO);
    const trace = traceThing(house, indexHouse(house), "1-DRS-PIR-01")!;

    expect(trace.cables.map((c) => [c.cable.id, c.there?.id, c.there?.port])).toEqual([
      ["K-0107", "esp-dressing", "GPIO14"],
    ]);
    expect(trace.signals.map((s) => s.openhab?.item)).toEqual(["Dressing_Motion"]);
  });

  it("follows the power path of a hidden device", async () => {
    const house = await loadHouse(DEMO);
    const trace = traceThing(house, indexHouse(house), "1-DRS-ESP-01")!;

    expect(trace.contains.map((c) => c.id)).toEqual(["esp-dressing"]);
    expect(trace.poweredBy.map((p) => p.id)).toEqual(["sonoff-mirror"]);
    expect(trace.circuits.map((c) => c.id)).toEqual(["F3"]);
  });
});

describe("checks", () => {
  it("reports broken references and IDs that contradict their fields", async () => {
    const dir = await demoCopy();
    const cables = path.join(dir, "cables.yaml");
    await writeFile(cables, (await readFile(cables, "utf8")).replace('"plc-di01:DI 01.1"', '"plc-di01:DI 09.9"'));
    const points = path.join(dir, "points/0-ground-floor.yaml");
    await writeFile(points, (await readFile(points, "utf8")).replace("id: 0-KIT-SKT-01", "id: 0-HAL-SKT-01"));

    const house = await loadHouse(dir);
    const errors = house.issues.filter((i) => i.severity === "error").map((i) => `${i.id}: ${i.message}`);
    expect(errors).toContain('K-0012: to: device "plc-di01" has no port "DI 09.9"');
    expect(errors).toContain("0-HAL-SKT-01: ID says room HAL, but room is KIT");
  });

  it("reports schema errors with the file name", async () => {
    const dir = await demoCopy();
    await writeFile(path.join(dir, "circuits.yaml"), "- id: F9\n");

    const house = await loadHouse(dir);
    expect(house.issues).toContainEqual(
      expect.objectContaining({ severity: "error", file: "circuits.yaml", message: "/0 must have required property 'feeds'" }),
    );
  });
});

describe("api", () => {
  it("serves the house and a trace", async () => {
    const app = await buildApp({ dataDir: DEMO });
    const house = await app.inject({ url: "/api/house" });
    expect(house.statusCode).toBe(200);
    expect(house.json().issueCount.errors).toBe(0);

    const trace = await app.inject({ url: "/api/trace/0-HAL-SW-01" });
    expect(trace.json().signals[0].plc).toEqual({ name: "SB_0_1L", address: "%IX4.0" });

    const missing = await app.inject({ url: "/api/trace/nope" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
