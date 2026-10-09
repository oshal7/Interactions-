// ---------------------------------------------------------------
// Wind chimes v1: three.js (WebGL) scene on top of our own physics.
//
//   physics.js : pendulums, collisions, wind, your hand   (no library)
//   audio.js   : free-free bar chime voice + tunings      (Web Audio)
//   main.js    : WebGL scene, pointer → hand/grab, panel  (three.js)
// ---------------------------------------------------------------
import * as THREE from "three";
import { RoomEnvironment } from "../../../assets/vendor/three/addons/RoomEnvironment.js";
import { createSynth } from "../../../assets/js/sound.js";
import { createChime, vec, closestSegSeg } from "./physics.js";
import { createChimeAudio, TUNINGS, notesFor } from "./audio.js";

// ---------- config ----------
const DEFAULTS = {
  count: 5,
  tuning: "pentatonic",
  transpose: 0,
  breeze: 0.18,
  air: 0.22,
  bounce: 0.62,
  hand: 0.03,
  ringLength: 1,
  brightness: 1,
  volume: 0.75,
  night: false,
  notes: false,
  contacts: false,
};
const STORE_KEY = "exp:wind-chimes:v1";
const config = { ...DEFAULTS, ...read() };
function read() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ } }

const stageEl = document.getElementById("stage");
const labelsEl = document.getElementById("labels");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------- sound ----------
const synth = createSynth({ volume: config.volume, reverb: 4.5, wet: 0.45 });
const chimeAudio = createChimeAudio(synth);
let started = false;

// ---------- renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;";
stageEl.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
const LOOK = new THREE.Vector3(0, 1.08, 0);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.7, 2.9, 3.6);   // mostly frontal: shadows fall close behind the chime
sun.castShadow = true;
const small = Math.min(window.innerWidth, window.innerHeight) < 700;
sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
sun.shadow.camera.left = -1.6; sun.shadow.camera.right = 1.6;
sun.shadow.camera.top = 2.6; sun.shadow.camera.bottom = -0.6;
sun.shadow.radius = 6;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.6));

// a pale wall behind, only there to catch soft shadows
const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.ShadowMaterial({ opacity: 0.09 }));
wall.position.set(0, 1, -1.1);
wall.receiveShadow = true;
scene.add(wall);

// ---------- materials (monochrome) ----------
const MAT = {
  tube: new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.28, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ color: 0x2c2b2a, metalness: 0, roughness: 0.75 }),
  string: new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.7 }),
  spark: new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true }),
};

// ---------- build the chime (physics + meshes) ----------
let chime = null;
let group = null;
let tubeMeshes = [];
let strikerMesh, sailMesh, strings, stringPos;
const TOP_Y = 1.62;

function build() {
  if (group) {
    scene.remove(group);
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== MAT.wood && o.material !== MAT.string && o.material !== MAT.spark) o.material.dispose?.(); });
  }
  const notes = notesFor(config.tuning, config.count, config.transpose);
  // deeper tunings get longer tubes
  const maxLen = config.tuning === "tenor" ? 1.2 : config.tuning === "healing" ? 1.18 : 1.05;
  // tubes hang close to the striker (a few cm gap), like on a real chime
  const ringRadius = config.count > 6 ? 0.27 : config.count > 5 ? 0.245 : 0.22;
  chime = createChime({ notes, topY: TOP_Y, maxLen, ringRadius });
  chime.env.onHit = onHit;
  applyPhysics();

  group = new THREE.Group();
  scene.add(group);

  // top disc + three hanging cords to a hook
  const discR = ringRadius + 0.07;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(discR, discR, 0.034, 72), MAT.wood);
  disc.position.y = TOP_Y + 0.02;
  disc.castShadow = true;
  group.add(disc);
  const hookY = 2.45;
  const hang = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    hang.push(Math.cos(a) * (discR - 0.03), TOP_Y + 0.04, Math.sin(a) * (discR - 0.03), 0, hookY, 0);
  }
  const hangGeo = new THREE.BufferGeometry();
  hangGeo.setAttribute("position", new THREE.Float32BufferAttribute(hang, 3));
  group.add(new THREE.LineSegments(hangGeo, MAT.string));

  // tubes: open cylinders, each with its own material so it can glint when struck
  tubeMeshes = chime.tubes.map((t) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.L, 40, 1, true), MAT.tube.clone());
    m.castShadow = true;
    m.userData.body = t;
    t.flash = 0;
    group.add(m);
    return m;
  });

  // striker puck + sail
  strikerMesh = new THREE.Mesh(new THREE.CylinderGeometry(chime.striker.r, chime.striker.r, 0.03, 64), MAT.wood);
  strikerMesh.castShadow = true;
  strikerMesh.userData.body = chime.striker;
  group.add(strikerMesh);
  sailMesh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.27, 0.006), MAT.wood);
  sailMesh.castShadow = true;
  sailMesh.userData.body = chime.striker;
  group.add(sailMesh);

  // all the strings in one line-segment buffer, updated every frame
  stringPos = new Float32Array((chime.tubes.length + 2) * 6);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(stringPos, 3));
  strings = new THREE.LineSegments(sg, MAT.string);
  strings.frustumCulled = false;
  group.add(strings);

  // note labels
  labelsEl.innerHTML = chime.tubes.map((t) => `<span>${t.note.name}</span>`).join("");
  sync();
}

