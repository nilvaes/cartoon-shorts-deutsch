// Prints the camera and the screen position (x, y in -1..1, z = depth) of given world points at given frames.
// usage: node tools/camdebug.mjs src/videos/<name>/story.ts <f1,f2,...> "x,y,z;x,y,z"
import { build } from "esbuild";
import { pathToFileURL } from "url";
import fs from "fs";
import os from "os";
import path from "path";

const [, , storyPath, frames, ptsArg = ""] = process.argv;
const out = path.join(os.tmpdir(), `camdebug_${Date.now()}.mjs`);
await build({ entryPoints: [storyPath], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const S = await import(pathToFileURL(out).href);
fs.unlinkSync(out);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const pts = ptsArg ? ptsArg.split(";").map((p) => p.split(",").map(Number)) : [];
for (const f of frames.split(",").map(Number)) {
  const id = S.shotAt(f).id, c = S.camAt(id, f), fw = norm(sub(c.look, c.pos)), r = norm(cross(fw, [0, 1, 0])), u = cross(r, fw), t = Math.tan((c.fov * Math.PI) / 360);
  const proj = pts.map((P) => { const v = sub(P, c.pos), z = dot(v, fw); return `(${(dot(v, r) / (z * t * 9 / 16)).toFixed(2)},${(dot(v, u) / (z * t)).toFixed(2)},z${z.toFixed(1)})`; });
  console.log(`f${f} shot${id} pos ${c.pos.map((v) => v.toFixed(1))} look ${c.look.map((v) => v.toFixed(1))} fov ${c.fov.toFixed(0)}  ${proj.join(" ")}`);
}
