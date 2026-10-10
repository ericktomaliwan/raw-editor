// Copies the libraw-wasm worker + wasm binary into public/ so the browser can
// load them as plain static files. The worker spawns pthread sub-workers via
// `new Worker(import.meta.url)`, which doesn't survive bundling, so we
// deliberately keep it out of the Turbopack graph.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const src = new URL("../node_modules/libraw-wasm/dist/", import.meta.url);
const dest = new URL("../public/libraw/", import.meta.url);
const files = ["worker.js", "libraw.wasm"];

await mkdir(dest, { recursive: true });
for (const name of files) {
  const from = new URL(name, src);
  const to = new URL(name, dest);
  const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  await copyFile(from, to);
  console.log(`copied ${name} -> ${fileURLToPath(to)}`);
}