function applyPhysics() {
  if (!chime) return;
  chime.env.air = config.air;
  chime.env.bounceMetal = config.bounce;
  chime.env.bounceWood = config.bounce * 0.72;
}

// ---------- hits → sound + glint ----------
function onHit({ kind, a, b, speed, point }) {
  const pan = Math.max(-1, Math.min(1, point[0] / 0.45)) * 0.75;
  a.flash = Math.min(1, (a.flash || 0) + speed * 1.5);
  if (config.contacts) sparks.push({ p: point, age: 0, s: speed });
  if (!started) return;
  const opts = { pan, ringLength: config.ringLength, brightness: config.brightness };
  if (kind === "tube-tube") {
    b.flash = Math.min(1, (b.flash || 0) + speed * 1.5);
    chimeAudio.ring(a, speed, { ...opts, hardness: 1 });
    chimeAudio.ring(b, speed, { ...opts, hardness: 1 });
  } else {
    chimeAudio.ring(a, speed, { ...opts, hardness: 0.6 });   // wooden striker: softer attack
  }
}

// ---------- pointer: hand (brush) and grab ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { inside: false, down: false, type: "mouse", x: 0, y: 0, fresh: true };
let handPrev = null;

function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = e.clientX - r.left;
  pointer.y = e.clientY - r.top;
  ndc.set((pointer.x / r.width) * 2 - 1, -(pointer.y / r.height) * 2 + 1);
  pointer.type = e.pointerType;
}
function currentRay() {
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  const dist = camera.position.distanceTo(LOOK);
  // a capsule along the view ray, through the depth of the chime
  const a = [o.x + d.x * (dist - 1.2), o.y + d.y * (dist - 1.2), o.z + d.z * (dist - 1.2)];
  const b = [o.x + d.x * (dist + 1.2), o.y + d.y * (dist + 1.2), o.z + d.z * (dist + 1.2)];
  return { a, b, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
}
// What's under the pointer? Not an exact-pixel raycast: your hovering hand nudges tubes,
// so pick the nearest body within a few cm of the pointer's ray (front-most wins ties).
function pickBody() {
  const { a, b, o } = currentRay();
  let best = null;
  const consider = (body, p0, p1, radius, hOf) => {
    const c = closestSegSeg(p0, p1, a, b);
    const d = vec.len(vec.sub(c.pa, c.pb));
    if (d > radius + 0.05) return;
    const depth = vec.len(vec.sub(c.pa, o));
    const score = d + depth * 0.02;
    if (!best || score < best.score) best = { body, point: c.pa, h: hOf(c.s), score };
  };
  for (const t of chime.tubes) {
    const [p0, p1] = chime.tubeEnds(t);
    consider(t, p0, p1, t.r, (s) => t.s + s * t.L);
  }
  const S = chime.striker;
  consider(S, S.X, chime.sailPoint(), S.r * 0.6, (s) => S.Lc + s * (S.sail - S.Lc));
  return best;
}

const canvas = renderer.domElement;
canvas.addEventListener("pointermove", (e) => {
  setNdc(e);
  if (!pointer.inside) { pointer.inside = true; handPrev = null; }
});
canvas.addEventListener("pointerleave", () => { if (!pointer.down) { pointer.inside = false; chime.env.hand = null; handPrev = null; } });
canvas.addEventListener("pointerdown", (e) => {
  setNdc(e);
  canvas.setPointerCapture(e.pointerId);
  pointer.down = true;
  pointer.inside = true;
  begin();
  const hit = pickBody();
  if (hit) {
    const body = hit.body;
    const ax = chime.axis(body);
    const max = body.kind === "tube" ? body.s + body.L : body.sail;
    const h = Math.max(0.08, Math.min(max, hit.h));
    chime.env.grab = { body, h, target: vec.add(body.P, vec.mul(ax, h)) };
    chime.env.hand = null;
    canvas.style.cursor = "grabbing";
  } else {
    handPrev = null;
  }
});
const release = () => {
  pointer.down = false;
  if (chime.env.grab) { chime.env.grab = null; canvas.style.cursor = ""; }
  if (pointer.type !== "mouse") { pointer.inside = false; chime.env.hand = null; handPrev = null; }
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

function updatePointer(dt) {
  const env = chime.env;
  if (env.grab) {
    // target = point on the current ray closest to the grabbed point (keeps its depth)
    const { body, h } = env.grab;
    const cur = vec.add(body.P, vec.mul(chime.axis(body), h));
    const { o, d } = currentRay();
    const s = vec.dot(vec.sub(cur, o), d);
    env.grab.target = vec.add(o, vec.mul(d, s));
    return;
  }
  const brushing = pointer.inside && (pointer.type === "mouse" || pointer.down);
  if (!brushing) { env.hand = null; return; }
  const { a, b } = currentRay();
  let va = [0, 0, 0], vb = [0, 0, 0];
  if (handPrev && dt > 0) {
    va = vec.mul(vec.sub(a, handPrev.a), 1 / dt);
    vb = vec.mul(vec.sub(b, handPrev.b), 1 / dt);
    // a hand brushing a chime moves gently; cap it so a flick of the mouse doesn't fling tubes
    const cap = (v) => { const l = vec.len(v); return l > 2.2 ? vec.mul(v, 2.2 / l) : v; };
    va = cap(va); vb = cap(vb);
  }
  handPrev = { a, b };
  env.hand = { a, b, r: config.hand, va, vb };
  // hover cursor: grab hand over things you can pick up
  if (!pointer.down && pointer.type === "mouse") canvas.style.cursor = pickBody() ? "grab" : "";
}

// ---------- wind ----------
let windSrc = null;
function startWind() {
  if (windSrc) return;
  const a = synth.context();
  if (!a) return;
  const { ctx, master, noise } = a;
  const src = ctx.createBufferSource();
  src.buffer = noise; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 300;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  windSrc = { ctx, f, g };
}
let gustBoost = 0;
function updateWind(t, dt) {
  // slowly turning direction, gusts that come and go
  const dir = t * 0.03 + Math.sin(t * 0.07) * 1.3;
  const g = 0.5 + 0.5 * Math.sin(t * 0.23 + Math.sin(t * 0.61) * 2);
  gustBoost *= Math.exp(-dt * 0.8);
  const speed = config.breeze * 5 * (0.25 + 0.75 * g * g * g) + gustBoost;
  chime.env.wind = [Math.cos(dir) * speed, 0, Math.sin(dir) * speed * 0.6];
  if (windSrc) {
    const level = Math.min(1, speed / 4);
    windSrc.g.gain.setTargetAtTime(0.012 + level * 0.06, windSrc.ctx.currentTime, 0.4);
    windSrc.f.frequency.setTargetAtTime(220 + level * 700, windSrc.ctx.currentTime, 0.4);
  }
}

// ---------- contact sparks (optional "show contacts") ----------
const sparks = [];
const sparkPool = Array.from({ length: 24 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), MAT.spark.clone());
  m.visible = false;
  scene.add(m);
  return m;
});

