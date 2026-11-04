// The piazza around the Leaning Tower as one three.js scene: sky, lawn and paths, the cathedral, the city wall and
// houses, the tower itself (storeys that grow, lean from the low-side base edge and bend back above floor three),
// the cutaway pit with its soil section, and the props of each era. update(id, f, camera) poses everything for
// shot `id` at frame f (a pure function of id + f).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { staticFile } from "remotion";
import { Batch, boxGeo, V, lam, Kit, kitClone, prop, house } from "./build";
import { ctex, rep, stoneHD, grassHD, cloudHD, beamHD, marbleStorey, stripedMarble, soilSection, noEntrySign, barrierTex, roofHD } from "./paint";
import { LIGHTS, LOOK, LightPreset } from "./lights";
import { TONE, CHAR, twoTone, untone } from "./shade";
import { NOINK } from "./ink";
import { Pool, Actor, Fx, stage } from "./cast";
import { FPS, SHOTS, camAt, V3, FOREGROUND, ShotDef, R, H0, HS, HB, PIT, MATTRESS, PUMP, SIGN, towerAt, SIT_AT, smooth } from "./story";

const KENNEY = ["tree_oak", "tree_default", "tree_detailed", "tree_fat", "tree_cone", "tree-high-round", "tree", "plant_bushLarge", "plant_bushDetailed",
  "plant_bush", "hedge", "flower_redA", "flower_yellowA", "flower_purpleA", "lantern", "cart"];
let kitP: Promise<Kit> | null = null;
export const loadKit = () => {
  if (!kitP) {
    const loader = new GLTFLoader();
    kitP = Promise.all(KENNEY.map((n) => loader.loadAsync(staticFile(`bridge/kenney/${n}.glb`)).then((g) => [n, g.scene] as const).catch(() => [n, null] as const)))
      .then((list) => Object.fromEntries(list.filter((e) => e[1]).map(([n, s]) => [n, s!])) as Kit);
  }
  return kitP;
};

