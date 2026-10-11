# RAW Editor

A RAW photo editor that runs entirely in your browser. Open a DNG or camera RAW file, adjust tone and color, crop, apply a preset, and export. There is nothing to install, no account, and your photos are never uploaded.

**Live site:** [www.imgedit.pics](https://www.imgedit.pics) · [About](https://www.imgedit.pics/about)

## Who it's for

People who have a few RAW files and want to edit them without installing an app. It works on one photo at a time. There is no library, no catalog and no batch processing.

## Features

- **RAW decoding on your device.** DNG and camera RAW files (`cr2`, `cr3`, `nef`, `nrw`, `arw`, `srf`, `sr2`, `dng`, `raf`, `orf`, `rw2`, `pef`, `3fr`, `iiq`, `x3f`) are decoded with LibRaw compiled to WebAssembly. JPEG, PNG, WebP, AVIF and any other format your browser can decode open too.
- **Tone.** White balance, exposure, contrast, highlights, shadows, whites and blacks.
- **Presence.** Texture, clarity, dehaze, vibrance and saturation.
- **Tone curve.** Four-region parametric curve. Point curves that come with a preset are applied as well.
- **Color mixer.** Hue, saturation and luminance for eight color ranges.
- **Color grading.** Separate tints for shadows, midtones and highlights, plus a global tint.
- **Calibration.** Shadow tint and per-primary hue and saturation.
- **Detail and effects.** Sharpening, vignette, fade, grain, and a black-and-white treatment.
- **Crop.** A draggable crop box with a live pixel-size readout and ratio presets: Free, Original, Square, 5:4, 4:3, 3:2 and 16:9, each in landscape or portrait.
- **Presets.** One built-in look (High Detail), plus your own: import `.xmp` preset files one at a time or drop a whole folder. Imported presets are stored in your browser.
- **Undo and redo** for every edit.
- **Before and after** comparison.
- **Export** as JPEG, PNG or WebP at full resolution. JPEGs are encoded with MozJPEG at a quality you choose (1 to 100).

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | `Cmd+Z` / `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` |
| Toggle the original (before/after) | `\` |
| Reset a slider | Double-click it |
| Finish cropping | `Enter` |
| Cancel cropping | `Esc` |
| Move the crop box | Arrow keys (with the box focused) |
| Resize the crop box | `Shift` + arrow keys |

## Privacy

Photos are decoded, edited and exported on your own device. There is no server-side processing, so there is nothing to upload them to. The site's Content Security Policy also limits network requests to its own origin.

The hosted site counts page views with cookie-free analytics. Photos, edits and presets are never part of that.

## Running it locally

You need **Node.js 20.9 or newer** and **pnpm 10**. If you don't have pnpm, `corepack enable` will provide the version pinned in `package.json`.

```bash
git clone https://github.com/ericktomaliwan/raw-editor.git
cd raw-editor
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the development server on port 3000 |
| `pnpm build` | Create a production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run ESLint |
| `pnpm exec tsc --noEmit` | Type-check |

Things worth knowing:

- **Use pnpm.** The lockfile and the install scripts assume it.
- **The WebAssembly runtimes are copied, not committed.** `pnpm install`, `pnpm dev` and `pnpm build` all run `scripts/copy-wasm.mjs`, which copies the RAW decoder into `public/libraw/` and the JPEG encoder into `public/mozjpeg/`. Both folders are generated and gitignored. If you edit `lib/jpeg/mozjpeg.worker.js`, restart `pnpm dev` so the copy is refreshed.
- **There is no automated test suite yet.** Changes are verified in the browser.

### Configuration

There is one optional environment variable, described in `.env.example`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin used for canonical URLs, share metadata and the sitemap. Defaults to the production site. Set it for staging or preview deployments. |

## How it works

1. **Decode.** A RAW file is handed to LibRaw running in a Web Worker, which demosaics it using the white balance the camera recorded and returns an sRGB image. If the sensor data can't be decoded, the file's embedded preview is used and the photo is labeled as a preview. Other formats go straight through the browser's own decoder.
2. **Render.** The image is uploaded once as a WebGL 2 texture. Every adjustment is a uniform on a single fragment shader, so moving a slider is one draw call. White balance, calibration and exposure are applied in linear light; tone, curves, color and effects follow on display-referred values.
3. **Export.** The same shader renders the photo (or the cropped area) at full resolution. JPEGs are read back from the GPU and encoded by MozJPEG in a second worker, with the browser's built-in encoder as a fallback. PNG and WebP use the browser's encoders.

The edit itself (adjustments, active preset and crop) lives in a small undo/redo history, so every change can be stepped back.

## Project layout

```
app/
  page.tsx            the editor, at /
  (site)/             content pages that share a navbar and footer
    about/page.tsx    /about
  layout.tsx          root layout and site metadata
  globals.css         Tailwind setup and theme tokens
components/
  editor/             the editor UI: panels, sliders, viewport, crop overlay, header
  elements/, sections/, icons/   building blocks for the content pages
lib/
  adjustments.ts      the edit model: fields, defaults, ranges, validation
  webgl/              renderer and the GLSL pipeline
  raw/decoder.ts      RAW decoding (LibRaw worker client)
  jpeg/               MozJPEG encoder worker and its client
  crop.ts             crop geometry and ratio presets
  xmp.ts              .xmp preset parser
  presets.ts          built-in presets
  presetStore.ts      imported presets, kept in localStorage
  useEditHistory.ts   undo/redo
scripts/copy-wasm.mjs copies the WebAssembly runtimes into public/
next.config.ts        response headers (see Deploying)
```

## Deploying

The app is a static Next.js site and is hosted on Vercel. Two things matter wherever it is hosted:

- **Cross-origin isolation is required.** The RAW decoder uses threads, which need `SharedArrayBuffer`, which browsers only allow on cross-origin-isolated pages. `next.config.ts` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every route. A host that ignores `next.config.ts` headers must be configured to send them, or RAW files will not decode.
- **The Content Security Policy is same-origin only.** It is also set in `next.config.ts`. Any third-party script, font, image or API you add will be blocked until its host is added to the matching directive. The two worker folders (`/libraw` and `/mozjpeg`) get their own, slightly looser policies so WebAssembly can compile there without loosening the page's.

Page-view analytics use `@vercel/analytics` and only record anything once Web Analytics is enabled for the Vercel project.

## Limitations

- **RAW files start out flat.** They are rendered without the tone mapping and sharpening a camera or phone applies in its own viewer, so expect a flatter, softer image to begin with.
- **Presets are interpreted, not replicated.** Tone, color, curve, grading and calibration settings are mapped onto this editor's own pipeline, so results are close but not identical. Lens corrections, local adjustments, camera profiles and noise reduction are ignored.
- **Editing is 8-bit after decoding.** Extreme adjustments can show banding that a full-depth pipeline would avoid.
- **Very large images are downscaled** to the largest texture your GPU supports.
- **Not here yet:** rotate and straighten, a draggable point-curve editor, on-screen undo buttons for touch devices, and saving edits between sessions.
- **Browser requirements:** WebGL 2 and WebAssembly. RAW decoding additionally needs a cross-origin-isolated page.

## Built with

- [Next.js](https://nextjs.org) 16 (App Router), [React](https://react.dev) 19 and TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4
- [LibRaw](https://www.libraw.org) through [`libraw-wasm`](https://www.npmjs.com/package/libraw-wasm), for RAW decoding
- [MozJPEG](https://github.com/mozilla/mozjpeg) through [`@jsquash/jpeg`](https://www.npmjs.com/package/@jsquash/jpeg), for JPEG encoding

## License and third-party code

This repository does not include an open-source license yet.

Third-party code keeps its own terms:

- **LibRaw** is dual-licensed under LGPL 2.1 and CDDL 1.0.
- **MozJPEG** is covered by the IJG, modified BSD and zlib licenses. Its license files are served alongside the encoder at `/mozjpeg/`.