// ---------- per-frame: sync meshes to physics ----------
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
function syncMeshes(dt) {
  const k = 0;
  chime.tubes.forEach((t, i) => {
    const [top, bot] = chime.tubeEnds(t);
    const m = tubeMeshes[i];
    m.position.set((top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2);
    tmpV.set(bot[0] - top[0], bot[1] - top[1], bot[2] - top[2]).normalize().negate();
    m.quaternion.setFromUnitVectors(UP, tmpV);
    // a brief glint where it was struck
    t.flash *= Math.exp(-dt * 2.5);
    m.material.emissive.setScalar(t.flash * 0.22);
    // strings: pivot → top of tube
    stringPos.set([t.P[0], t.P[1], t.P[2], top[0], top[1], top[2]], (k + i) * 6);
  });
  const S = chime.striker;
  const ax = chime.axis(S);
  strikerMesh.position.set(S.X[0], S.X[1], S.X[2]);
  tmpV.set(ax[0], ax[1], ax[2]).negate();
  strikerMesh.quaternion.setFromUnitVectors(UP, tmpV);
  const sail = chime.sailPoint();
  sailMesh.position.set(sail[0], sail[1], sail[2]);
  sailMesh.quaternion.copy(strikerMesh.quaternion);
  // the sail also turns slowly in the wind about its string
  sailMesh.rotateY(Math.atan2(chime.env.wind[2], chime.env.wind[0] || 1e-6) * 0.5);
  const n = chime.tubes.length;
  const sailTop = vec.add(S.P, vec.mul(ax, S.sail - 0.135));
  stringPos.set([S.P[0], S.P[1], S.P[2], S.X[0], S.X[1], S.X[2]], n * 6);
  stringPos.set([S.X[0], S.X[1], S.X[2], sailTop[0], sailTop[1], sailTop[2]], (n + 1) * 6);
  strings.geometry.attributes.position.needsUpdate = true;

  // sparks
  for (const s of sparks) s.age += dt;
  while (sparks.length && sparks[0].age > 0.9) sparks.shift();
  sparkPool.forEach((m, i) => {
    const s = sparks[sparks.length - 1 - i];
    if (!s || !config.contacts) { m.visible = false; return; }
    m.visible = true;
    m.position.set(s.p[0], s.p[1], s.p[2]);
    m.scale.setScalar(1 + s.age * 4 * Math.min(1, s.s * 3));
    m.material.opacity = 1 - s.age / 0.9;
  });

  // note labels under each tube
  if (config.notes) {
    const r = canvas.getBoundingClientRect();
    [...labelsEl.children].forEach((el, i) => {
      const [, bot] = chime.tubeEnds(chime.tubes[i]);
      tmpV.set(bot[0], bot[1] - 0.04, bot[2]).project(camera);
      el.style.transform = `translate(${((tmpV.x + 1) / 2) * r.width}px, ${((1 - tmpV.y) / 2) * r.height}px) translate(-50%, 0)`;
    });
  }
}

// ---------- camera: fit the whole chime, with a little parallax ----------
const cam = { x: 0, y: 0 };
function fitCamera() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const needH = 2.25, needW = 1.35;
  const dist = Math.max(needH / (2 * tan), needW / (2 * tan * camera.aspect));
  camera.userData.dist = dist;
  camera.updateProjectionMatrix();
}
new ResizeObserver(fitCamera).observe(stageEl);
fitCamera();

