import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

// Data folder: HADOC_DATA, else the first argument, else /data (the Docker volume).
const dataDir = process.env.HADOC_DATA ?? process.argv[2] ?? "/data";
const webDir = process.env.HADOC_WEB ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp({ dataDir, webDir, watch: true, logger: true });
await app.listen({ port, host });
