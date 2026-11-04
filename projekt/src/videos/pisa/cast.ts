// Our cast as lit flat sprites in the 3D world. Each frame every character asks for a drawing (a key + a draw call);
// the pool keeps one canvas per distinct drawing, so repeated poses share canvases. Characters are yaw-only billboards
// shaded by cardShade() (scene tint, bright floor, side gradient toward the sun, painted crescent in the drawing);
// standing ones get a soft multiply contact blob. Effects are unlit cards. Cards, effects and blobs live on the NOINK
// layer so the world ink pass never outlines their quads.
import * as THREE from "three";
import {
  Pen, bodyFront, bodySide, fxBurst, fxPuff, fxShadow, fxContact, Outfit, Expr, FrontOpts, SideOpts, tourist, worker,
  builder, pisan, engineer, DICTATOR, SERGEANT, fxBanana,
} from "./toon";
import { FPS, SHOTS, V3, smooth, clamp01, R, PIT, MATTRESS, BANANA, SIT_AT, marchX, TowerState } from "./story";
import { NOINK } from "./ink";
import { cardShade, blobMaterial, CARD_K } from "./cardshade";

// ---------------- canvas pool ----------------
type Entry = { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; w: number; h: number };
export type Req = { key: string; w: number; h: number; k: number; draw: (p: Pen) => void; tex?: THREE.CanvasTexture };
const makeEntry = (w: number, h: number): Entry => {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { cv, tex, w, h };
};
export class Pool {
  private live = new Map<string, Entry>();
  private free: Entry[] = [];
  private reqs: Req[] = [];
  req(key: string, w: number, h: number, k: number, draw: (p: Pen) => void) {
    const r: Req = { key: `${w}x${h}|${key}`, w, h, k, draw };
    this.reqs.push(r);
    return r;
  }
  flush() {
    const want = new Map<string, Req[]>();
    for (const r of this.reqs) { const l = want.get(r.key); if (l) l.push(r); else want.set(r.key, [r]); }
    for (const [key, e] of this.live) if (!want.has(key)) { this.live.delete(key); this.free.push(e); }
    for (const [key, rs] of want) {
      let e = this.live.get(key);
      if (!e) {
        const r = rs[0], i = this.free.findIndex((x) => x.w === r.w && x.h === r.h);
        e = i >= 0 ? this.free.splice(i, 1)[0] : makeEntry(r.w, r.h);
        const g = e.cv.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, e.w, e.h); g.setTransform(r.k, 0, 0, r.k, 0, 0);
        r.draw(new Pen(g));
        e.tex.needsUpdate = true;
        this.live.set(key, e);
      }
      for (const r of rs) r.tex = e.tex;
    }
    this.reqs = [];
  }
}

// ---------------- sprite meshes ----------------
const blank = (() => { const c = document.createElement("canvas"); c.width = c.height = 2; return new THREE.CanvasTexture(c); })();
export const SU = 0.00216; // metres per design unit: 1000 units = 2.16 m
export const SU_SWING = 2.3 / 1830; // swing canvas: rope of 1830 units = 2.3 m
const BODY = (() => { const g = new THREE.PlaneGeometry(600 * SU, 1000 * SU); g.translate(0, (975 - 500) * SU, 0); return g; })();
const CARD = new THREE.PlaneGeometry(1, 1);
/** world roots that hold actors (to find the scene's sun when world.ts does not pass it) */
const ROOTS = new Set<THREE.Object3D>();

/** lit flat character: cardShade() material, receives shadows (dims to the bright floor only), casts its silhouette
 *  when world.ts says so (golden). Drawn after the contact blobs (renderOrder 1). */
