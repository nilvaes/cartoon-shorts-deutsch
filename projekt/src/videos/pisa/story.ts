// Timeline of "The Leaning Tower That War Saved": 7 long camera journeys through ONE place (the piazza around the
// tower) timed to the voice words (voice/leaning-tower/words.json, 30 fps frames). The years change around the tower
// (today, 1173, the wars, 1272, 1934, 1990, 1944) while the camera keeps flying: Catmull-Rom paths through key
// framings instead of cuts, a flash after the hook and crossfades between eras.
export const FPS = 30;
export const TOTAL = 2475;
export const D0 = 0; // ground level (the shared builders take their default base height from here)
export type V3 = [number, number, number];

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 4;
const T = (f: number) => f / FPS;

// ---------------- the place ----------------
export const R = 7.5;                 // tower radius (m); it leans toward +x (screen right from the south)
export const H0 = 11, HS = 4.6, HB = 7; // ground storey, gallery storeys (6), bell chamber
export const PIT = { x0: -10, x1: 10, z0: -22, z1: -9, depth: 14 }; // cutaway pit south of the tower
export const MATTRESS: V3 = [15, 0, -18];
export const BANANA: V3 = [13.5, 0, -10];
export const PUMP: V3 = [-11, 0, -3];  // 1934 concrete pump (west, the high side)
export const SIGN: V3 = [9, 0, -22];   // 1990 "closed" pictogram

// ---------------- shots = eras ----------------
export type Light = "day" | "golden";
export type Era = "today" | "1173" | "war" | "1272" | "1934" | "1990" | "1944";
export type ShotDef = { id: number; a: number; b: number; light: Light; era: Era };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 132, light: "day", era: "today" },
  { id: 2, a: 132, b: 560, light: "day", era: "1173" },
  { id: 3, a: 560, b: 1112, light: "day", era: "war" },
  { id: 4, a: 1112, b: 1395, light: "day", era: "1272" },
  { id: 5, a: 1395, b: 1618, light: "day", era: "1934" },
  { id: 6, a: 1618, b: 2005, light: "day", era: "1990" },
  { id: 7, a: 2005, b: TOTAL, light: "golden", era: "1944" },
];
export const XFADE: Record<number, number> = { 3: 10, 4: 10, 5: 12, 6: 12, 7: 14 }; // short dissolves between eras (the reference never hard-cuts)
export const FLASH_AT = 130;
export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---------------- the tower's story state ----------------
const EXAG = 1.3; // lean exaggerated a little so the tilt reads on a phone
export type TowerState = { storeys: number; bell: boolean; tilt: number; bend: number; squeeze: number; overgrown: number; pit: boolean };
export const TIP = 362, LURCH = 1585, EASE0 = 1940;
export const towerAt = (id: number, f: number): TowerState => {
  const s: TowerState = { storeys: 7, bell: true, tilt: 4.0, bend: 0.45, squeeze: 1, overgrown: 0, pit: false };
  switch (id) {
    case 2: s.storeys = 1 + smooth((f - 190) / 110); s.bell = false; s.bend = 0; s.squeeze = 0;
      s.tilt = 1.2 * smooth((f - 263) / 99) + (f >= TIP ? 0.25 * Math.exp(-(f - TIP) / 6) * Math.cos((f - TIP) * 1.3) : 0);
      s.pit = f >= 372; break;
    case 3: s.storeys = 2; s.bell = false; s.bend = 0; s.tilt = 1.3; s.squeeze = smooth((f - 860) / 100);
      s.overgrown = smooth((f - 760) / 40); s.pit = f < 610 || (f >= 815 && f < 1028); break; // open until the lens has climbed out
    case 4: s.storeys = 2 + 5 * smooth((f - 1121) / 150); s.bell = false; s.tilt = 1.6; break;
    case 5: s.tilt = 4.6 + 0.7 * smooth((f - LURCH) / 7); break;
    case 6: s.tilt = 5.5 - 1.5 * smooth((f - EASE0) / 45); break;
    case 7: s.tilt = 4.8; break;
  }
  s.tilt *= EXAG;
  return s;
};

