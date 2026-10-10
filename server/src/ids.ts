import type { Settings } from "./model.js";

export interface IdParts {
  level: string;
  room: string;
  type: string;
  nr: string;
}

const PLACEHOLDERS = ["level", "room", "type", "nr"] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a matcher for the configured point ID pattern, e.g. "{level}-{room}-{type}-{nr}". */
export function idScheme(settings: Settings) {
  const pattern = settings.ids.pattern;
  const digits = settings.ids.nr_digits ?? 2;

  for (const name of PLACEHOLDERS) {
    if (!pattern.includes(`{${name}}`)) {
      throw new Error(`ID pattern "${pattern}" is missing {${name}}`);
    }
  }

  const source = pattern
    .split(/(\{level\}|\{room\}|\{type\}|\{nr\})/)
    .map((part) => {
      switch (part) {
        case "{level}":
          return "(?<level>[A-Za-z0-9]+)";
        case "{room}":
          return "(?<room>[A-Za-z0-9]+)";
        case "{type}":
          return "(?<type>[A-Za-z0-9]+)";
        case "{nr}":
          return `(?<nr>\\d{${digits}})`;
        default:
          return escapeRegExp(part);
      }
    })
    .join("");
  const regex = new RegExp(`^${source}$`);

  return {
    parse(id: string): IdParts | null {
      const groups = regex.exec(id)?.groups;
      if (!groups) return null;
      return { level: groups.level!, room: groups.room!, type: groups.type!, nr: groups.nr! };
    },
    format(parts: Omit<IdParts, "nr"> & { nr: number | string }): string {
      const nr = String(parts.nr).padStart(digits, "0");
      return pattern
        .replace("{level}", parts.level)
        .replace("{room}", parts.room)
        .replace("{type}", parts.type)
        .replace("{nr}", nr);
    },
  };
}
