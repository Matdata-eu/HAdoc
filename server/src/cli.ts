#!/usr/bin/env node
import { loadHouse } from "./load.js";

const [command, dir] = process.argv.slice(2);

if (command !== "validate" || !dir) {
  console.error("Usage: hadoc validate <data folder>");
  process.exit(2);
}

const house = await loadHouse(dir);
const errors = house.issues.filter((i) => i.severity === "error");
const warnings = house.issues.filter((i) => i.severity === "warning");

for (const issue of house.issues) {
  const where = issue.id ? `${issue.file} ${issue.id}` : issue.file;
  console.log(`${issue.severity === "error" ? "error  " : "warning"}  ${where}: ${issue.message}`);
}
console.log(
  `\n${house.points.length} points, ${house.devices.length} devices, ${house.cables.length} cables, ` +
    `${house.circuits.length} circuits, ${house.signals.length} signals. ` +
    `${errors.length} errors, ${warnings.length} warnings.`,
);
process.exit(errors.length > 0 ? 1 : 0);