export class Actor {
  mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; dmat: THREE.MeshDepthMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry = BODY) {
    this.mat = cardShade(new THREE.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.customDepthMaterial = this.dmat;
    // rim width is in output pixels: tell the card shader the render height (1920 = 1080 x 1920 frame)
    this.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920; };
    this.mesh.castShadow = false; this.mesh.receiveShadow = true; this.mesh.visible = false;
    this.mesh.rotation.order = "YXZ"; this.mesh.renderOrder = 1; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
    ROOTS.add(parent);
  }
  bind() { const t = this.r?.tex; if (t) { this.mat.map = t; this.dmat.map = t; } }
}
/** unlit effect card: hard cut-out (ink drawings), soft see-through (dust, mist) or a multiply ground blob */
export class Fx {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; soft: THREE.MeshBasicMaterial; blob: THREE.MeshBasicMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D) {
    this.mat = new THREE.MeshBasicMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.soft = new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.blob = blobMaterial(blank);
    this.mesh = new THREE.Mesh(CARD, this.mat);
    this.mesh.visible = false; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
  }
  use(soft: boolean) { this.mesh.material = soft ? this.soft : this.mat; }
  bind() {
    const t = this.r?.tex;
    if (!t) return;
    if (this.r!.key.includes("|blob|")) {
      // no mipmaps: at grazing views the mip chain averages the blob with its white surround and it fades out
      if (t.generateMipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
      this.blob.map = t; this.mesh.material = this.blob; this.mesh.renderOrder = 0.5;
    }
    else { this.mat.map = t; this.soft.map = t; this.mesh.renderOrder = 0; }
  }
}

// ---------------- placements ----------------
export type Place = {
  key: string; draw: (p: Pen) => void; x: number; y: number; z: number;
  scale?: number; mirror?: boolean; yaw?: number; geo?: "body" | "swing"; roll?: number; size?: [number, number, number];
};
export type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean;
  /** fixed world yaw of an upright card (signs on walls), instead of facing the camera */
  face?: number };
/** sun = world direction TOWARD the sun (optional: when absent the scene's shadow-casting light is used) */
export type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun?: THREE.Vector3 };

const hh = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const q = (v: number, n = 120) => Math.round(v * n) / n;
const vOf = (i: number) => (i * 7 + (i >> 2)) % 4;
/** head-shape seed: 7 shapes, so marching soldiers in step still share canvases */
const seedOf = (i: number) => ((i * 5 + 3) % 7) + 1;
/** drawing resolution by distance: [canvas w, h, scale from the 600 x 1000 design]; sized for the 1440 x 2560 final */
const tier = (d: number): [number, number, number] =>
  d < 3.2 ? [1800, 3000, 3.0] : d < 6.5 ? [1080, 1800, 1.8] : d < 16 ? [480, 800, 0.8] : [240, 400, 0.4];

// ---------------- light ----------------
const SUN = new THREE.Vector3(0.5, 0.75, -0.4).normalize();
const tmp = new THREE.Vector3();
let LNAME: "day" | "golden" = "day";
const sunOf = (root: THREE.Object3D) => {
  let s: THREE.DirectionalLight | null = null;
  root.traverse((o) => { if (!s && o instanceof THREE.DirectionalLight && o.castShadow) s = o; });
  return s as THREE.DirectionalLight | null;
};
/** the sun of the world that is calling: the attached root whose sun target sits on this camera's view axis */
const findSun = (cam: CamInfo, out: THREE.Vector3) => {
  if (cam.sun) return out.copy(cam.sun).normalize();
  let best: THREE.DirectionalLight | null = null, err = Infinity;
  for (const r of ROOTS) {
    if (!r.parent) continue;
    const s = sunOf(r);
    if (!s) continue;
    const d = tmp.copy(s.target.position).sub(cam.pos), e = Math.abs(d.dot(cam.right)) / (d.length() || 1);
    if (e < err) { err = e; best = s; }
  }
  return best ? out.copy(best.position).sub(best.target.position).normalize() : out;
};
/** canvas angle the sun comes FROM on an upright card facing the camera, in 45-degree steps (small texture cache) */
const light2D = (cam: CamInfo, mirror: boolean) => {
  const sx = SUN.dot(cam.right) * (mirror ? -1 : 1), sy = -SUN.y;
  return Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4);
};

