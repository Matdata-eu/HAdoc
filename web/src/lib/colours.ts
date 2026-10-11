// Colours for circuits on the plan and for cable cores.

/** Distinct enough on both light and dark backgrounds. */
const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#14a3a3", "#d6339a", "#8a9a1b", "#9a6324", "#5c6bc0"];

export function circuitColours(ids: string[]): Map<string, string> {
  return new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]!]));
}

// Core colour names as electricians write them, in English, Dutch and French.
const CORE: Record<string, string> = {
  white: "#f5f5f5", wit: "#f5f5f5", blanc: "#f5f5f5",
  black: "#111", zwart: "#111", noir: "#111",
  brown: "#7b4a1e", bruin: "#7b4a1e", brun: "#7b4a1e",
  blue: "#1d4ed8", blauw: "#1d4ed8", bleu: "#1d4ed8",
  grey: "#8b8f94", gray: "#8b8f94", grijs: "#8b8f94", gris: "#8b8f94",
  green: "#16a34a", groen: "#16a34a", vert: "#16a34a",
  yellow: "#facc15", geel: "#facc15", jaune: "#facc15",
  red: "#dc2626", rood: "#dc2626", rouge: "#dc2626",
  orange: "#f97316", oranje: "#f97316",
  pink: "#f472b6", roze: "#f472b6", rose: "#f472b6",
  violet: "#7c3aed", purple: "#7c3aed", paars: "#7c3aed",
};

/** A CSS background for a core: one colour, or two stripes for "green/yellow". */
export function coreBackground(name: string): string | undefined {
  const parts = name.toLowerCase().split(/[\s/-]+/).map((p) => CORE[p]);
  if (parts.length === 0 || parts.some((p) => !p)) return undefined;
  if (parts.length === 1) return parts[0];
  return `repeating-linear-gradient(135deg, ${parts.map((c, i) => `${c} ${i * 4}px ${(i + 1) * 4}px`).join(", ")})`;
}