// ---------------- story motion ----------------
/** medieval soldiers march across the south lawn: out (+x), back (-x), out again */
export const marchX = (t: number, i: number) => {
  const u = t - 18.6 - i * 0.22, leg = 2.3, d = 46;
  const k = Math.floor(u / leg), r = u / leg - k;
  const dir = k % 2 === 0 ? 1 : -1;
  return { x: dir > 0 ? -23 + d * r : 23 - d * r, dir, on: u >= 0 && u < 3 * leg };
};
export const SIT_AT = 1020; // the builder sinks into the mattress on "sinks"

// ---------------- camera: Catmull-Rom journeys ----------------
export type Cam = { pos: V3; look: V3; fov: number; roll: number };
type Key = { f: number; pos: V3; look: V3; fov?: number; roll?: number };
const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
/** monotone cubic (PCHIP) tangent per component: no overshoot past the framings (Catmull-Rom on uneven keys needed
 *  guide keys); each span is only partly eased, so the lens slows on a framing but never rests (v2 look) */
const tan = (y0: number, y1: number, y2: number) => { const d0 = y1 - y0, d1 = y2 - y1; return d0 * d1 <= 0 ? 0 : 2 / (1 / d0 + 1 / d1); };
const herm = (y1: number, y2: number, m1: number, m2: number, u: number) =>
  (2 * u ** 3 - 3 * u ** 2 + 1) * y1 + (u ** 3 - 2 * u ** 2 + u) * m1 + (-2 * u ** 3 + 3 * u ** 2) * y2 + (u ** 3 - u ** 2) * m2;
const smoother = (x: number) => { const u = clamp01(x); return u * u * u * (u * (6 * u - 15) + 10); };
const EASE = 0.25;
const journey = (keys: Key[]) => (f: number): Cam => {
  if (f <= keys[0].f) return { pos: keys[0].pos, look: keys[0].look, fov: keys[0].fov ?? 44, roll: keys[0].roll ?? 0 };
  let i = 0; while (i < keys.length - 2 && f > keys[i + 1].f) i++;
  const a = keys[i - 1], b = keys[i], c = keys[i + 1], d = keys[i + 2];
  const raw = clamp01((f - b.f) / (c.f - b.f)), u = raw + EASE * (smoother(raw) - raw);
  const P = (k: "pos" | "look") => [0, 1, 2].map((j) => {
    const y1 = b[k][j], y2 = c[k][j], m1 = a ? tan(a[k][j], y1, y2) : y2 - y1, m2 = d ? tan(y1, y2, d[k][j]) : y2 - y1;
    return herm(y1, y2, m1, m2, u);
  }) as V3;
  const L = (x?: number, y?: number) => (x ?? 44) + ((y ?? 44) - (x ?? 44)) * u;
  return { pos: P("pos"), look: P("look"), fov: L(b.fov, c.fov), roll: (b.roll ?? 0) + ((c.roll ?? 0) - (b.roll ?? 0)) * u };
};