/** front / side view and mirroring for someone at (x, z) walking along (dx, dz); fs = foreshortening of the walk */
const viewOf = (cam: CamInfo, x: number, z: number, dx: number, dz: number) => {
  const tx = cam.pos.x - x, tz = cam.pos.z - z, tl = Math.hypot(tx, tz) || 1;
  const c = (tx * dx + tz * dz) / tl;
  return { side: c < 0.57, mirror: dx * cam.right.x + dz * cam.right.z < 0, fs: Math.round(Math.sqrt(Math.max(0, 1 - c * c)) * 20) / 20 };
};

// ---------------- life: blinks and reaction timing ----------------
/** reference expression and action changes land 0-3 f before the word onset */
const LEAD = 2 / FPS;
/** eyelid 0 open .. 1 shut. Reference: gaps 0.5-2.3 s, 4-frame blink half / shut / shut / half, plus a blink across
 *  every expression swap (the shut frames hide the swap) */
const LID = [0.5, 1, 1, 0.5];
const lidAt = (t: number, i: number, swaps: number[] = []) => {
  const f = Math.round(t * FPS);
  for (const ts of swaps) { const k = f - Math.round((ts - LEAD) * FPS) + 1; if (k >= 0 && k < 4) return LID[k]; }
  let s = Math.round(-60 * hh(i, 9));
  for (let n = 0; s <= f && n < 400; n++) {
    const k = f - s;
    if (k >= 0 && k < 4) return LID[k];
    s += Math.round(15 + 54 * hh(i * 31 + n, 13)); // next blink 0.5-2.3 s later
  }
  return 0;
};
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));

type Who = { i: number; o: Outfit; okey: string };
/** one character drawing in the 600 x 1000 design space, sized by distance, lit from the scene's sun */
const person = (cam: CamInfo, who: Who, x: number, y: number, z: number, view: { side: boolean; mirror: boolean }, fo: FrontOpts, so: SideOpts, scale = 1): Place & { tierKey: string } => {
  const d = cam.pos.distanceTo(tmp.set(x, y + 1.2, z)) / scale;
  const [w, h, k] = tier(d);
  const mirror = view.side && view.mirror, light = light2D(cam, mirror), seed = seedOf(who.i);
  const f2: FrontOpts = { ...fo, light, seed }, s2: SideOpts = { ...so, light, seed };
  const key = view.side ? `S|${who.okey}|${fkey(s2)}` : `F|${who.okey}|${fkey(f2)}`;
  return {
    key, x, y, z, scale, mirror, tierKey: `${w}`,
    draw: (p) => (view.side ? bodySide(p, who.o, s2) : bodyFront(p, who.o, f2)),
    size: [w, h, k],
  };
};

/** ground shadow under a standing / sitting card (review rounds 2-4), multiply, blue-violet: a TIGHT contact pool right under
 *  the feet (~.5 on screen at the core) so nobody floats, plus by day (cards cast no real shadow) a lighter soft tail
 *  stretched AWAY from the sun, length ~1.6 m / tan(sun elevation), capped. Golden: world.ts casts real card shadows. */