const discTex = () => ctex("sunDisc", 128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 58, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const haloTex = () => ctex("sunHalo", 256, 256, (g) => {
  const im = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = Math.hypot(x - 127.5, y - 127.5) / 128;
    const a = (0.55 * Math.exp(-((u / 0.25) ** 2)) + 0.35 * Math.exp(-((u / 0.6) ** 2))) * (1 - Math.min(1, Math.max(0, (u - 0.8) / 0.2)));
    const i = (y * 256 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(255 * Math.min(1, a));
  }
  g.putImageData(im, 0, 0);
});
/** per-shot sun: front-light the tower from the south-east by day, a low sunset behind-left for 1944 */
// by day the sun sits only ~35 deg right of the lens so most of the round tower we see is lit (cream, not lavender)
const SUN_SHOT: Record<number, { az?: number; el?: number }> = { 1: { az: 35 }, 2: { az: 35 }, 3: { az: 40 }, 4: { az: 35 }, 5: { az: 35 }, 6: { az: 35 }, 7: { az: -40, el: 10 } };

const H_STOREY = (k: number) => (k === 0 ? H0 : k === 7 ? HB : HS);
const SQ_STEPS = 5;

export class World {
  root = new THREE.Group();
  private pool = new Pool();
  private actors: Actor[] = [];
  private fxs: Fx[] = [];
  private hemi: THREE.HemisphereLight; private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private fog = new THREE.Fog("#bccbec", 25, 420);
  private sunDisc: THREE.Sprite; private sunHalo: THREE.Sprite;
  private sunCache = new Map<number, THREE.Vector3>();
  private cloudMaps: Record<"day" | "golden", THREE.Texture[]>;
  private clouds: THREE.Mesh[] = [];
  private fgs: { o: THREE.Object3D; a: number; b: number }[] = [];
  // the tower: pivot on the low-side base edge -> base -> storey chain
  private pivot = new THREE.Group(); private storeys: THREE.Group[] = [];
  private lid: THREE.Mesh; private pitGroup = new THREE.Group(); private soilWall: THREE.Mesh; private soilMats: THREE.Material[] = [];
  private eras: Record<string, THREE.Group> = {};
  private mattress: THREE.Mesh;
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4(); private v = new THREE.Vector3(); private sph = new THREE.Sphere();

  constructor(kit: Kit) {
    const Rt = this.root;
    // ---- sky + light ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() },
        c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() }, e: { value: new THREE.Vector4() } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 c0, c1, c2, c3, c4; uniform vec4 e; varying vec3 vP;
        void main(){ float el = asin(clamp(normalize(vP).y, -1.0, 1.0));
          vec3 c = mix(c0, c1, smoothstep(0.0, e.x, el)); c = mix(c, c2, smoothstep(e.x, e.y, el));
          c = mix(c, c3, smoothstep(e.y, e.z, el)); c = mix(c, c4, smoothstep(e.z, e.w, el)); gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 48, 24), this.skyMat);
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.layers.set(NOINK); Rt.add(this.sky);
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex(), color: new THREE.Color(6.0, 4.4, 2.4), fog: false, depthWrite: false }));
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(1, 1, 1), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunDisc.renderOrder = -0.5; this.sunHalo.renderOrder = 5;
    for (const m of [this.sunDisc, this.sunHalo]) { m.frustumCulled = false; m.layers.set(NOINK); Rt.add(m); }
    this.hemi = new THREE.HemisphereLight("#cfe6ff", "#6c5c8c", 1.1);
    this.sun = new THREE.DirectionalLight("#fff0d6", 2.6); this.sun.castShadow = true; this.sun.shadow.mapSize.set(4096, 4096);
    Rt.add(this.hemi, this.sun, this.sun.target);
    this.cloudMaps = { day: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.day.cloud)), golden: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.golden.cloud)) };
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3, d = 620 + (i % 3) * 60;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMaps.day[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      const w = 130 + (i % 4) * 30; m.position.set(Math.cos(a) * d, 120 + (i % 4) * 38, Math.sin(a) * d); m.scale.set(w, w / 2, 1); m.layers.set(NOINK);
      this.clouds.push(m); Rt.add(m);
    }

    // ---- ground: lawn with a hole for the pit, stone paths, the pit lid ----
    const b = new Batch();
    const lawn = lam("lawnHD", () => ({ map: grassHD(), color: "#adbf8f" })), path = lam("pathStone", () => ({ map: stoneHD("pisaPath", ["#e6dccd", "#ddd3c3", "#ece4d6", "#d6cbba"], "#aea293") }));
    const P = PIT;
    for (const [x0, x1, z0, z1] of [[-600, 600, P.z1, 600], [-600, 600, -600, P.z0], [-600, P.x0, P.z0, P.z1], [P.x1, 600, P.z0, P.z1]])
      b.add(flat(x0, x1, z0, z1, 0, (x1 - x0) / 4, (z1 - z0) / 4), lawn);
    b.add(ring(R + 0.4, R + 4.2, 0.012, 48), path);                 // paving round the tower
    b.add(flat(-2.4, 2.4, -120, P.z0, 0.012, 1.2, 25), path);        // path south to the town
    b.add(flat(-120, -16, -2.4, 2.4, 0.012, 26, 1.2), path);         // path west to the cathedral
    // ---- the cathedral (west): striped marble nave, aisles, transept, dome, apse ----
    const marble = lam("stripedMarble", () => ({ map: rep(stripedMarble(), 1, 1) }));
    const leadRoof = lam("leadRoof", () => ({ map: roofHD("#8f97a8", true), side: THREE.DoubleSide }));
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => b.add(boxGeo(V(x0, y0, z0), V(x1, y1, z1), 8), marble);
    box(-125, -38, 0, 24, -12, 12); box(-125, -38, 0, 14, -22, -12); box(-125, -38, 0, 14, 12, 22); box(-78, -62, 0, 22, -40, 40);
    gable(b, leadRoof, -125.5, -37.5, 24, 30, -12.5, 12.5); gable(b, leadRoof, -125.5, -37.5, 14, 16.5, -22.5, -12); gable(b, leadRoof, -125.5, -37.5, 14, 16.5, 12, 22.5);
    gableZ(b, leadRoof, -78.5, -61.5, 22, 28, -40.5, 40.5);
    b.add(new THREE.CylinderGeometry(9, 9, 6, 24), marble, new THREE.Matrix4().makeTranslation(-70, 33, 0));
    b.add(new THREE.SphereGeometry(9.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), leadRoof, new THREE.Matrix4().makeTranslation(-70, 36, 0));
    b.add(new THREE.CylinderGeometry(11, 11, 18, 24, 1, false, 0, Math.PI), marble, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(-38, 9, 0));
    // ---- city wall (north) and the town (south + east), hills, trees ----
    const brick = lam("wallBrick", () => ({ color: "#c9845e" }));
    b.add(boxGeo(V(-300, 0, 72), V(300, 9, 76), 4), brick);
    for (let x = -300; x < 300; x += 4) b.add(boxGeo(V(x, 9, 72), V(x + 2, 10.4, 76)), brick);
    for (let x = -110; x < 120; x += 10) house(b, x, -72 - (Math.abs(x) % 3), 0, 9, 8, [7, 8.4, 9.8][Math.abs(x / 10) % 3], Math.abs(x / 10) % 8, 0);
    for (let z = -60; z < 60; z += 10) house(b, 78 + (Math.abs(z) % 3), z, -Math.PI / 2, 9, 8, [8.4, 7, 9.8][Math.abs(z / 10) % 3], (Math.abs(z / 10) + 3) % 8, 0);
    const hill = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const hm = [lam("hillA", () => ({ color: "#78b257" })), lam("hillB", () => ({ color: "#6aa24e" }))];
    ([[-360, 250, 190, 52, 120], [140, 380, 240, 64, 140], [430, 150, 170, 48, 130], [-440, -130, 190, 44, 150], [320, -330, 210, 54, 130]] as const)
      .forEach(([x, z, sx, sy, sz], i) => b.add(hill, hm[i % 2], new THREE.Matrix4().compose(V(x, -2, z), new THREE.Quaternion(), V(sx, sy, sz))));
    for (const [n, x, z, h] of [["tree-high-round", 40, 40, 11], ["tree", 52, 30, 10], ["tree-high-round", -20, 55, 11], ["tree_oak", 46, -40, 9], ["tree", -30, -48, 10], ["tree_cone", 60, 55, 12]] as const)
      prop(b, kit, n, x, 0, z, h, x);
    b.build(Rt);
    this.lid = new THREE.Mesh(flat(P.x0, P.x1, P.z0, P.z1, 0, (P.x1 - P.x0) / 4, (P.z1 - P.z0) / 4), lawn); this.lid.receiveShadow = true; Rt.add(this.lid);

    // ---- the cutaway pit: soil section on the back wall (faces the camera), plain soil sides and floor ----
    // unlit: the pit sits in shadow and the two-tone shade turned the painted layers into one flat purple
    const pb = new Batch(), soil = new THREE.MeshBasicMaterial({ color: "#6e5640" });
    for (let k = 0; k <= SQ_STEPS; k++) this.soilMats.push(new THREE.MeshBasicMaterial({ map: soilSection(k / SQ_STEPS), color: "#ebe4dc" }));
    pb.add(quad4(V(P.x0, 0, P.z0), V(P.x0, 0, P.z1), V(P.x0, -P.depth, P.z1), V(P.x0, -P.depth, P.z0)), soil);
    pb.add(quad4(V(P.x1, 0, P.z1), V(P.x1, 0, P.z0), V(P.x1, -P.depth, P.z0), V(P.x1, -P.depth, P.z1)), soil);
    pb.add(flat(P.x0, P.x1, P.z0, P.z1, -P.depth, 4, 3), soil);
    pb.build(this.pitGroup, false);
    this.soilWall = new THREE.Mesh(quad4(V(P.x0, 0, P.z1), V(P.x1, 0, P.z1), V(P.x1, -15, P.z1), V(P.x0, -15, P.z1), true), this.soilMats[0]); // faces -z (the pit)
    this.soilWall.position.z = -0.01; this.pitGroup.add(this.soilWall);
    this.pitGroup.visible = false; Rt.add(this.pitGroup);

    // ---- the tower ----
    Rt.add(this.pivot); this.pivot.position.set(R, 0, 0);
    const base = new THREE.Group(); base.position.set(-R, 0, 0); this.pivot.add(base);
    let parent: THREE.Object3D = base;
    for (let k = 0; k < 8; k++) {
      const g = this.buildStorey(k); g.position.y = k === 0 ? 0 : H_STOREY(k - 1);
      parent.add(g); this.storeys.push(g); parent = g;
    }

    // ---- era props ----
    const era = (name: string, fill: (bb: Batch) => void) => { const g = new THREE.Group(), bb = new Batch(); fill(bb); bb.build(g); g.visible = false; Rt.add(g); this.eras[name] = g; };
    const wood = lam("scaffWood", () => ({ map: beamHD() })), stoneBlk = lam("stoneBlock", () => ({ color: "#e9e2d2" }));
    era("works", (bb) => { // scaffold poles + a wooden crane + stone blocks (1173 and 1272)
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, x = Math.cos(a) * (R + 2.2), z = Math.sin(a) * (R + 2.2); bb.add(boxGeo(V(x - 0.12, 0, z - 0.12), V(x + 0.12, 14, z + 0.12)), wood); }
      for (const y of [4, 8, 12]) for (let k = 0; k < 10; k++) { const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2; bb.add(beam(V(Math.cos(a0) * (R + 2.2), y, Math.sin(a0) * (R + 2.2)), V(Math.cos(a1) * (R + 2.2), y, Math.sin(a1) * (R + 2.2)), 0.16), wood); }
      bb.add(beam(V(-16, 0, -6), V(-12, 16, -4), 0.35), wood); bb.add(beam(V(-16, 0, -2), V(-12, 16, -4), 0.35), wood); bb.add(beam(V(-12, 16, -4), V(-6, 18, -3), 0.3), wood);
      for (const [x, z] of [[-14, -14], [-12.5, -15.5], [12, -13], [13.5, -11.5], [-15.5, -12]]) bb.add(boxGeo(V(x - 0.7, 0, z - 0.5), V(x + 0.7, 0.9, z + 0.5)), stoneBlk);
    });
    era("pump", (bb) => { // 1934: a concrete pump cart and hoses into the ground on the high side
      const iron = twoTone(new THREE.MeshPhongMaterial({ color: "#4a5a6a", specular: "#8a8a8a", shininess: 40 }), 0.15), hose = lam("hose", () => ({ color: "#2b2d3a" }));
      bb.add(boxGeo(V(PUMP[0] - 1.4, 0.5, PUMP[2] - 0.8), V(PUMP[0] + 1.4, 1.8, PUMP[2] + 0.8)), iron);
      bb.add(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 16).rotateZ(Math.PI / 2), lam("drum", () => ({ color: "#c9845e" })), new THREE.Matrix4().makeTranslation(PUMP[0], 2.6, PUMP[2]));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb.add(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14).rotateX(Math.PI / 2), hose, new THREE.Matrix4().makeTranslation(PUMP[0] + sx * 1.0, 0.4, PUMP[2] + sz * 0.85));
      for (const dz of [-3, 0, 3]) bb.add(beam(V(PUMP[0] + 1.4, 1.0, PUMP[2]), V(-R - 0.6, 0.05, dz), 0.18), hose);
    });
    era("closed", (bb) => { // 1990: barrier boards round the tower, the no-entry sign, lead ingots + a drill rig on the high side
      const bar = lam("barrier", () => ({ map: barrierTex(), side: THREE.DoubleSide })), post = lam("post", () => ({ color: "#f4f2ec" }));
      for (let k = 0; k < 14; k++) {
        const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 0.8) / 14) * Math.PI * 2, rr = R + 6;
        const p0 = V(Math.cos(a0) * rr, 0, Math.sin(a0) * rr), p1 = V(Math.cos(a1) * rr, 0, Math.sin(a1) * rr);
        bb.add(quad4(V(p0.x, 1.1, p0.z), V(p1.x, 1.1, p1.z), V(p1.x, 0.75, p1.z), V(p0.x, 0.75, p0.z)), bar);
        bb.add(boxGeo(V(p0.x - 0.06, 0, p0.z - 0.06), V(p0.x + 0.06, 1.15, p0.z + 0.06)), post);
      }
      bb.add(boxGeo(V(SIGN[0] - 0.05, 0, SIGN[2] - 0.05), V(SIGN[0] + 0.05, 2.2, SIGN[2] + 0.05)), post);
      const lead = twoTone(new THREE.MeshPhongMaterial({ color: "#5a5f6a", specular: "#9a9a9a", shininess: 50 }), 0.15);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) bb.add(boxGeo(V(-R - 2.6 + j * 0.9, i * 0.45, -1.6 + (i % 2) * 0.3), V(-R - 1.8 + j * 0.9, i * 0.45 + 0.42, 1.6 + (i % 2) * 0.3)), lead);
      const rig = lam("rigYellow", () => ({ color: "#f3c63d" })), steel = lam("rigSteel", () => ({ color: "#8a8f98" }));
      bb.add(boxGeo(V(-R - 6.5, 0, -4.8), V(-R - 4.5, 1.2, -3.2)), rig);
      bb.add(boxGeo(V(-R - 5.6, 1.2, -4.2), V(-R - 5.3, 7, -3.8)), steel);
      bb.add(beam(V(-R - 5.45, 6.8, -4.0), V(-R - 1.5, 0.2, -4.0), 0.14), steel);
      bb.add(new THREE.SphereGeometry(1.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam("spoil", () => ({ color: "#7a6450" })), new THREE.Matrix4().makeTranslation(-R - 8.5, 0, -1));
    });
    { // the abandoned stump grows over: bushes and flowers round its base
      const g = new THREE.Group(), ob = new Batch();
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2 + 0.2, rr = R + 1.2 + (k % 3) * 0.6; prop(ob, kit, (["plant_bushLarge", "plant_bush", "flower_redA", "flower_yellowA", "plant_bushDetailed"] as const)[k % 5], Math.cos(a) * rr, 0, Math.sin(a) * rr, k % 5 >= 2 && k % 5 <= 3 ? 0.7 : 1.6, a); }
      ob.build(g); g.visible = false; Rt.add(g); this.eras.overgrown = g;
    }
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: noEntrySign(), color: "#e6e6e6" }));
    signM.position.set(SIGN[0], 2.6, SIGN[2] - 0.07); signM.rotation.y = Math.PI; signM.layers.set(NOINK); this.eras.closed.add(signM);
    // the memory-foam mattress (its top sinks under the sitter, then holds)
    this.mattress = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 1.3).translate(0, 0.5, 0), lam("mattress", () => ({ color: "#e9eef6" })));
    this.mattress.position.set(...MATTRESS); this.mattress.castShadow = true; this.mattress.receiveShadow = true; Rt.add(this.mattress);
    for (const fg of FOREGROUND) {
      const o = kitClone(kit, fg.kit, fg.s ?? 1); if (!o) continue;
      o.position.set(...fg.pos); o.rotation.y = fg.yaw ?? 0; o.visible = false; this.fgs.push({ o, a: fg.a, b: fg.b }); Rt.add(o);
    }
  }

  /** one storey as its own group, origin at its base centre: marble core, gallery columns, floor ledge, top cornice */
  private buildStorey(k: number) {
    const g = new THREE.Group(), bb = new Batch(), h = H_STOREY(k);
    const colM = lam("towerColumn", () => ({ color: "#f6e6c6" })), ledge = lam("towerLedge", () => ({ color: "#eedcb8" }));
    const bell = k === 7, rCore = k === 0 ? R - 0.5 : bell ? R * 0.6 : R - 1.3, rCol = bell ? R * 0.6 + 0.55 : R - 0.4;
    const core = lam(`towerCore${k === 0 ? "B" : "G"}`, () => ({ map: rep(marbleStorey(k === 0 ? "marbleBlind" : "marbleGallery", k === 0), 6, 1) }));
    bb.add(new THREE.CylinderGeometry(rCore, rCore, h, 40, 1, true).translate(0, h / 2, 0), core);
    if (k === 0) { bb.add(new THREE.CylinderGeometry(R + 0.35, R + 0.5, 0.8, 40).translate(0, 0.4, 0), ledge); }
    const n = k === 0 ? 15 : bell ? 12 : 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = k === 0 ? R - 0.15 : rCol;
      bb.add(new THREE.CylinderGeometry(0.24, 0.27, h - (k === 0 ? 1.4 : 0.9), 10).translate(0, (h - (k === 0 ? 1.4 : 0.9)) / 2 + (k === 0 ? 0.8 : 0.45), 0), colM, new THREE.Matrix4().makeTranslation(Math.cos(a) * rr, 0, Math.sin(a) * rr));
    }
    const rL = bell ? R * 0.6 + 0.9 : R + 0.2;
    bb.add(new THREE.CylinderGeometry(rL, rL, 0.45, 40).translate(0, h - 0.22, 0), ledge); // cornice / next floor
    if (bell) bb.add(new THREE.CylinderGeometry(R * 0.6 + 0.2, R * 0.6 + 0.2, 1.2, 32).translate(0, h + 0.6, 0), ledge);
    bb.build(g);
    return g;
  }

  private shotSun(id: number, s: ShotDef, L: LightPreset) {
    let v = this.sunCache.get(id); if (v) return v;
    let fx = 0, fz = 0;
    for (let f = s.a; f < s.b; f += 3) { const c = camAt(id, f), x = c.look[0] - c.pos[0], z = c.look[2] - c.pos[2], n = Math.hypot(x, z) || 1; fx += x / n; fz += z / n; }
    const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
    const az = THREE.MathUtils.degToRad(SUN_SHOT[id]?.az ?? L.az), el = THREE.MathUtils.degToRad(SUN_SHOT[id]?.el ?? L.el);
    const hx = fx * Math.cos(az) - fz * Math.sin(az), hz = fz * Math.cos(az) + fx * Math.sin(az);
    v = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize(); this.sunCache.set(id, v); return v;
  }
  private actor(i: number) { while (this.actors.length <= i) this.actors.push(new Actor(this.root)); return this.actors[i]; }
  private fx(i: number) { while (this.fxs.length <= i) this.fxs.push(new Fx(this.root)); return this.fxs[i]; }

  update(id: number, f: number, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const t = f / FPS, s = SHOTS[id - 1], L = LIGHTS[s.light], K = LOOK[s.light];
    const c = camAt(id, f);
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.look); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = 0.1; cam.far = 1500; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const focus = V(...c.look), dist = cam.position.distanceTo(focus);
    cam.layers.enable(NOINK);
    const sunDir = this.shotSun(id, s, L);
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    const Rr = Math.max(s.light === "golden" ? 40 : 14, THREE.MathUtils.clamp(dist * 1.15 + 7, 12, 95));
    this.sun.position.copy(focus).addScaledVector(sunDir, 220); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera; sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 20; sc.far = 480; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    TONE.uLitCol.value.set(...L.lit); TONE.uShadeCol.value.set(...L.shade); TONE.uShadeLift.value.set(...L.lift);
    TONE.uLambert.value = L.lambert; TONE.uSideK.value = L.sideK; TONE.uTerm.value = L.term; TONE.uBounce.value.set(...K.bounce); TONE.uSat.value = K.sat;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = L.charShade; CHAR.uGrad.value = L.charGrad; CHAR.uBodyGrad.value = L.bodyGrad; CHAR.uSideTint.value.set(...L.sideTint);
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg)); su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    // underground: a warm earthy fog so the pit reads as a cutaway, not a hole in the sky
    const under = c.pos[1] < -1;
    untone(under ? "#5a4636" : L.fog, this.fog.color); this.fog.near = under ? 12 : L.fogNear; this.fog.far = under ? 60 : L.fogFar;
    scene.fog = this.fog; scene.background = null;
    const showSun = s.light === "golden";
    this.sunDisc.visible = this.sunHalo.visible = showSun;
    if (showSun) {
      this.sunDisc.position.copy(cam.position).addScaledVector(sunDir, 900); this.sunDisc.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(1.7)));
      this.sunHalo.position.copy(this.sunDisc.position); this.sunHalo.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(24)));
      (this.sunHalo.material as THREE.SpriteMaterial).color.set(L.sunDisc).multiplyScalar(1.3);
    }
    for (let i = 0; i < this.clouds.length; i++) { const m = this.clouds[i]; m.lookAt(cam.position.x, m.position.y, cam.position.z); (m.material as THREE.MeshBasicMaterial).map = this.cloudMaps[s.light][i % 4]; }
    for (const g of this.fgs) g.o.visible = f >= g.a && f < g.b && g.a < s.b && g.b > s.a;
    // ---- the tower: storeys built (the top one grows), lean from the low-side edge, upper floors bent back ----
    const ts = towerAt(id, f);
    this.pivot.rotation.z = -THREE.MathUtils.degToRad(ts.tilt);
    for (let k = 0; k < 8; k++) {
      const st = this.storeys[k], built = k === 7 ? (ts.bell ? 1 : 0) : Math.max(0, Math.min(1, ts.storeys - k));
      st.visible = built > 0.001;
      st.scale.y = Math.max(0.001, built);
      st.rotation.z = k >= 3 && k < 7 ? THREE.MathUtils.degToRad(ts.bend) : k === 7 ? THREE.MathUtils.degToRad(ts.bend * 0.5) : 0;
      if (k > 0) st.position.y = H_STOREY(k - 1) * Math.max(0.001, Math.min(1, ts.storeys - (k - 1)));
    }
    // ---- pit, soil, era props, mattress ----
    this.pitGroup.visible = ts.pit; this.lid.visible = !ts.pit;
    this.soilWall.material = this.soilMats[Math.round(ts.squeeze * SQ_STEPS)];
    const era = s.era;
    this.eras.works.visible = era === "1173" || era === "1272";
    this.eras.pump.visible = era === "1934";
    this.eras.closed.visible = era === "1990";
    this.eras.overgrown.visible = era === "war" && ts.overgrown > 0.5;
    const sink = era === "war" ? 1 - 0.38 * smooth((f - SIT_AT) / 9) : 1;
    this.mattress.visible = era === "war"; this.mattress.scale.y = 0.5 * sink;
    // ---- cast + effects ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const st = stage(id, t, { pos: cam.position, right, sun: sunDir }, ts);
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let ai = 0; const used: Actor[] = [];
    for (const p of st.places) {
      const sc2 = p.scale ?? 1;
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y + 1.1 * sc2, p.z), 3.5))) continue;
      const a = this.actor(ai++), [w, h, k] = p.size ?? [300, 500, 0.5];
      a.r = this.pool.req(p.key, w, h, k, p.draw); a.mesh.visible = true; a.mesh.position.set(p.x, p.y, p.z);
      a.mesh.rotation.set(0, p.yaw ?? Math.atan2(cam.position.x - p.x, cam.position.z - p.z), p.roll ?? 0);
      a.mesh.scale.set(p.mirror ? -sc2 : sc2, sc2, sc2); a.mesh.castShadow = L.actorShadow; used.push(a);
    }
    for (let i = ai; i < this.actors.length; i++) this.actors[i].mesh.visible = false;
    let fi = 0; const fused: Fx[] = [];
    for (const p of st.fx) {
      if (under && p.key.startsWith("blob|")) continue; // ground shadows seen from below the lawn render as white cards
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y, p.z), Math.max(p.w, p.h)))) continue;
      const e2 = this.fx(fi++); e2.r = this.pool.req(p.key, p.cw, p.ch, 1, p.draw); e2.use(!!p.soft); e2.mesh.visible = true; e2.mesh.position.set(p.x, p.y, p.z);
      if (p.flat) e2.mesh.rotation.set(-Math.PI / 2, 0, p.rot ?? 0);
      else if (p.face !== undefined) e2.mesh.rotation.set(0, p.face, p.rot ?? 0);
      else { e2.mesh.quaternion.copy(cam.quaternion); e2.mesh.rotateZ(p.rot ?? 0); }
      e2.mesh.scale.set(p.w, p.h, 1); fused.push(e2);
    }
    for (let i = fi; i < this.fxs.length; i++) this.fxs[i].mesh.visible = false;
    this.pool.flush();
    for (const a of used) a.bind();
    for (const e3 of fused) e3.bind();
    return focus;
  }
}