function updateCamera(dt) {
  const tx = pointer.inside && !chime.env.grab ? ndc.x * 0.18 : 0;
  const ty = pointer.inside && !chime.env.grab ? ndc.y * 0.08 : 0;
  const e = 1 - Math.exp(-dt * 1.5);
  cam.x += (tx - cam.x) * e;
  cam.y += (ty - cam.y) * e;
  const d = camera.userData.dist;
  camera.position.set(cam.x * d * 0.3, LOOK.y - 0.02 + cam.y * d * 0.2, d);
  camera.lookAt(LOOK);
}

// ---------- loop ----------
const SUBSTEPS = 10;
let last = performance.now(), simT = 0, raf = 0;
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  updateCamera(dt);
  updatePointer(dt);
  updateWind(simT, dt);
  const sdt = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) { simT += sdt; chime.step(sdt, simT); }
  syncMeshes(dt);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
  else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
});

// ---------- gentle actions ----------
// nudge one tube sideways (keyboard 1–8, "Strike all")
function nudge(i, speed = 0.5) {
  const t = chime.tubes[i];
  if (!t) return;
  const out = vec.norm([t.P[0], 0, t.P[2]]);
  const tangent = [-out[2], 0, out[0]];
  const v = vec.mul(vec.add(vec.mul(tangent, 1), vec.mul(out, -0.6)), speed);
  t.Xp = vec.sub(t.Xp, vec.mul(v, 1 / 60));
}
function stillAll() {
  // back to hanging straight down, at rest
  for (const b of chime.bodies) { b.X = vec.add(b.P, [0, -b.Lc, 0]); b.Xp = [...b.X]; }
  gustBoost = 0;
}

