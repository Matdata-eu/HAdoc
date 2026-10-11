import { idScheme } from "./ids.js";
import { indexHouse } from "./index-house.js";
import type { House, Issue } from "./model.js";

function pointInPolygon([x, y]: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cross-file checks: references, the ID scheme, and what is still undocumented. */
export function checkHouse(house: House): Issue[] {
  const issues: Issue[] = [];
  const error = (file: string, id: string | undefined, message: string) =>
    issues.push({ severity: "error", file, id, message });
  const warn = (file: string, id: string | undefined, message: string) =>
    issues.push({ severity: "warning", file, id, message });

  const levels = new Set(house.settings.levels.map((l) => l.code));
  const types = new Set(house.settings.types.map((t) => t.code));
  const floors = new Map(house.site.floors.map((f) => [f.level, f]));

  for (const floor of house.site.floors) {
    if (!levels.has(floor.level)) error("site.yaml", floor.level, `Floor level "${floor.level}" is not in settings.levels`);
    const seen = new Set<string>();
    for (const room of floor.rooms) {
      if (seen.has(room.code)) error("site.yaml", room.code, `Room code "${room.code}" appears twice on level ${floor.level}`);
      seen.add(room.code);
    }
  }

  // One namespace for everything a cable or circuit can land on.
  const owners = new Map<string, string>();
  const claim = (file: string, id: string) => {
    const other = owners.get(id);
    if (other) error(file, id, `ID "${id}" is already used in ${other}`);
    else owners.set(id, file);
  };
  for (const p of house.points) claim("points", p.id);
  for (const d of house.devices) claim("devices.yaml", d.id);
  for (const e of house.enclosures) claim("enclosures.yaml", e.id);
  for (const [file, list] of [
    ["cables.yaml", house.cables],
    ["circuits.yaml", house.circuits],
    ["signals.yaml", house.signals],
  ] as const) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) error(file, item.id, `ID "${item.id}" appears twice`);
      seen.add(item.id);
    }
  }

  const index = indexHouse(house);
  const mustResolve = (file: string, owner: string, field: string, ref: string | null | undefined) => {
    if (ref == null) return;
    const r = index.resolve(ref);
    if (!r.ok) error(file, owner, `${field}: ${r.reason}`);
  };

  let scheme: ReturnType<typeof idScheme> | undefined;
  try {
    scheme = idScheme(house.settings);
  } catch (err) {
    error("settings.yaml", undefined, (err as Error).message);
  }

  for (const p of house.points) {
    const file = "points";
    if (!levels.has(p.level)) error(file, p.id, `Level "${p.level}" is not in settings.levels`);
    if (!types.has(p.type)) error(file, p.id, `Type "${p.type}" is not in settings.types`);
    const floor = floors.get(p.level);
    const room = floor?.rooms.find((r) => r.code === p.room);
    if (floor && !room) error(file, p.id, `Room "${p.room}" does not exist on level ${p.level}`);

    if (scheme) {
      const parts = scheme.parse(p.id);
      if (!parts) {
        error(file, p.id, `ID does not follow the pattern ${house.settings.ids.pattern}`);
      } else {
        if (parts.level !== p.level) error(file, p.id, `ID says level ${parts.level}, but level is ${p.level}`);
        if (parts.room !== p.room) error(file, p.id, `ID says room ${parts.room}, but room is ${p.room}`);
        if (parts.type !== p.type) error(file, p.id, `ID says type ${parts.type}, but type is ${p.type}`);
      }
    }

    if (!p.pos) warn(file, p.id, "Not placed on the plan yet");
    else if (room && !pointInPolygon(p.pos, room.outline)) warn(file, p.id, `Position is outside room ${p.room}`);

    if (p.device) {
      const t = index.things.get(p.device);
      if (!t || t.kind !== "device") error(file, p.id, `device: "${p.device}" is not a device`);
    }
  }

  for (const e of house.enclosures) {
    if (e.level && !levels.has(e.level)) error("enclosures.yaml", e.id, `Level "${e.level}" is not in settings.levels`);
  }

  for (const d of house.devices) {
    mustResolve("devices.yaml", d.id, "location", d.location);
    if (d.powered_by && !index.circuits.has(d.powered_by)) mustResolve("devices.yaml", d.id, "powered_by", d.powered_by);
    if (d.kind === "esp" && !d.mac) warn("devices.yaml", d.id, "No MAC address, so network status cannot be matched");
  }

  for (const c of house.cables) {
    mustResolve("cables.yaml", c.id, "from", c.from);
    mustResolve("cables.yaml", c.id, "to", c.to);
    if (c.from == null || c.to == null) warn("cables.yaml", c.id, "One end of the cable is not documented");
    if (c.type == null) warn("cables.yaml", c.id, "Cable type is unknown");
    for (const [i, core] of (c.cores ?? []).entries()) {
      mustResolve("cables.yaml", c.id, `cores[${i}].from`, core.from);
      mustResolve("cables.yaml", c.id, `cores[${i}].to`, core.to);
    }
    for (const segment of c.route ?? []) {
      if (!levels.has(segment.level)) error("cables.yaml", c.id, `Route level "${segment.level}" is not in settings.levels`);
    }
  }

  for (const c of house.circuits) {
    for (const [field, ref] of [["breaker", c.breaker], ["rcd", c.rcd]] as const) {
      if (ref == null) continue;
      const t = index.things.get(ref);
      if (!t || t.kind !== "device") error("circuits.yaml", c.id, `${field}: "${ref}" is not a device`);
    }
    for (const ref of c.feeds) mustResolve("circuits.yaml", c.id, "feeds", ref);
  }

  for (const s of house.signals) {
    mustResolve("signals.yaml", s.id, "port", s.port);
    if (s.port == null) warn("signals.yaml", s.id, "Port is unknown");
    if (s.point == null && s.source) warn(`import: ${s.source}`, s.id, "Not linked to a point yet");
    if (s.point != null) {
      const t = index.things.get(s.point);
      if (!t || t.kind !== "point") error("signals.yaml", s.id, `point: "${s.point}" is not a point`);
    }
  }

  return issues;
}
