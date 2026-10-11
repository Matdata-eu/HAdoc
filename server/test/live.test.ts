import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { esphomeToHadoc, parseEsphomeNode } from "../src/importers/esphome.js";
import { observe, type MqttNode } from "../src/live/mqtt.js";
import { inSubnet } from "../src/live/unifi.js";

const DEMO = fileURLToPath(new URL("../../examples/demo-house/", import.meta.url));

// What the systems on the LAN answer, as recorded from their APIs.
const FIXTURES: Record<string, unknown> = {
  "http://openhab.test/rest/items?recursive=false&fields=name,label,type,state,groupNames": [
    { name: "Dressing_Motion", label: "Dressing motion", type: "Switch", state: "OFF", groupNames: ["gMotion"] },
    { name: "Hall_Light", label: "Hall light", type: "Switch", state: "ON", groupNames: [] },
    { name: "Away_Mode", label: "Away", type: "Switch", state: "OFF", groupNames: [] },
  ],
  "http://openhab.test/rest/links": [
    { itemName: "Dressing_Motion", channelUID: "mqtt:topic:broker:dressing:motion" },
    { itemName: "Hall_Light", channelUID: "modbus:data:plc:hall" },
  ],
  "http://openhab.test/rest/rules": [
    { uid: "r1", name: "Dressing light on motion", triggers: [{ configuration: { itemName: "Dressing_Motion" } }], actions: [] },
    {
      uid: "r2",
      name: "Night mode",
      triggers: [{ configuration: { itemName: "Away_Mode" } }],
      actions: [{ configuration: { script: 'if (Dressing_Motion.state == ON) { logInfo("x", "y") }' } }],
    },
    { uid: "r3", name: "Any motion", triggers: [{ configuration: { groupName: "gMotion" } }], actions: [] },
  ],
  "https://unifi.test/integration/v1/sites?offset=0&limit=200": {
    offset: 0, count: 1, totalCount: 1, data: [{ id: "s1", internalReference: "default", name: "Default" }],
  },
  "https://unifi.test/integration/v1/sites/s1/clients?offset=0&limit=200": {
    offset: 0, count: 3, totalCount: 3,
    data: [
      { type: "WIRELESS", name: "esp-dressing", ipAddress: "192.168.20.41", macAddress: "A4:CF:12:00:00:01" },
      { type: "WIRELESS", name: "shelly1-ab12", ipAddress: "192.168.20.55", macAddress: "C4:5B:BE:00:00:02" },
      { type: "WIRELESS", name: "phone", ipAddress: "192.168.1.10", macAddress: "11:22:33:44:55:66" },
    ],
  },
  "https://unifi.test/integration/v1/sites/s1/devices?offset=0&limit=200": { offset: 0, count: 0, totalCount: 0, data: [] },
  "http://sonoff-mirror/cm?cmnd=Status+0": {
    Status: { DeviceName: "Mirror", Topic: "sonoff-mirror" },
    StatusFWR: { Version: "14.2.0(release-tasmota)" },
    StatusNET: { IPAddress: "192.168.20.30", Mac: "DC:4F:22:00:00:03" },
  },
};