const J: Record<number, (f: number) => Cam> = {
  // today: close on a tourist "holding up" the tower, pull back and up to reveal it
  1: journey([
    { f: 0, pos: [3.5, 1.4, -31.5], look: [5, 3.2, -18], fov: 42 },
    { f: 70, pos: [1, 2.5, -38], look: [4, 12, 0], fov: 46 },
    { f: 132, pos: [-3, 4.5, -50], look: [4, 18, 0], fov: 48 },
  ]),
  // 1173: builders at the base, rise with floor two, swing round for the tip, dive into the cutaway pit
  2: journey([
    { f: 132, pos: [-15, 2.0, -21], look: [0, 4, 0], fov: 44 },
    { f: 230, pos: [-11, 8, -26], look: [0, 10, 0], fov: 44 },
    { f: 330, pos: [9, 11, -34], look: [2, 9, 0], fov: 44, roll: 0.03 },
    { f: 368, pos: [7.5, 9.5, -33], look: [1.6, 8.5, -2], fov: 44 },
    { f: 400, pos: [1, 2.5, -24], look: [0, -2, -9], fov: 46 },
    { f: 445, pos: [0, -5.5, -19.5], look: [0, -4.5, -9], fov: 48 },
    { f: 560, pos: [0.4, -6.2, -18.2], look: [0, -4, -9], fov: 46 },
  ]),
  // the wars: up out of the pit, soldiers march past (again and again), the stump grows over,
  // back down to see the soil squeeze firm, then over to the builder on the memory-foam mattress
  3: journey([
    { f: 560, pos: [0.4, -6.2, -18.2], look: [0, -4, -9], fov: 46 },
    { f: 625, pos: [-4, 2.4, -33], look: [0, 2.6, -14], fov: 44 },
    { f: 720, pos: [-19, 2.2, -31], look: [0, 2.8, -16], fov: 44 },
    { f: 790, pos: [-10, 6, -24], look: [0, 6, 0], fov: 44 },
    { f: 840, pos: [0, 2.5, -24], look: [0, -2, -9], fov: 46 },
    { f: 890, pos: [0, -5.5, -19.5], look: [0, -4.5, -9], fov: 48 },
    { f: 975, pos: [0.3, -6.3, -18.6], look: [0, -4.8, -9], fov: 46 },
    { f: 1030, pos: [12, 1.8, -24], look: [15, 0.9, -18], fov: 42 },
    { f: 1112, pos: [13.5, 1.6, -22.5], look: [15, 0.9, -18], fov: 40 },
  ]),
  // 1272: crane up the tower as new floors stack, then pull far back for the banana curve
  4: journey([
    { f: 1112, pos: [-12, 3, -26], look: [0, 12, 0], fov: 44 },
    { f: 1265, pos: [-16, 30, -40], look: [2, 26, 0], fov: 44 },
    { f: 1330, pos: [-6, 22, -62], look: [4, 21, 0], fov: 42 },
    { f: 1395, pos: [-2, 21, -66], look: [6, 21, 0], fov: 44 },
  ]),
  // 1934: Mussolini points, glide to the concrete pump, pull back for the lurch
  5: journey([
    { f: 1388, pos: [-15, 2.2, -30], look: [-8, 2.0, -20], fov: 42 },
    { f: 1465, pos: [-14, 2.1, -28], look: [-8, 2.0, -20], fov: 40 },
    { f: 1525, pos: [-19, 2.6, -15], look: [-10, 1.4, -3], fov: 42 },
    { f: 1570, pos: [-8, 9, -46], look: [2, 20, 0], fov: 46 },
    { f: 1618, pos: [-7, 10, -50], look: [3, 21, 0], fov: 46 },
  ]),
  // 1990: past the barrier + sign, round to the lead weights and the soil drills, pull back as it eases upright
  6: journey([
    { f: 1611, pos: [15, 2.0, -31], look: [3, 8, 0], fov: 44 },
    { f: 1720, pos: [-25, 4, -19], look: [-9, 2, 0], fov: 44 },
    { f: 1840, pos: [-21, 2.5, -8], look: [-10, 1, 0], fov: 42 },
    { f: 1925, pos: [-2, 8, -52], look: [3, 22, 0], fov: 46 },
    { f: 2005, pos: [0, 8.5, -56], look: [3, 22, 0], fov: 46 },
  ]),
  // 1944: the sergeant walks in, lifts his binoculars, lowers them and smiles; crane out over the piazza at sunset
  7: journey([
    { f: 1997, pos: [-15, 1.8, -38], look: [-9, 1.6, -30.5], fov: 42 },
    { f: 2120, pos: [-9.5, 1.8, -36], look: [-6.5, 1.7, -30.5], fov: 42 },
    { f: 2160, pos: [-11.5, 1.9, -30], look: [-6.2, 1.8, -30.5], fov: 42 },
    { f: 2200, pos: [-5.4, 1.9, -25.4], look: [-6, 1.8, -30.5], fov: 40 },
    { f: 2300, pos: [-5.1, 1.75, -26.6], look: [-6, 1.75, -30.5], fov: 38 },
    { f: 2385, pos: [-4.6, 2.6, -24.6], look: [-6, 2.2, -30.5], fov: 42 },
    { f: 2420, pos: [-10, 9, -40], look: [-3, 9, -14], fov: 44 }, // guide key: keeps the spline from dipping under the lawn
    { f: TOTAL, pos: [-34, 42, -84], look: [0, 20, 0], fov: 46 },
  ]),
};

