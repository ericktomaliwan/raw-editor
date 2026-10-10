// Copies the WebAssembly runtimes into public/ so the browser can load them as
// plain static files. Both run in module workers that are deliberately kept
// out of the Turbopack graph:
//
// - public/libraw/   RAW decoder. Its worker spawns pthread sub-workers via
//                    `new Worker(import.meta.url)`, which doesn't survive bundling.
// - public/mozjpeg/  JPEG encoder: our own small worker (lib/jpeg/mozjpeg.worker.js)
//                    plus the MozJPEG codec it imports from the same folder.
//
// Each folder is also served with its own Content Security Policy (see
// next.config.ts), which is the other reason these stay static files.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

/** [source (relative to the repo root), destination (relative to public/)] */
const files = [
  ["node_modules/libraw-wasm/dist/worker.js", "libraw/worker.js"],
  ["node_modules/libraw-wasm/dist/libraw.wasm", "libraw/libraw.wasm"],

  ["lib/jpeg/mozjpeg.worker.js", "mozjpeg/worker.js"],
  ["node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.js", "mozjpeg/mozjpeg_enc.js"],
  ["node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm", "mozjpeg/mozjpeg_enc.wasm"],
  // The codec's licences ask for their notices to accompany binary copies.
  ["node_modules/@jsquash/jpeg/LICENSE", "mozjpeg/LICENSE.txt"],
  ["node_modules/@jsquash/jpeg/codec/LICENSE.codec.md", "mozjpeg/LICENSE.codec.md"],
];

for (const [source, target] of files) {
  const from = new URL(source, root);
  const to = new URL(`public/${target}`, root);
  await mkdir(new URL("./", to), { recursive: true });
  const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  await copyFile(from, to);
  console.log(`copied ${source} -> ${fileURLToPath(to)}`);
}