const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const key = String(url);
  if (key.startsWith("https://unifi.test") && (init?.headers as Record<string, string>)["x-api-key"] !== "secret") {
    return new Response("{}", { status: 401, statusText: "Unauthorized" });
  }
  if (!(key in FIXTURES)) return new Response("{}", { status: 404, statusText: `No fixture for ${key}` });
  return new Response(JSON.stringify(FIXTURES[key]), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function liveDemo() {
  const dir = await mkdtemp(path.join(tmpdir(), "hadoc-live-"));
  await cp(DEMO, dir, { recursive: true });
  const settings = await readFile(path.join(dir, "settings.yaml"), "utf8");
  await writeFile(
    path.join(dir, "settings.yaml"),
    `${settings}
integrations:
  openhab: { url: http://openhab.test }
  unifi: { url: https://unifi.test, subnets: [192.168.20.0/24] }
  tasmota: {}
`,
  );
  process.env.HADOC_UNIFI_KEY = "secret";
  const app = await buildApp({ dataDir: dir, fetch: fakeFetch });
  // The first poll starts on load; wait for it.
  for (let i = 0; i < 50; i++) {
    const live = (await app.inject({ url: "/api/live" })).json();
    if (live.sources.openhab && live.sources.unifi && live.sources.tasmota) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return app;
}

describe("live integrations", () => {
  it("matches network, Tasmota and openHAB data to the documented house", async () => {
    const app = await liveDemo();
    const live = (await app.inject({ url: "/api/live" })).json();
    expect(live.sources).toMatchObject({ openhab: { ok: true }, unifi: { ok: true }, tasmota: { ok: true } });
    expect(live.devices["esp-dressing"]).toMatchObject({ online: true, ip: "192.168.20.41", from: ["unifi"] });
    expect(live.devices["sonoff-mirror"]).toMatchObject({ online: true, ip: "192.168.20.30", firmware: "Tasmota 14.2.0(release-tasmota)" });
    expect(live.items.Dressing_Motion.state).toBe("OFF");
    expect(live.items.Dressing_Motion.rules).toEqual([
      { uid: "r1", name: "Dressing light on motion", how: "trigger" },
      { uid: "r2", name: "Night mode", how: "script" },
      { uid: "r3", name: "Any motion", how: "group trigger" },
    ]);
    const rule = (await app.inject({ url: "/api/live/rules/r2" })).json();
    expect(rule.script).toContain("Dressing_Motion.state");
    await app.close();
  });

  it("reports what the other systems know and HAdoc does not", async () => {
    const app = await liveDemo();
    const issues = (await app.inject({ url: "/api/issues" })).json() as { severity: string; file: string; id: string; message: string }[];
    const info = issues.filter((i) => i.severity === "info").map((i) => `${i.file} ${i.id}: ${i.message}`);
    expect(info).toContain('openHAB Hall_Light: "Hall light" is linked to modbus:data:plc:hall but no signal uses it');
    expect(info).toContain("UniFi shelly1-ab12: 192.168.20.55, c4:5b:be:00:00:02 is on the network but not documented");
    // Outside the configured subnet, so not reported.
    expect(info.some((i) => i.includes("phone"))).toBe(false);
    // Virtual items have no channel and are not expected to be documented.
    expect(info.some((i) => i.includes("Away_Mode"))).toBe(false);
    expect(info).toContain("ESPHome esp-dressing:GPIO12: binary_sensor/gpio: Door contact is not documented as a signal or cable");
    const house = (await app.inject({ url: "/api/house" })).json();
    expect(house.issueCount.info).toBe(info.length);
    await app.close();
  });

  it("says why a source failed", async () => {
    process.env.HADOC_UNIFI_KEY = "wrong";
    const dir = await mkdtemp(path.join(tmpdir(), "hadoc-live-"));
    await cp(DEMO, dir, { recursive: true });
    const settings = await readFile(path.join(dir, "settings.yaml"), "utf8");
    await writeFile(path.join(dir, "settings.yaml"), `${settings}\nintegrations:\n  unifi: { url: https://unifi.test }\n`);
    const app = await buildApp({ dataDir: dir, fetch: fakeFetch });
    await new Promise((r) => setTimeout(r, 50));
    const live = (await app.inject({ url: "/api/live" })).json();
    expect(live.sources.unifi).toMatchObject({ ok: false, error: "/sites?offset=0&limit=200: 401 Unauthorized" });
    await app.close();
  });
});

describe("mqtt", () => {
  it("tracks Tasmota and ESPHome nodes from their announcements", () => {
    const nodes = new Map<string, MqttNode>();
    observe(nodes, "tele/sonoff-mirror/LWT", "Online");
    observe(nodes, "tasmota/discovery/DC4F22000003/config", JSON.stringify({ t: "sonoff-mirror", ip: "192.168.20.30", mac: "DC4F22000003", hn: "sonoff-mirror-0003" }));
    observe(nodes, "esp-garage/status", "offline");
    observe(nodes, "zigbee2mqtt/status", '{"state":"online"}');
    expect([...nodes.values()].map(({ seen: _, ...n }) => n)).toEqual([
      { name: "sonoff-mirror", firmware: "Tasmota", online: true, ip: "192.168.20.30", mac: "dc:4f:22:00:00:03", hostname: "sonoff-mirror-0003" },
      { name: "esp-garage", firmware: "ESPHome", online: false },
    ]);
  });

  it("checks subnets", () => {
    expect(inSubnet("192.168.20.55", "192.168.20.0/24")).toBe(true);
    expect(inSubnet("192.168.21.1", "192.168.20.0/24")).toBe(false);
    expect(inSubnet("10.1.2.3", "0.0.0.0/0")).toBe(true);
  });
});

describe("esphome import", () => {
  it("reads every pin with what uses it, also through substitutions and pin objects", async () => {
    const text = await readFile(path.join(DEMO, "imports/esphome/esp-dressing.yaml"), "utf8");
    const node = parseEsphomeNode(text)!;
    expect(node).toMatchObject({ name: "esp-dressing", board: "nodemcuv2", platform: "esp8266" });
    expect(node.pins).toEqual([
      { pin: "GPIO14", use: "binary_sensor/gpio: Motion" },
      { pin: "GPIO12", use: "binary_sensor/gpio: Door contact" },
      { pin: "GPIO4", use: "i2c (sda)" },
      { pin: "GPIO5", use: "i2c (scl)" },
    ]);
    expect(esphomeToHadoc([node])[0]).toMatchObject({ id: "esp-dressing", kind: "esp", source: "esphome" });
  });

  it("skips files that are not a node", () => {
    expect(parseEsphomeNode("wifi_ssid: x\n")).toBeNull();
  });
});