// impact kicks: image offset flips sign every frame, decays to 0 in 7 f
const KICKS: [number, number][] = [[T(TIP), 1.2], [T(LURCH), 1.4], [T(SIT_AT), 0.4]];
export const kickAt = (t: number) => {
  let a = 0;
  for (const [t0, g] of KICKS) {
    const n = Math.floor((t - t0) * FPS + 1e-6);
    if (n >= 0 && n < 7) a += g * (n % 2 ? -1 : 1) * (1 - n / 7) ** 1.5;
  }
  return a;
};
/** the lens may only go below the lawn inside the cutaway pit (Catmull-Rom overshoot once dipped it under the ground) */
const aboveGround = (c: Cam): Cam => {
  const [x, y, z] = c.pos, inPit = x > PIT.x0 + 0.3 && x < PIT.x1 - 0.3 && z > PIT.z0 + 0.3 && z < PIT.z1 - 0.3;
  return inPit || y >= 0.5 ? c : { ...c, pos: [x, 0.5, z] };
};
/** the reference's lens: wider and a little closer for the same subject size, slightly lower, plus a slow orbit so a
 *  framing never sits still (v2 look, as in the pyramid short) */
const WIDE = 8, ORBIT = 0.0016; // Pisa: wider without moving in (subjects here often stand well in front of the camera target)
const lens = (c: Cam, f: number): Cam => {
  const fov = c.fov + WIDE, k = 1;
  const d: V3 = [c.pos[0] - c.look[0], c.pos[1] - c.look[1], c.pos[2] - c.look[2]];
  const th = 0.16 * Math.sin(ORBIT * f), ca = Math.cos(th), sa = Math.sin(th);
  const dx = d[0] * ca - d[2] * sa, dz = d[0] * sa + d[2] * ca;
  return { ...c, fov, pos: [c.look[0] + dx * k, c.look[1] + d[1] * k * 0.88 - 0.04, c.look[2] + dz * k] };
};
export const camAt = (id: number, f: number): Cam => {
  const c = aboveGround(lens(J[id](f), f)), a = kickAt(T(f));
  if (!a) return c;
  const d: V3 = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
  const L = Math.hypot(...d), h = Math.hypot(d[0], d[2]) || 1;
  const m = (3 / 640) * Math.tan((c.fov * Math.PI) / 360) * L * a;
  return { ...c, look: [c.look[0] - (d[2] / h) * m, c.look[1] + 0.6 * m, c.look[2] + (d[0] / h) * m], roll: c.roll + a * 0.004 };
};
export const keyEnd = (_id: number, f: number) => f;

