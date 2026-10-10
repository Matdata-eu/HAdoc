import type { House, Issue, XY } from "../../../server/src/model.ts";
import type { Trace } from "../../../server/src/trace.ts";

export type { Cable, Circuit, Device, Floor, House, Issue, Point, Settings, Signal, XY } from "../../../server/src/model.ts";
export type { Trace, ThingRef } from "../../../server/src/trace.ts";

export type HouseData = Omit<House, "issues"> & {
  issueCount: { errors: number; warnings: number };
  /** Point or device ID to the circuit that feeds it. */
  circuitOf: Record<string, string>;
  /** False when the server refuses edits. */
  editable: boolean;
};

export interface NewPoint {
  type: string;
  level: string;
  room: string;
  name?: string;
  pos?: XY | null;
  /** Signal to link to the new point. */
  signal?: string;
}

/** What the details panel can ask the app to do in edit mode. */
export interface EditActions {
  place: (pointId: string) => void;
  route: (cableId: string) => void;
  link: (signalId: string, point: string | null) => void;
  create: (point: NewPoint) => void;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error ?? data.message ?? `${res.status} ${res.statusText}`);
  return data as T;
}

type Saved = { id: string; file: string; committed: boolean };

export const api = {
  house: () => getJson<HouseData>("/api/house"),
  issues: () => getJson<Issue[]>("/api/issues"),
  trace: (id: string) => getJson<Trace>(`/api/trace/${encodeURIComponent(id)}`),

  movePoint: (id: string, pos: XY | null) => send<Saved>("PATCH", `/api/points/${encodeURIComponent(id)}`, { pos }),
  createPoint: (point: NewPoint) => send<Saved>("POST", "/api/points", point),
  setRoute: (id: string, level: string, path: XY[] | null) =>
    send<Saved>("PUT", `/api/cables/${encodeURIComponent(id)}/route`, { level, path }),
  linkSignal: (id: string, point: string | null) => send<Saved>("PATCH", `/api/signals/${encodeURIComponent(id)}`, { point }),
};