// ---------- wiring ----------
const soundBtn = document.getElementById("soundBtn");
const tuneBtn = document.getElementById("tuneBtn");
const panel = document.getElementById("panel");
const beginBtn = document.getElementById("begin");

function begin() {
  if (started) return;
  started = true;
  synth.unlock();
  startWind();
  applySound();
  beginBtn.classList.add("fading");
  setTimeout(() => { beginBtn.hidden = true; }, 1200);
}
beginBtn.addEventListener("click", () => { begin(); gustBoost = 1.2; });

function applySound() {
  synth.set({ volume: config.volume, enabled: soundBtn.getAttribute("aria-pressed") === "true" });
}
soundBtn.addEventListener("click", () => {
  const on = soundBtn.getAttribute("aria-pressed") !== "true";
  soundBtn.setAttribute("aria-pressed", String(on));
  begin();
  applySound();
});
tuneBtn.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  tuneBtn.setAttribute("aria-expanded", String(!panel.hidden));
});

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 8) { begin(); nudge(n - 1, 0.9); }
  if (e.key === " " && e.target === document.body) { e.preventDefault(); begin(); gustBoost = 2.5; }
});

const FORMAT = {
  count: (v) => `${v}`,
  transpose: (v) => (v > 0 ? `+${v}` : `${v}`),
  breeze: (v) => (Number(v) === 0 ? "still" : `${Math.round(v * 100)}%`),
  air: (v) => Number(v).toFixed(2),
  bounce: (v) => Number(v).toFixed(2),
  hand: (v) => `${Math.round(v * 200)} cm`,
  ringLength: (v) => `${Number(v).toFixed(1)}×`,
  brightness: (v) => `${Math.round(v * 100)}%`,
  volume: (v) => `${Math.round(v * 100)}%`,
};
function sync() {
  panel.querySelectorAll("[data-key]").forEach((el) => {
    const v = config[el.dataset.key];
    if (el.type === "checkbox") el.checked = Boolean(v);
    else if (document.activeElement !== el) el.value = v;
  });
  panel.querySelectorAll("[data-out]").forEach((o) => {
    const k = o.dataset.out;
    o.textContent = FORMAT[k] ? FORMAT[k](config[k]) : config[k];
  });
  const night = config.night;
  stageEl.classList.toggle("night", night);
  scene.background = new THREE.Color(night ? 0x0e0e10 : 0xebe9e4);
  wall.material.opacity = night ? 0.3 : 0.09;
  MAT.wood.color.setHex(night ? 0x77736e : 0x2c2b2a);
  MAT.string.color.setHex(night ? 0x9a9a9a : 0x3a3a3a);
  MAT.spark.color.setHex(night ? 0xffffff : 0x111111);
  sparkPool.forEach((m) => m.material.color.copy(MAT.spark.color));
  tubeMeshes.forEach((m) => m.material.color.setHex(night ? 0xa9a9a9 : 0xd8d8d8));
  scene.environmentIntensity = night ? 0.45 : 1;
  labelsEl.hidden = !config.notes;
  const t = TUNINGS[config.tuning];
  document.getElementById("tuningName").textContent = `${t?.label ?? ""} · ${chime.tubes.map((x) => x.note.name).join(" ")}`;
}
const REBUILD = new Set(["count", "tuning", "transpose"]);
panel.addEventListener("input", (e) => {
  const el = e.target;
  const k = el.dataset.key;
  if (!k) return;
  config[k] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value);
  save();
  applySound();
  applyPhysics();
  if (REBUILD.has(k)) build(); else sync();
});
panel.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]")?.dataset.action;
  if (!a) return;
  begin();
  if (a === "gust") gustBoost = 2.8;
  if (a === "strike") chime.tubes.forEach((_, i) => setTimeout(() => nudge(i, 0.8), i * 140));
  if (a === "still") stillAll();
  if (a === "reset") {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    applySound();
    build();
  }
});

build();
if (reducedMotion.matches) config.breeze = Math.min(config.breeze, 0.08);
raf = requestAnimationFrame(frame);

// ?debug exposes state for automated checks
if (new URLSearchParams(location.search).has("debug")) {
  window.__wc = { chime: () => chime, hits: [], camera, THREE };
  const orig = onHit;
  chime.env.onHit = (h) => { window.__wc.hits.push({ kind: h.kind, speed: h.speed, a: h.a.note?.name, b: h.b.note?.name }); orig(h); };
}
