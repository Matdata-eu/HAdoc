// Listens on the MQTT broker for the nodes that announce themselves:
// Tasmota (LWT and discovery) and ESPHome (availability topic).

import mqtt from "mqtt";

export interface MqttNode {
  /** Tasmota topic or ESPHome node name. */
  name: string;
  firmware: "Tasmota" | "ESPHome";
  online?: boolean;
  ip?: string;
  mac?: string;
  hostname?: string;
  seen: string;
}

export const MQTT_TOPICS = ["tele/+/LWT", "+/status", "tasmota/discovery/+/config"];

/** Updates the node list for one message. Pure, so it can be tested without a broker. */
export function observe(nodes: Map<string, MqttNode>, topic: string, payload: string, now = new Date()) {
  const parts = topic.split("/");
  const upsert = (name: string, firmware: MqttNode["firmware"], patch: Partial<MqttNode>) => {
    const node = nodes.get(name) ?? { name, firmware, seen: now.toISOString() };
    nodes.set(name, { ...node, ...patch, seen: now.toISOString() });
  };

  if (parts.length === 3 && parts[0] === "tele" && parts[2] === "LWT") {
    upsert(parts[1]!, "Tasmota", { online: payload.trim() === "Online" });
  } else if (parts.length === 4 && parts[0] === "tasmota" && parts[1] === "discovery") {
    try {
      const d = JSON.parse(payload) as { t?: string; ip?: string; mac?: string; hn?: string };
      if (d.t) {
        const mac = d.mac?.toLowerCase().replace(/(..)(?!$)/g, "$1:");
        upsert(d.t, "Tasmota", { ip: d.ip, mac, hostname: d.hn });
      }
    } catch {
      // Not a discovery message we understand.
    }
  } else if (parts.length === 2 && parts[1] === "status" && /^(online|offline)$/.test(payload.trim())) {
    upsert(parts[0]!, "ESPHome", { online: payload.trim() === "online" });
  }
}

export function connectMqtt(
  url: string,
  auth: { username?: string; password?: string },
  onError: (message: string) => void,
) {
  const nodes = new Map<string, MqttNode>();
  let lastError: string | undefined;
  const client = mqtt.connect(url, { ...auth, clientId: `hadoc-${Math.random().toString(16).slice(2, 8)}`, reconnectPeriod: 30000 });
  client.on("connect", () => {
    lastError = undefined;
    client.subscribe(MQTT_TOPICS);
  });
  client.on("error", (err) => {
    lastError = err.message;
    onError(err.message);
  });
  client.on("message", (topic, payload) => observe(nodes, topic, payload.toString()));
  return {
    nodes,
    status: () => ({ ok: client.connected, error: client.connected ? undefined : (lastError ?? "Not connected") }),
    close: () => client.end(true),
  };
}
