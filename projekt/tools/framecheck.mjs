// Framing check: walks every frame of a short's camera (story.ts camAt) and reports frames where a focus subject
// (story.ts FOCUS: head / feet / prop points per frame range) is outside the safe area of the 9:16 frame.
// usage: node tools/framecheck.mjs src/videos/pyramid/story.ts [marginX=0.86] [marginY=0.9]
import { build } from "esbuild";
import { pathToFileURL } from "url";
import fs from "fs";
import os from "os";
import path from "path";

const [, , storyPath, mx = "0.86", my = "0.9"] = process.argv;
const out = path.join(os.tmpdir(), `framecheck_${Date.now()}.mjs`);
await build({ entryPoints: [storyPath], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const S = await import(pathToFileURL(out).href);
fs.unlinkSync(out);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const project = (c, P) => {
  const fwd = norm(sub(c.look, c.pos)); let right = norm(cross(fwd, [0, 1, 0])); let up = cross(right, fwd);
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll); [right, up] = [right.map((v, i) => v * cr + up[i] * sr), up.map((v, i) => v * cr - right[i] * sr)];
  const v = sub(P, c.pos), z = dot(v, fwd), t = Math.tan((c.fov * Math.PI) / 360);
  return { x: dot(v, right) / (z * t * (9 / 16)), y: dot(v, up) / (z * t), z };
};
const bad = [];
for (const F of S.FOCUS) for (let f = F.a; f < F.b; f++) {
  const id = S.shotAt(f).id, c = S.camAt(id, f), pts = typeof F.pts === "function" ? F.pts(f) : F.pts;
  if (S.whipAt && S.whipAt(id, f)) continue; // whip pans swing away on purpose
  for (const P of pts) {
    const q = project(c, P);
    if (q.z < 0.3 || Math.abs(q.x) > +mx || Math.abs(q.y) > +my) bad.push({ f, id, what: F.what, x: +q.x.toFixed(2), y: +q.y.toFixed(2) });
  }
}
// group consecutive frames per subject
const runs = [];
for (const b of bad) { const r = runs[runs.length - 1]; if (r && r.what === b.what && b.f - r.f1 <= 1) { r.f1 = b.f; r.worst = Math.max(r.worst, Math.abs(b.x), Math.abs(b.y)); } else runs.push({ what: b.what, id: b.id, f0: b.f, f1: b.f, worst: Math.max(Math.abs(b.x), Math.abs(b.y)) }); }
console.log(runs.length ? runs.map((r) => `shot ${r.id} f${r.f0}-${r.f1} ${r.what} (worst ${r.worst.toFixed(2)})`).join("\n") : "framing OK: every focus subject inside the safe area");
