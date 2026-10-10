// Edits from the app, written back into the hand-written YAML files.
// The yaml Document API keeps comments, key order and formatting of everything
// that is not touched. Imported records are never written; an edit to one
// becomes an overlay entry in the hand-written file instead.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Document, isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { idScheme } from "./ids.js";
import { listFiles, type ListKey } from "./load.js";
import type { House, XY } from "./model.js";

export class EditError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Found {
  file: string;
  doc: Document;
  item: YAMLMap;
}

async function openDoc(dataDir: string, file: string): Promise<Document> {
  const full = path.join(dataDir, file);
  if (!existsSync(full)) {
    const doc = new Document([]);
    doc.commentBefore = ` yaml-language-server: $schema=${path.posix.relative(path.posix.dirname(file), "schema")}/${file.split("/")[0]!.replace(/\.yaml$/, "")}.schema.json`;
    return doc;
  }
  const doc: Document = parseDocument(await readFile(full, "utf8"));
  if (doc.errors.length) throw new EditError(409, `${file} has YAML errors; fix them first`);
  if (doc.contents === null) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) throw new EditError(409, `${file} is not a list`);
  return doc;
}

async function find(dataDir: string, list: ListKey, id: string): Promise<Found | null> {
  for (const file of await listFiles(dataDir, list)) {
    const doc = await openDoc(dataDir, file);
    const item = (doc.contents as YAMLSeq).items.find((i) => isMap(i) && i.get("id") === id);
    if (item) return { file, doc, item: item as YAMLMap };
  }
  return null;
}

async function save(dataDir: string, file: string, doc: Document) {
  await writeFile(path.join(dataDir, file), doc.toString({ lineWidth: 0, flowCollectionPadding: false }), "utf8");
}

function flow(doc: Document, value: unknown) {
  const node = doc.createNode(value);
  if (isSeq(node)) {
    node.flow = true;
    for (const child of node.items) if (isSeq(child)) child.flow = true;
  }
  return node;
}

/** Appends a record to a list file, separated from the previous one by a blank line. */
function append(doc: Document, record: Record<string, unknown>) {
  const node = doc.createNode(record) as YAMLMap;
  for (const pair of node.items) {
    if (Array.isArray(record[String(pair.key)])) pair.value = flow(doc, record[String(pair.key)]);
  }
  const seq = doc.contents as YAMLSeq;
  if (seq.items.length) node.spaceBefore = true;
  seq.items.push(node);
}

const run = promisify(execFile);

/** Commits one file in the data folder's git repository. Failing to commit never fails the edit. */
async function commit(dataDir: string, file: string, message: string): Promise<boolean> {
  const name = process.env.GIT_AUTHOR_NAME ?? "HAdoc";
  const email = process.env.GIT_AUTHOR_EMAIL ?? "hadoc@localhost";
  const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  // The volume is often owned by another user than the container's; trust it explicitly.
  const git = (...args: string[]) => run("git", ["-c", `safe.directory=${dataDir}`, "-C", dataDir, ...args], { env });
  try {
    await git("add", "--", file);
    await git("commit", "-q", "-m", message, "--", file);
    return true;
  } catch {
    return false;
  }
}

const roundXY = (p: XY): XY => [Math.round(p[0]), Math.round(p[1])];

/**
 * `house` returns the current data and `reload` refreshes it; both run inside the
 * write queue, so every edit sees the result of the one before.
 */