// ---------------- geometry helpers ----------------
/** horizontal quad facing up at height y over x0..x1, z0..z1 */
function flat(x0: number, x1: number, z0: number, z1: number, y: number, u: number, v: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(Array(6).fill([0, 1, 0]).flat(), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, 0, u, v, 0, v], 2));
  return g;
}
/** flat ring (annulus) facing up */
function ring(r0: number, r1: number, y: number, n: number) {
  const g = new THREE.RingGeometry(r0, r1, n, 1); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 8);
  return g;
}
/** quad a b c d (front = counter-clockwise seen from the front); full = one image over the whole quad */
function quad4(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, full = false) {
  const g = new THREE.BufferGeometry(), n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(Array(6).fill([n.x, n.y, n.z]).flat(), 3));
  const u = full ? 1 : a.distanceTo(b) / 4, v = full ? 1 : a.distanceTo(d) / 4;
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, v, u, v, u, 0, 0, v, u, 0, 0, 0], 2));
  return g;
}
const beam = (a: THREE.Vector3, b: THREE.Vector3, th: number) => {
  const g = new THREE.BoxGeometry(th, a.distanceTo(b), th);
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1)));
};
/** pitched roof along x over z0..z1 from eave height y0 to ridge y1 */
function gable(b: Batch, m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const zc = (z0 + z1) / 2;
  b.add(quad4(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, zc), V(x1, y1, zc)), m);
  b.add(quad4(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, zc), V(x0, y1, zc)), m);
}
/** pitched roof along z over x0..x1 */
function gableZ(b: Batch, m: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const xc = (x0 + x1) / 2;
  b.add(quad4(V(x0, y0, z0), V(x0, y0, z1), V(xc, y1, z1), V(xc, y1, z0)), m);
  b.add(quad4(V(x1, y0, z1), V(x1, y0, z0), V(xc, y1, z0), V(xc, y1, z1)), m);
}
