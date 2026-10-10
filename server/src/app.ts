import { existsSync, watch } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { circuitOf } from "./circuits.js";
import { EditError, editor } from "./edit.js";
import { indexHouse, type HouseIndex } from "./index-house.js";
import { loadHouse } from "./load.js";
import type { House } from "./model.js";
import { traceThing } from "./trace.js";

export interface AppOptions {
  dataDir: string;
  /** Built web app (web/dist). Optional so the API can run on its own in tests. */
  webDir?: string;
  /** Reload the data when files in the data folder change. */
  watch?: boolean;
  logger?: boolean;
  /** Refuse edits from the app, e.g. when the data folder is mounted read-only. */
  readOnly?: boolean;
  /** Commit every edit in the data folder's git repository. */
  gitCommit?: boolean;
}

const xy = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } as const;

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const dataDir = path.resolve(options.dataDir);

  let house: House = await loadHouse(dataDir);
  let index: HouseIndex = indexHouse(house);
  let loadedAt = new Date();

  const reload = async () => {
    house = await loadHouse(dataDir);
    index = indexHouse(house);
    loadedAt = new Date();
    app.log.info({ issues: house.issues.length }, "data reloaded");
  };

  if (options.watch) {
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(dataDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload().catch((err) => app.log.error(err)), 300);
    });
    app.addHook("onClose", async () => watcher.close());
  }

  app.get("/api/health", async () => ({ ok: true, loadedAt: loadedAt.toISOString() }));

  app.get("/api/house", async () => {
    const { issues, ...rest } = house;
    return {
      ...rest,
      circuitOf: circuitOf(house, index),
      editable: !options.readOnly,
      issueCount: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
      },
    };
  });

  app.get("/api/issues", async () => house.issues);

  app.get<{ Params: { id: string } }>("/api/trace/:id", async (req, reply) => {
    const trace = traceThing(house, index, req.params.id);
    if (!trace) return reply.code(404).send({ error: `Nothing with ID "${req.params.id}"` });
    return trace;
  });

  if (!options.readOnly) {
    const edit = editor(dataDir, () => house, reload, { commit: options.gitCommit });

    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof EditError) return reply.code(err.status).send({ error: err.message });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EROFS" || code === "EPERM") {
        return reply.code(403).send({ error: "The data folder is not writable; check the volume mount and its owner" });
      }
      return reply.send(err);
    });

    app.patch<{ Params: { id: string }; Body: { pos: [number, number] | null } }>(
      "/api/points/:id",
      { schema: { body: { type: "object", required: ["pos"], properties: { pos: { anyOf: [xy, { type: "null" }] } } } } },
      async (req) => edit.movePoint(req.params.id, req.body.pos),
    );

    app.post<{
      Body: { type: string; level: string; room: string; name?: string; pos?: [number, number] | null; signal?: string };
    }>(
      "/api/points",
      {
        schema: {
          body: {
            type: "object",
            required: ["type", "level", "room"],
            properties: {
              type: { type: "string" },
              level: { type: "string" },
              room: { type: "string" },
              name: { type: "string" },
              pos: { anyOf: [xy, { type: "null" }] },
              signal: { type: "string" },
            },
          },
        },
      },
      async (req) => {
        const { signal, ...point } = req.body;
        const created = await edit.createPoint(point);
        if (signal) await edit.linkSignal(signal, created.id);
        return created;
      },
    );

    app.put<{ Params: { id: string }; Body: { level: string; path: [number, number][] | null } }>(
      "/api/cables/:id/route",
      {
        schema: {
          body: {
            type: "object",
            required: ["level", "path"],
            properties: { level: { type: "string" }, path: { anyOf: [{ type: "array", items: xy, minItems: 2 }, { type: "null" }] } },
          },
        },
      },
      async (req) => edit.setRoute(req.params.id, req.body.level, req.body.path),
    );

    app.patch<{ Params: { id: string }; Body: { point: string | null } }>(
      "/api/signals/:id",
      { schema: { body: { type: "object", required: ["point"], properties: { point: { type: ["string", "null"] } } } } },
      async (req) => edit.linkSignal(req.params.id, req.body.point),
    );
  }

  // Plan underlays and photos live in the data folder.
  for (const dir of ["plans", "photos"]) {
    const root = path.join(dataDir, dir);
    if (existsSync(root)) {
      await app.register(fastifyStatic, { root, prefix: `/${dir}/`, decorateReply: false });
    }
  }

  if (options.webDir && existsSync(options.webDir)) {
    await app.register(fastifyStatic, { root: path.resolve(options.webDir), prefix: "/" });
    // Client-side routes fall back to the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