export function editor(
  dataDir: string,
  house: () => House,
  reload: () => Promise<void>,
  options: { commit?: boolean } = {},
) {
  // One write at a time, so two quick edits cannot overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = (message: string, fn: () => Promise<{ id: string; file: string }>) => {
    const task = async () => {
      const result = await fn();
      const committed = options.commit ? await commit(dataDir, result.file, message.replace("{id}", result.id)) : false;
      await reload();
      return { ...result, committed };
    };
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    /** Moves a point, or clears its position with null. */
    movePoint: (id: string, pos: XY | null) =>
      serial(pos ? `Move {id}` : `Remove {id} from the plan`, async () => {
        const found = await find(dataDir, "points", id);
        if (!found) throw new EditError(404, `Point "${id}" is not in a points file`);
        found.item.set("pos", pos ? flow(found.doc, roundXY(pos)) : null);
        await save(dataDir, found.file, found.doc);
        return { id, file: found.file };
      }),

    /** Sets the route of a cable on one floor, or removes it with null. */
    setRoute: (id: string, level: string, route: XY[] | null) =>
      serial(route ? `Draw route of {id} on level ${level}` : `Remove route of {id} on level ${level}`, async () => {
        const found = await find(dataDir, "cables", id);
        if (!found) throw new EditError(404, `Cable "${id}" is not in a cables file`);
        const { doc, item } = found;
        let seq = item.get("route") as YAMLSeq | undefined;
        if (!isSeq(seq)) {
          seq = doc.createNode([]) as YAMLSeq;
          item.set("route", seq);
        }
        const at = seq.items.findIndex((r) => isMap(r) && String(r.get("level")) === level);
        if (route) {
          const entry = doc.createNode({ level }) as YAMLMap;
          entry.set("path", flow(doc, route.map(roundXY)));
          if (at === -1) seq.items.push(entry);
          else (seq.items[at] as YAMLMap).set("path", entry.get("path", true));
        } else if (at !== -1) {
          seq.items.splice(at, 1);
          if (seq.items.length === 0) item.delete("route");
        }
        await save(dataDir, found.file, doc);
        return { id, file: found.file };
      }),

    /**
     * Creates a point with the next free number for its level, room and type. It is
     * added to the file that already holds points of that level, else points.yaml.
     */
    createPoint: (input: { type: string; level: string; room: string; name?: string; pos?: XY | null }) =>
      serial(`Add point {id}`, async () => {
        const { type, level, room } = input;
        const { settings, site, points } = house();
        if (!settings.types.some((t) => t.code === type)) throw new EditError(400, `Unknown type "${type}"`);
        const floor = site.floors.find((f) => f.level === level);
        if (!floor) throw new EditError(400, `No floor for level "${level}"`);
        if (!floor.rooms.some((r) => r.code === room)) throw new EditError(400, `No room "${room}" on level "${level}"`);

        const scheme = idScheme(settings);
        let nr = 0;
        for (const p of points) {
          const parts = scheme.parse(p.id);
          if (parts && parts.level === level && parts.room === room && parts.type === type) nr = Math.max(nr, Number(parts.nr));
        }
        const id = scheme.format({ level, room, type, nr: nr + 1 });

        let file = "points.yaml";
        for (const f of await listFiles(dataDir, "points")) {
          const doc = await openDoc(dataDir, f);
          if ((doc.contents as YAMLSeq).items.some((i) => isMap(i) && String(i.get("level")) === level)) {
            file = f;
            break;
          }
        }
        const doc = await openDoc(dataDir, file);
        append(doc, {
          id,
          type,
          level,
          room,
          ...(input.name ? { name: input.name } : {}),
          pos: input.pos ? roundXY(input.pos) : null,
        });
        await save(dataDir, file, doc);
        return { id, file };
      }),

    /** Links a signal to a point (or unlinks it with null). Imported signals get an overlay entry. */
    linkSignal: (id: string, point: string | null) =>
      serial(point ? `Link ${id} to ${point}` : `Unlink ${id}`, async () => {
        const { signals, points } = house();
        if (!signals.some((s) => s.id === id)) throw new EditError(404, `Signal "${id}" does not exist`);
        if (point !== null && !points.some((p) => p.id === point)) throw new EditError(400, `Point "${point}" does not exist`);
        const found = await find(dataDir, "signals", id);
        if (found) {
          found.item.set("point", point);
          await save(dataDir, found.file, found.doc);
          return { id, file: found.file };
        }
        const file = "signals.yaml";
        const doc = await openDoc(dataDir, file);
        append(doc, { id, point });
        await save(dataDir, file, doc);
        return { id, file };
      }),
  };
}

export type Editor = ReturnType<typeof editor>;
