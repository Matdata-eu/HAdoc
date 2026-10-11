// Types mirroring the JSON Schemas in /schema. The schemas are the source of truth;
// keep these in sync when a schema changes.

export type XY = [number, number];

export interface Settings {
  name?: string;
  language?: string;
  ids: { pattern: string; nr_digits?: number };
  levels: { code: string; name: string }[];
  types: { code: string; name: string; symbol?: string; layer?: Layer }[];
  imports?: {
    wago?: { config: string; controller?: string; id_prefix?: string };
  };
}

export type Layer = "power" | "data" | "automation" | "hidden";

export interface Room {
  code: string;
  name: string;
  outline: XY[];
}

export interface Floor {
  level: string;
  width: number;
  height: number;
  underlay?: { file: string; x?: number; y?: number; width?: number; height?: number; opacity?: number };
  rooms: Room[];
}

export interface Site {
  floors: Floor[];
}

export interface Point {
  id: string;
  type: string;
  level: string;
  room: string;
  name?: string;
  pos?: XY | null;
  height?: number | null;
  photo?: string;
  notes?: string;
  if_broken?: string;
  device?: string;
}

export interface Enclosure {
  id: string;
  name: string;
  level?: string | null;
  room?: string | null;
  pos?: XY | null;
  rails?: number;
  photo?: string;
  notes?: string;
}

export interface Port {
  name: string;
  signal?: string;
}

export interface Device {
  id: string;
  kind: string;
  model?: string | null;
  label?: string;
  location?: string;
  firmware?: string | null;
  hostname?: string | null;
  mac?: string | null;
  powered_by?: string | null;
  ports?: Port[];
  notes?: string;
  /** Set by the loader on records that come from an import, e.g. "wago". */
  source?: string;
}

export interface Cable {
  id: string;
  type?: string | null;
  length?: number | null;
  from: string | null;
  to: string | null;
  cores?: { colour: string; from?: string | null; to?: string | null }[];
  route?: { level: string; path: XY[] }[];
  notes?: string;
}

export interface Circuit {
  id: string;
  name?: string;
  breaker?: string | null;
  rating?: string | null;
  rcd?: string | null;
  phase?: string | null;
  feeds: string[];
}

export interface Signal {
  id: string;
  name?: string;
  port: string | null;
  point?: string | null;
  plc?: { name?: string | null; address?: string | null; modbus?: string | null };
  mqtt?: string | null;
  openhab?: { thing?: string | null; item?: string | null };
  logic?: "plc" | "openhab" | "both" | "none" | null;
  notes?: string;
  /** Set by the loader on records that come from an import, e.g. "wago". */
  source?: string;
}

export interface Issue {
  severity: "error" | "warning";
  file: string;
  id?: string;
  message: string;
}

export interface House {
  settings: Settings;
  site: Site;
  points: Point[];
  enclosures: Enclosure[];
  devices: Device[];
  cables: Cable[];
  circuits: Circuit[];
  signals: Signal[];
  issues: Issue[];
}
