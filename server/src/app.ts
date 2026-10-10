import { existsSync, watch } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
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
}

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