// ---------------- lens ----------------
export type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
export const DOF: Dof[] = [
  { f: 0, cInf: 10, focus: () => [3.9, 1.6, -24.8] }, { f: 60, dur: 40, cInf: 0 },
  { f: 132, cInf: 8 }, { f: 300, dur: 40, cInf: 0 },
  { f: 400, dur: 30, cInf: 6 },       // the pit
  { f: 590, dur: 30, cInf: 0 },
  { f: 830, dur: 30, cInf: 6 }, { f: 1000, dur: 30, cInf: 10 }, // pit again, then the mattress
  { f: 1112, cInf: 0 },
  { f: 1395, cInf: 10 }, { f: 1520, dur: 40, cInf: 0 },
  { f: 1618, cInf: 0 }, { f: 1700, dur: 40, cInf: 8 }, { f: 1880, dur: 40, cInf: 0 },
  { f: 2005, cInf: 11 }, { f: 2200, dur: 30, cInf: 0 }, { f: 2290, dur: 20, cInf: 11 }, { f: 2390, dur: 50, cInf: 0 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus ?? (k < 1 ? p.focus : undefined) };
};
export const focusAt = (id: number, f: number): V3 => { const d = dofAt(f); return d.focus ? d.focus(f) : camAt(id, f).look; };
export type Fg = { a: number; b: number; kit: string; pos: V3; s?: number; yaw?: number };
export const FOREGROUND: Fg[] = [];

// ---------------- framing check (tools/framecheck.mjs): what must stay inside the frame, and when ----------------
const head = (x: number, z: number, y0 = 0): V3[] => [[x, y0 + 2.1, z], [x, y0 + 1.5, z]];
export const FOCUS: { a: number; b: number; what: string; pts: V3[] | ((f: number) => V3[]) }[] = [
  { a: 0, b: 30, what: "tourist", pts: head(5.6, -24.5) }, // then the lens pulls back to reveal the tower
  { a: 134, b: 158, what: "builder", pts: head(-5.5, -12.5) },
  { a: 350, b: 372, what: "tower (tip)", pts: [[2, 15.5, -6], [0, 0.5, -7.5]] },
  { a: 1035, b: 1105, what: "mattress builder", pts: [[15, 1.5, -18.2], [15, 0.7, -18.2]] },
  { a: 1378, b: 1392, what: "banana", pts: [[13.5, 30, -10], [13.5, 4, -10]] },
  { a: 1405, b: 1478, what: "dictator", pts: head(-8, -20) },
  { a: 1590, b: 1612, what: "tower (lurch)", pts: [[6, 44, 0], [0, 1, -7.5]] },
  { a: 1990, b: 2000, what: "tower (eased)", pts: [[5, 44, 0], [0, 1, -7.5]] },
  { a: 2140, b: 2380, what: "sergeant", pts: head(-6, -30.5) },
];

// ---------------- German edition: a time map from the German voice to the English timeline ----------------
// pairs [English frame, German frame]: every sentence start plus the key words (kippen, Matratze, Banane, Beton,
// gesperrt, Sergeant, Krieg …) from voice/leaning-tower-de/words.json. Everything in between stretches linearly,
// so animation, camera, effects and sound all follow the German narration.
export const TOTAL_DE = 2717;
const WARP_DE: [number, number][] = [
  [0, 0], [22, 15], [118, 116], [140, 149], [263, 293], [362, 401], [385, 419], [565, 584], [623, 658], [647, 676],
  [727, 770], [788, 832], [832, 881], [970, 1021], [989, 1042], [1121, 1195], [1282, 1366], [1342, 1426], [1351, 1443],
  [1357, 1458], [1378, 1481], [1406, 1539], [1508, 1630], [1534, 1676], [1573, 1712], [1585, 1726], [1621, 1755],
  [1743, 1901], [1772, 1931], [2011, 2176], [2103, 2268], [2163, 2356], [2302, 2484], [2384, 2588], [2425, 2655],
  [TOTAL, TOTAL_DE],
];
const lerpMap = (x: number, pairs: [number, number][], from: 0 | 1) => {
  const to = 1 - from;
  if (x <= pairs[0][from]) return pairs[0][to];
  for (let i = 1; i < pairs.length; i++) if (x <= pairs[i][from]) { const a = pairs[i - 1], b = pairs[i]; return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]); }
  return pairs[pairs.length - 1][to];
};
/** German frame -> English story frame (what the scene shows) and back (for sound cues) */
export const de2en = (f: number) => lerpMap(f, WARP_DE, 1);
export const en2de = (f: number) => lerpMap(f, WARP_DE, 0);