const CONTACT: Record<"day" | "golden", [number, number, number]> = { day: [0.2, 0.21, 0.33], golden: [0.24, 0.2, 0.33] };
const TAIL: [number, number, number] = [0.42, 0.44, 0.62];
const toSrgb = (v: number) => { const c = clamp01(v); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
const hexOf = (c: [number, number, number], k: number) => "#" + c.map((v) => Math.round(255 * toSrgb(1 - (1 - v) * k)).toString(16).padStart(2, "0")).join("");
const blob = (out: Stage, x: number, y: number, z: number, sc = 1, k = 1) => {
  const hl = Math.hypot(SUN.x, SUN.z) || 1, ox = -SUN.x / hl, oz = -SUN.z / hl, rot = Math.atan2(-ox, -oz);
  if (LNAME === "day") {
    const el = Math.asin(Math.min(0.99, Math.max(0.1, SUN.y)));
    const len = Math.min(2.4, Math.max(0.5, 1.6 / Math.tan(el))) * sc, h = len + 0.55 * sc, c = 0.3 * h; // feet at v = .2 of the card
    const tc = hexOf(TAIL, k);
    out.fx.push({ key: `blob|shadow|${tc}`, cw: 128, ch: 256, draw: (p) => fxShadow(p, tc), x: x + ox * c, y: y + 0.018, z: z + oz * c,
      w: 0.72 * sc, h, flat: true, rot });
  }
  const cc = hexOf(CONTACT[LNAME], k);
  out.fx.push({ key: `blob|contact|${cc}`, cw: 128, ch: 128, draw: (p) => fxContact(p, cc), x: x + ox * 0.03 * sc, y: y + 0.022, z: z + oz * 0.03 * sc,
    w: 0.52 * sc, h: 0.4 * sc, flat: true, rot });
};

// ---------------- shots ----------------
export type Stage = { places: Place[]; fx: FxPlace[] };
const at = (word: number) => word / FPS - LEAD; // a reaction lands ~2 f before the word's first frame
let T0 = 0;
const front = (out: Stage, cam: CamInfo, i: number, o: Outfit, okey: string, x: number, y: number, z: number, fo: FrontOpts, sc = 1, shadow = true) => {
  out.places.push(person(cam, { i, o, okey }, x, y, z, { side: false, mirror: false }, { blink: lidAt(T0 + i * 0.37, i), ...fo }, {}, sc));
  if (shadow) blob(out, x, y, z, sc);
};
const side = (out: Stage, cam: CamInfo, i: number, o: Outfit, okey: string, x: number, y: number, z: number, dx: number, dz: number, so: SideOpts, shadow = true) => {
  const v = viewOf(cam, x, z, dx, dz);
  out.places.push(person(cam, { i, o, okey }, x, y, z, { side: true, mirror: v.mirror }, {}, { blink: lidAt(T0 + i * 0.37, i), ...so }));
  if (shadow) blob(out, x, y, z);
};
const puffs = (out: Stage, t: number, t0: number, pts: [number, number][], y = 0.3, s = 1.6) => {
  const u0 = (t - t0) / 1.2;
  if (u0 < 0 || u0 >= 1) return;
  pts.forEach(([x, z], k) => { const u = q(clamp01(u0 + k * 0.05), 20); out.fx.push({ key: `puff${u}`, cw: 300, ch: 300, draw: (p) => fxPuff(p, u), x, y: y + 0.8 * u, z, w: s * (1 + u), h: s * (1 + u), soft: true }); });
};
/** down arrows pressing on the soil layers (the ground squeezing firm) */
const arrowDown = (p: Pen) => { p.poly([[70, 20], [130, 20], [130, 150], [180, 150], [100, 260], [20, 150], [70, 150]], "#f3d35a", 10); };

const BUILDERS = [0, 1, 2, 3].map((v) => builder(v));
const SOLDIERS = [0, 1, 2].map((v) => pisan(v));
const ENGINEERS = [0, 1, 2].map((v) => engineer(v));
const TOURISTS = [0, 1, 2, 3, 4, 5].map((v) => tourist(v));

/** everything with a face (and every effect) in shot `id` at time t */
export const stage = (id: number, t: number, cam: CamInfo, ts: TowerState): Stage => {
  const out: Stage = { places: [], fx: [] };
  const s = SHOTS[id - 1];
  LNAME = s.light; T0 = t;
  findSun(cam, SUN);
  switch (s.era) {
    case "today": { // tourists; one "holds up" the tower
      front(out, cam, 200, TOURISTS[0], "tour0", 3.9, 0, -24.8, { mode: "stand", expr: "grin", armsUp: 1, wave: 0.2 });
      ([[1.2, -27.5, 1], [-3, -23, 2], [8.8, -21.5, 3], [-6.5, -27, 5]] as const).forEach(([x, z, v], k) =>
        front(out, cam, 201 + k, TOURISTS[v], `tour${v}`, x, 0, z, { mode: "stand", expr: (["smile", "laugh", "smile_closed", "grin"] as Expr[])[k], wave: k === 1 ? q(Math.sin(t * 7), 20) : undefined }, TOURISTS[v].build === "kid" ? 0.72 : 1));
      break;
    }
    case "1173": { // builders at the base; everybody gasps on "tip"
      const tipped = t >= at(362);
      side(out, cam, 10, BUILDERS[0], "b0", -12.0, 0, -9.0, 1, 0, { mode: "push", pose: tipped ? 0 : q(0.5 + 0.5 * Math.sin(t * 3), 20), expr: tipped ? "shock" : "neutral" });
      front(out, cam, 11, BUILDERS[1], "b1", -11.0, 0, -13.5, { mode: "stand", expr: tipped ? "shock" : "smile", prop: tipped ? null : ["hammer", q(0.5 + 0.5 * Math.sin(t * 6), 20)] });
      front(out, cam, 12, BUILDERS[2], "b2", 11.2, 0, -12.5, { mode: "stand", expr: tipped ? "shock" : "proud", prop: tipped ? null : "point" });
      side(out, cam, 13, BUILDERS[3], "b3", 12.2, 0, -8.6, -1, 0, { mode: "push", pose: tipped ? 0 : q(0.5 + 0.5 * Math.sin(t * 2.6 + 1), 20), expr: tipped ? "shock" : "grin" });
      puffs(out, t, at(362), [[R - 1, -4], [R + 0.5, 0], [R - 1, 4]]);
      break;
    }
    case "war": {
      // Pisan soldiers march out, back, out again across the south lawn (south of the pit)
      for (let i = 0; i < 6; i++) {
        const m = marchX(t, i);
        if (!m.on) continue;
        side(out, cam, 20 + i, SOLDIERS[i % 3], `ps${i % 3}`, m.x, 0, -24.5 - (i % 2) * 1.1, m.dir, 0, { mode: "march", phase: q((t * 1.0 + 0.5 * (i % 2)) % 1, 60), stomp: 1.1, expr: i % 3 === 1 ? "grin" : "stern" });
      }
      // the ground squeezing firm: arrows pressing down on the section wall
      if (ts.pit && t > at(874)) for (let k = 0; k < 3; k++) {
        const u = (t * 0.9 + k / 3) % 1;
        out.fx.push({ key: "arrowDown", cw: 200, ch: 280, draw: arrowDown, x: -5 + k * 5, y: -3.2 - 1.2 * u, z: PIT.z1 - 0.3, w: 0.9, h: 1.26, face: Math.PI });
      }
      // the builder and the memory-foam mattress: sinks on "sinks", then holds
      const top = 0.5 * (1 - 0.38 * smooth((t * FPS - SIT_AT) / 9));
      if (t < at(1018)) front(out, cam, 30, BUILDERS[1], "b1", MATTRESS[0] - 1.6, 0, MATTRESS[2] - 0.3, { mode: "stand", expr: "smile", facing: 1 });
      else front(out, cam, 30, BUILDERS[1], "b1", MATTRESS[0], top - 0.08, MATTRESS[2] - 0.2, { mode: "sit", expr: t < at(1077) ? "shock" : "relief" }, 1, false);
      break;
    }
    case "1272": { // the builders are back; a giant banana pops up for comparison on "banana"
      side(out, cam, 10, BUILDERS[0], "b0", -10.5, 0, -10.5, 1, 0, { mode: "push", pose: q(0.5 + 0.5 * Math.sin(t * 3), 20), expr: "grin" });
      front(out, cam, 11, BUILDERS[1], "b1", -5.5, 0, -12.5, { mode: "stand", expr: "proud", prop: ["hammer", q(0.5 + 0.5 * Math.sin(t * 6), 20)] });
      front(out, cam, 12, BUILDERS[2], "b2", 3.0, 0, -12.2, { mode: "stand", expr: t > at(1342) ? "laugh" : "smile", prop: "point" });
      const pop = smooth((t - at(1373)) / 0.3);
      if (pop > 0) out.fx.push({ key: "banana", cw: 300, ch: 900, draw: fxBanana, x: BANANA[0], y: 13 * pop, z: BANANA[2], w: 8.7 * pop, h: 26 * pop });
      break;
    }
    case "1934": { // the dictator orders it straightened; concrete goes in; it lurches
      const lurched = t >= at(1585);
      front(out, cam, 40, DICTATOR, "dict", -8, 0, -20, { mode: "stand", expr: lurched ? "shock" : t > at(1467) ? "stern" : "angry", prop: lurched ? null : "point", facing: 1 });
      side(out, cam, 41, worker(0), "wk0", -13.0, 0, -1.2, 1, 0, { mode: "push", pose: q(0.5 + 0.5 * Math.sin(t * 4), 20), expr: lurched ? "shock" : "neutral" });
      side(out, cam, 42, worker(2), "wk2", -9.8, 0, -5.6, 1, 0, { mode: "push", pose: q(0.5 + 0.5 * Math.sin(t * 4 + 1.5), 20), expr: lurched ? "shock" : "grin" });
      puffs(out, t, at(1585), [[R, -5], [R + 1, 0], [R, 5], [-R, 0]], 0.3, 2.2);
      break;
    }
    case "1990": { // closed; lead weights, soil drills; cheers as it eases back
      const eased = t >= at(1944);
      front(out, cam, 50, ENGINEERS[0], "en0", -R - 3.8, 0, 2.6, { mode: "stand", expr: eased ? "laugh" : "neutral", armsUp: eased ? q(0.8 + 0.2 * Math.sin(t * 7), 20) : 0 });
      side(out, cam, 51, ENGINEERS[1], "en1", -R - 6.9, 0, -5.4, 1, 0, { mode: "push", pose: q(0.6 + 0.3 * Math.sin(t * 5), 20), expr: eased ? "grin" : "neutral" });
      front(out, cam, 52, ENGINEERS[2], "en2", -14.5, 0, -8.5, { mode: "stand", expr: eased ? "relief_open" : "stern", prop: eased ? null : "pen", armsUp: eased ? q(0.8 + 0.2 * Math.sin(t * 6 + 1), 20) : 0, facing: 1 });
      if (t > at(1855) && t < at(1975)) for (let k = 0; k < 2; k++) {
        const u = q((t * 0.8 + k * 0.5) % 1, 20);
        out.fx.push({ key: `puff${u}`, cw: 300, ch: 300, draw: (p) => fxPuff(p, u, "#9a8468"), x: -R - 2.2, y: 0.3 + 0.6 * u, z: -4 + k * 0.6, w: 1.2 + u, h: 1.2 + u, soft: true });
      }
      break;
    }
    case "1944": { // the sergeant walks in, raises his binoculars at the tower, lowers them and smiles
      const walk = clamp01((t - 66.6) / 4.5), x = -16 + 10 * smooth(walk);
      if (walk < 1) side(out, cam, 60, SERGEANT, "sgt", x, 0, -30.5, 1, 0, { mode: "march", phase: q((t * 0.9) % 1, 60), stomp: 0.7, expr: "neutral" });
      else {
        const up = t >= at(2163) && t < at(2302), expr: Expr = t < at(2302) ? "neutral" : t < at(2335) ? "smile" : "relief";
        front(out, cam, 60, SERGEANT, "sgt", -6, 0, -30.5, { mode: "stand", expr, prop: "binoculars", wave: up ? 1 : 0 });
      }
      side(out, cam, 61, SERGEANT, "sgt", -15, 0, -37.5, 1, 0, { mode: "stand", expr: "neutral" });
      break;
    }
  }
  return out;
};
export { FPS };
