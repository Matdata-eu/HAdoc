import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { circuitOf } from "../src/circuits.js";
import { indexHouse } from "../src/index-house.js";
import { loadHouse } from "../src/load.js";
import { traceThing } from "../src/trace.js";

const DEMO = fileURLToPath(new URL("../../examples/demo-house/", import.meta.url));

async function demoApp(readOnly = false, gitCommit = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "hadoc-edit-"));
  await cp(DEMO, dir, { recursive: true });
  return { dir, app: await buildApp({ dataDir: dir, readOnly, gitCommit }) };
}

describe("editing from the app", () => {
  it("moves a point and keeps the comments in the file", async () => {
    const { dir, app } = await demoApp();
    const res = await app.inject({ method: "PATCH", url: "/api/points/0-HAL-SW-01", payload: { pos: [55.4, 700.6] } });
    expect(res.statusCode).toBe(200);
    const text = await readFile(path.join(dir, "points/0-ground-floor.yaml"), "utf8");
    expect(text).toContain("pos: [55, 701]");
    expect(text).toContain("# yaml-language-server");
    const house = await app.inject({ url: "/api/house" }).then((r) => r.json());
    expect(house.points.find((p: { id: string }) => p.id === "0-HAL-SW-01").pos).toEqual([55, 701]);
  });

  it("sets and removes a cable route per floor", async () => {
    const { dir, app } = await demoApp();
    let res = await app.inject({
      method: "PUT",
      url: "/api/cables/K-0031/route",
      payload: { level: "0", path: [[20, 20], [150, 20], [150, 250]] },
    });
    expect(res.statusCode).toBe(200);
    let text = await readFile(path.join(dir, "cables.yaml"), "utf8");
    expect(text).toMatch(/id: K-0031[\s\S]*route:\s+- level: "0"\s+path: \[\[20, 20\]/);
    expect(text).toContain("# Cable IDs are the labels on the cables.");

    res = await app.inject({ method: "PUT", url: "/api/cables/K-0031/route", payload: { level: "0", path: null } });
    expect(res.statusCode).toBe(200);
    text = await readFile(path.join(dir, "cables.yaml"), "utf8");
    expect(text).not.toMatch(/id: K-0031[^-]*route:/);
  });

  it("creates a point from an unlinked PLC signal", async () => {
    const { dir, app } = await demoApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/points",
      payload: { type: "SW", level: "0", room: "HAL", name: "Hall switch, right button", signal: "PLC-SM_0_A" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("0-HAL-SW-02");
    expect(res.json().file).toBe("points/0-ground-floor.yaml");

    const signals = await readFile(path.join(dir, "signals.yaml"), "utf8");
    expect(signals).toMatch(/- id: PLC-SM_0_A\n {2}point: 0-HAL-SW-02\n$/);

    const house = await loadHouse(dir);
    expect(house.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(house.signals.find((s) => s.id === "PLC-SM_0_A")).toMatchObject({ point: "0-HAL-SW-02", source: "wago" });
  });

  it("commits each edit when the data folder is a git repository", async () => {
    const { dir, app } = await demoApp(false, true);
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    const res = await app.inject({ method: "PATCH", url: "/api/points/0-KIT-SKT-01", payload: { pos: [690, 25] } });
    expect(res.json().committed).toBe(true);
    expect(git("log", "-1", "--format=%an: %s").trim()).toBe("HAdoc: Move 0-KIT-SKT-01");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("rejects unknown rooms and refuses everything when read-only", async () => {
    const { app } = await demoApp();
    const bad = await app.inject({ method: "POST", url: "/api/points", payload: { type: "SW", level: "0", room: "XXX" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain("XXX");

    const ro = await demoApp(true);
    const res = await ro.app.inject({ method: "PATCH", url: "/api/points/0-HAL-SW-01", payload: { pos: [1, 1] } });
    expect(res.statusCode).toBe(404);
    expect((await ro.app.inject({ url: "/api/house" })).json().editable).toBe(false);
  });
});

describe("circuits and cores", () => {
  it("finds the circuit behind each point, also through a powered_by chain", async () => {
    const house = await loadHouse(DEMO);
    const map = circuitOf(house, indexHouse(house));
    expect(map["0-KIT-SKT-01"]).toBe("F1");
    expect(map["0-HAL-LGT-01"]).toBe("F2");
    // The ESP is powered by the Sonoff, which F3 feeds.
    expect(map["esp-dressing"]).toBe("F3");
    expect(map["1-DRS-ESP-01"]).toBe("F3");
  });

  it("shows a cable on every terminal one of its cores lands on", async () => {
    const house = await loadHouse(DEMO);
    const index = indexHouse(house);
    const di = traceThing(house, index, "plc-di01")!;
    expect(di.ports.find((p) => p.name === "DI 01.2")!.cables.map((c) => c.cable.id)).toEqual(["K-0012"]);
    const x1 = traceThing(house, index, "X1")!;
    expect(x1.cables.map((c) => c.cable.id)).toEqual(["K-0012"]);
    expect(x1.ports.find((p) => p.name === "1")!.cables).toHaveLength(1);
  });
});
