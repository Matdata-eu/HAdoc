import type { House, Issue } from "../../../server/src/model.ts";
import type { Trace } from "../../../server/src/trace.ts";

export type { Cable, Device, Floor, House, Issue, Point, Settings } from "../../../server/src/model.ts";
export type { Trace, ThingRef } from "../../../server/src/trace.ts";

export type HouseData = Omit<House, "issues"> & { issueCount: { errors: number; warnings: number } };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  house: () => getJson<HouseData>("/api/house"),
  issues: () => getJson<Issue[]>("/api/issues"),
  trace: (id: string) => getJson<Trace>(`/api/trace/${encodeURIComponent(id)}`),
};
