// Single frames as JPEG, to check the look before a long render.
// usage: COMP=PisaShort node scripts/stills.mjs out/<name>/x_ 100,400,900 [scale=0.5]
// ENTRY=src/sandboxes/<n>/index.tsx renders a sandbox copy instead of src/index.ts.
// CHROME=<path> picks the browser; on Windows the installed Chrome is used if found (GPU via ANGLE is much faster).
import fs from "node:fs";
// every bundle copies public/ into the temp folder and never deletes it: point REMOTION_TMP at a folder with space
if (process.env.REMOTION_TMP) { fs.mkdirSync(process.env.REMOTION_TMP, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.REMOTION_TMP; }
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const [prefix, frames, scale = "0.5"] = process.argv.slice(2);
if (!prefix || !frames) { console.log("usage: COMP=PisaShort node scripts/stills.mjs out/<name>/x_ 100,400 [0.5]"); process.exit(1); }
const winChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browserExecutable = process.env.CHROME || (fs.existsSync(winChrome) ? winChrome : undefined);
const chromiumOptions = { gl: "angle" };
fs.mkdirSync(path.dirname(path.resolve(prefix + "x")), { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve(process.env.ENTRY || "src/index.ts"), publicDir: path.resolve("public") });
const composition = await selectComposition({ serveUrl, id: process.env.COMP || "PisaShort", browserExecutable, chromiumOptions });
const onBrowserLog = (l) => { if (l.type === "error" || l.type === "warning") console.log(`[${l.type}]`, l.text.slice(0, 300)); };
for (const f of frames.split(",").map(Number)) {
  const t0 = Date.now();
  await renderStill({ composition, serveUrl, frame: f, output: `${prefix}${f}.jpg`, imageFormat: "jpeg", jpegQuality: 88, scale: Number(scale),
    browserExecutable, chromiumOptions, timeoutInMilliseconds: 180000, onBrowserLog });
  console.log("still", f, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
