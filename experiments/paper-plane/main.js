// ---------------------------------------------------------------
// Paper plane: glider physics in a hand-rolled 3D sky.
//
//   1. config
//   2. the plane model (4 triangles) + 3D maths
//   3. flight: desired velocity, steering, tumble, banking
//   4. touch: knock, gust, throw
//   5. sound: crinkle, whoosh, wind
//   6. drawing: clouds, dust, trails, planes (painter's algorithm)
//   7. wiring
// ---------------------------------------------------------------
import { createStage, rand, clamp } from "../../assets/js/stage.js";
import { createSynth } from "../../assets/js/sound.js";

// ---------- 1. config ----------
const DEFAULTS = {
  mode: "side",     // side | away | toward
  count: 14,
  speed: 2.2,       // world units per second
  swoop: 0.6,
  wander: 0.6,
  bank: 1,
  poke: 3.5,
  recover: 1.8,     // seconds
  gust: 0.8,
  size: 0.55,
  colour: false,
  trails: false,
  night: false,
  volume: 0.6,
  wind: true,
};
const STORE_KEY = "exp:paper-plane";
const config = { ...DEFAULTS, ...read() };
function read() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ } }

const stageEl = document.getElementById("stage");
const stage = createStage(stageEl, { touchAction: "none" });
const synth = createSynth({ volume: config.volume });

// ---------- 2. model + 3D maths ----------
// Plane space: x forward, y up, z right. Wing tips tilt up a little (dihedral).
const NOSE = [1.0, 0, 0];
const L_TIP = [-0.7, 0.08, -0.62], R_TIP = [-0.7, 0.08, 0.62];
const L_ROOT = [-0.7, 0, -0.04], R_ROOT = [-0.7, 0, 0.04];
const KEEL = [-0.7, -0.22, 0];
const TRIS = [
  { v: [NOSE, L_TIP, L_ROOT], tone: 1 },     // left wing
  { v: [NOSE, R_ROOT, R_TIP], tone: 1 },     // right wing
  { v: [NOSE, L_ROOT, KEEL], tone: 0.86 },   // left keel fold
  { v: [NOSE, KEEL, R_ROOT], tone: 0.86 },   // right keel fold
];
const LIGHT = norm([-0.3, 0.85, -0.45]);

const NEAR = 0.6;          // nothing closer than this is drawn
const ZFAR = 24;
const DIRS = { side: [-1, 0, 0], away: [0, 0, 1], toward: [0, 0, -1] };

let focal = 1;             // perspective strength, from the stage height
const halfW = (z) => (stage.W / 2 / focal) * z;    // half the visible width at depth z
const halfH = (z) => (stage.H / 2 / focal) * z;
stage.onResize = (W, H) => { focal = H * 1.05; };
focal = stage.H * 1.05;

// The camera sits a little above the flock and tilts down, so we see the tops of the wings.
// (Side view only; from behind/in front the wings already read well.)
const camera = () => (config.mode === "side" ? { y: 2.2, tilt: 0.18 } : { y: 0.4, tilt: 0.03 });
// height of the camera's line of sight at depth z (where "the middle of the screen" is)
const sightY = (z) => { const c = camera(); return c.y - z * Math.tan(c.tilt); };

// world → camera → screen
function toCam(x, y, z) {
  const c = camera(), cs = Math.cos(c.tilt), sn = Math.sin(c.tilt);
  const yy = y - c.y;
  return [x, yy * cs + z * sn, -yy * sn + z * cs];
}
function project(x, y, z) {
  const [cx, cy, cz] = toCam(x, y, z);
  return { x: stage.W / 2 + (cx / cz) * focal, y: stage.H / 2 - (cy / cz) * focal, z: cz };
}
// screen point at camera depth zc → world (used to throw a plane from your finger)
function unproject(sx, sy, zc) {
  const c = camera(), cs = Math.cos(c.tilt), sn = Math.sin(c.tilt);
  const cx = ((sx - stage.W / 2) / focal) * zc;
  const cy = (-(sy - stage.H / 2) / focal) * zc;
  return [cx, c.y + cy * cs - zc * sn, cy * sn + zc * cs];
}
// plane-space corner → world (roll about x, pitch about z, yaw about y)
function toWorld(p, [x, y, z]) {
  const s = config.size;
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const y1 = y * cr - z * sr, z1 = y * sr + z * cr;
  const x2 = x * cp - y1 * sp, y2 = x * sp + y1 * cp;
  const x3 = x2 * cy - z1 * sy, z3 = x2 * sy + z1 * cy;
  return [p.x + x3 * s, p.y + y2 * s, p.z + z3 * s];
}
function norm([x, y, z]) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));   // any angle → (-π, π]

// ---------- 3. flight ----------
let planes = [];
const PAPERS = ["#fbfaf6", "#f6d7c3", "#cfe3f1", "#f3e6a9", "#d9ead0", "#e7d6f0", "#f5c9c9"];

function makePlane(initial) {
  const p = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, roll: 0, spinYaw: 0, spinPitch: 0, spinRoll: 0,
    turn: 0, prevYaw: null, tumble: 0,
    ph: [rand(6.3), rand(6.3), rand(6.3), rand(6.3)],
    rate: rand(0.75, 1.25),
    paper: PAPERS[Math.floor(rand(PAPERS.length))],
    trail: [], trailT: 0, lastWhoosh: 0, home: { y: 0, lat: 0 },
  };
  place(p, initial);
  return p;
}

// Put a plane at its starting edge (or anywhere, for the first frame).
function place(p, initial) {
  const m = config.mode;
  if (m === "side") {
    p.z = rand(3.5, 16);
    p.x = initial ? rand(-1, 1) * halfW(p.z) : halfW(p.z) + config.size * 2 + rand(0, 1.5);
    p.y = sightY(p.z) + rand(-0.55, 0.55) * halfH(p.z);
    p.home = { y: p.y, lat: p.z };
  } else {
    p.z = m === "away"
      ? (initial ? rand(2, ZFAR) : rand(-2.5, -0.5))
      : (initial ? rand(2, ZFAR) : ZFAR + rand(0, 4));
    p.x = rand(-2.6, 2.6);
    p.y = rand(-1.4, 1.4);
    p.home = { y: p.y, lat: p.x };
  }
  const d = DIRS[m];
  p.vx = d[0] * config.speed; p.vy = 0; p.vz = d[2] * config.speed;
  p.yaw = Math.atan2(p.vz, p.vx); p.pitch = 0; p.roll = 0;
  p.spinYaw = p.spinPitch = p.spinRoll = 0;
  p.tumble = 0; p.prevYaw = null; p.turn = 0; p.trail = [];
}

function exited(p) {
  const m = config.mode;
  if (Math.abs(p.y) > 40 || Math.abs(p.x) > 60 || p.z > ZFAR + 12 || p.z < -6) return true;
  if (m === "side") return p.x < -(halfW(Math.max(p.z, 1)) + config.size * 2 + 0.5) || p.z < -1;
  if (m === "away") return p.z > ZFAR + 2;
  return p.z < -1;
}

function fly(p, dt, t) {
  const m = config.mode;
  const d = DIRS[m];
  const c = config.speed * p.rate;
  const ctrl = 1 - p.tumble;   // 0 = falling paper, 1 = flying

  // desired velocity: cruise + wander + swoop + springs that keep it in view
  const swoop = config.swoop * c * 0.35 * Math.sin(t * 0.8 * p.rate + p.ph[0]);
  const drift = config.wander * c * 0.3 * (Math.sin(t * 0.37 + p.ph[1]) + 0.5 * Math.sin(t * 0.91 + p.ph[2]));
  const springY = (p.home.y - p.y) * 0.45;
  // a glider trades height for speed: diving speeds it up, climbing slows it down
  const glide = 1 - 0.35 * clamp(p.vy / c, -1, 1);
  let dx = d[0] * c * glide, dy = swoop + springY, dz = d[2] * c * glide;
  if (m === "side") dz += drift + (p.home.lat - p.z) * 0.3;
  else dx += drift + (p.home.lat - p.x) * 0.3;

  const k = 1 - Math.exp(-1.8 * ctrl * dt);
  p.vx += (dx - p.vx) * k;
  p.vy += (dy - p.vy) * k;
  p.vz += (dz - p.vz) * k;

  // while tumbling: gravity + drag act like on a sheet of paper
  p.vy -= 4 * p.tumble * dt;
  const drag = Math.exp(-0.8 * p.tumble * dt);
  p.vx *= drag; p.vy *= drag; p.vz *= drag;

  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

  // body angles are read off the velocity
  const hor = Math.hypot(p.vx, p.vz);
  const yawT = hor > 0.05 ? Math.atan2(p.vz, p.vx) : p.yaw;
  const pitchT = Math.atan2(p.vy, Math.max(hor, 0.001)) * 0.85;
  if (p.prevYaw !== null && dt > 0) {
    const raw = wrap(yawT - p.prevYaw) / dt;
    p.turn += (raw - p.turn) * (1 - Math.exp(-5 * dt));
  }
  p.prevYaw = yawT;
  const rollT = clamp(p.turn * config.bank * 0.9, -1.1, 1.1) + 0.07 * Math.sin(t * 1.3 + p.ph[3]);

  // spin from a knock carries on and dies down…
  p.yaw += p.spinYaw * dt; p.pitch += p.spinPitch * dt; p.roll += p.spinRoll * dt;
  const sd = Math.exp(-2.2 * dt);
  p.spinYaw *= sd; p.spinPitch *= sd; p.spinRoll *= sd;
  // …while flight slowly takes the angles back
  const e = 1 - Math.exp(-6 * ctrl * dt);
  p.yaw += wrap(yawT - p.yaw) * e;
  p.pitch += wrap(pitchT - p.pitch) * e;
  p.roll += wrap(rollT - p.roll) * e;

  p.tumble = Math.max(0, p.tumble - dt / config.recover);

  if (config.trails) {
    p.trailT -= dt;
    if (p.trailT <= 0) {
      p.trailT = 0.05;
      p.trail.push([p.x, p.y, p.z]);
      if (p.trail.length > 40) p.trail.shift();
    }
  }
}

function syncCount(initial = false) {
  while (planes.length < config.count) planes.push(makePlane(initial || true));
}

// ---------- 4. touch ----------
function screenOf(p) {
  const s = project(p.x, p.y, p.z);
  if (s.z < NEAR) return null;
  s.r = Math.max(20, (config.size * focal) / s.z * 1.15);
  return s;
}
function hitTest(px, py) {
  let best = null;
  for (const p of planes) {
    const s = screenOf(p);
    if (!s) continue;
    if (Math.hypot(s.x - px, s.y - py) < s.r && (!best || p.z < best.z)) best = p;
  }
  return best;
}
const panOf = (sx) => clamp((sx / stage.W) * 2 - 1, -1, 1);

function knock(p, px, py, strength = 1) {
  const s = screenOf(p) ?? { x: px, y: py };
  let ax = s.x - px, ay = s.y - py;
  const l = Math.hypot(ax, ay);
  if (l < 1) { ax = rand(-1, 1); ay = -1; } else { ax /= l; ay /= l; }
  const k = config.poke * strength;
  p.vx += ax * k * 0.7;
  p.vy += (-ay * 0.7 + 0.6) * k * 0.6;     // away from the finger, plus a little lift
  p.vz += rand(-0.6, 0.6) * k * 0.4;
  const spin = Math.min(1.6, k / 3);
  p.spinRoll = (Math.random() < 0.5 ? -1 : 1) * rand(7, 13) * spin;
  p.spinPitch = rand(-6, 6) * spin;
  p.spinYaw = rand(-2.5, 2.5) * spin;
  p.tumble = 1;
  const pan = panOf(s.x);
  crinkle(pan, strength);
  whoosh(pan, 0.8 * strength);
  windSwell(0.5 * strength);
}

let drag = null;   // throwing in progress
stage.onDown = (ptr) => {
  synth.unlock();
  startWind();
  const p = hitTest(ptr.x, ptr.y);
  if (p) { knock(p, ptr.x, ptr.y); drag = null; return; }
  drag = { x: ptr.x, y: ptr.y, t: performance.now() };
};
stage.onUp = (ptr) => {
  if (!drag) return;
  const dx = ptr.x - drag.x, dy = ptr.y - drag.y;
  const dur = Math.max(0.06, (performance.now() - drag.t) / 1000);
  throwPlane(drag.x, drag.y, dx, dy, dur);
  drag = null;
};

function throwPlane(sx, sy, dx, dy, dur) {
  const m = config.mode;
  const z = m === "side" ? 5 : m === "away" ? 3 : 4.5;
  const p = makePlane(true);
  [p.x, p.y, p.z] = unproject(sx, sy, z);
  const mid = sightY(p.z);
  p.home = { y: clamp(p.y, mid - halfH(p.z) * 0.6, mid + halfH(p.z) * 0.6), lat: m === "side" ? p.z : clamp(p.x, -2.6, 2.6) };
  const d = DIRS[m];
  let vx = d[0] * config.speed * 0.6, vy = 0.5, vz = d[2] * config.speed * 0.6;
  if (Math.hypot(dx, dy) > 12) {
    // the drag becomes the throw (screen px/s → world units/s at that depth)
    const sc = (z / focal) * 0.9;
    vx += clamp((dx / dur) * sc, -9, 9);
    vy += clamp((-dy / dur) * sc, -9, 9);
  } else {
    vx = d[0] * config.speed * 1.4; vz = d[2] * config.speed * 1.4;
  }
  p.vx = vx; p.vy = vy; p.vz = vz;
  p.yaw = Math.atan2(vz, vx);
  p.tumble = 0.35;
  p.spinRoll = rand(-3, 3);
  planes.push(p);
  // keep the flock from growing forever: drop the oldest extra
  while (planes.length > config.count + 8) planes.shift();
  whoosh(panOf(sx), 1);
  windSwell(0.4);
}

// a quick swipe past a plane pushes it like a gust
function gusts(dt, t) {
  const ptr = stage.pointer;
  if (!ptr.inside || drag || config.gust <= 0) return;
  const speed = Math.hypot(ptr.vx, ptr.vy);
  if (speed < 250) return;
  const R = 140;
  for (const p of planes) {
    const s = screenOf(p);
    if (!s) continue;
    const dist = Math.hypot(s.x - ptr.x, s.y - ptr.y);
    if (dist > R) continue;
    const fall = (1 - dist / R) * config.gust;
    const sc = p.z / focal;
    p.vx += ptr.vx * sc * 2.2 * fall * dt;
    p.vy -= ptr.vy * sc * 2.2 * fall * dt;
    p.spinRoll += Math.sign(ptr.vx || 1) * 30 * fall * dt;
    p.tumble = Math.max(p.tumble, 0.3 * fall);
    if (fall > 0.35 && t - p.lastWhoosh > 0.5) {
      p.lastWhoosh = t;
      whoosh(panOf(s.x), 0.45 * fall);
    }
  }
}

// ---------- 5. sound ----------
function crinkle(pan, strength = 1) {
  const n = 6 + Math.floor(rand(5));
  for (let i = 0; i < n; i++) {
    synth.noise({
      filter: "bandpass", freq: rand(2000, 6500), q: 3,
      dur: rand(0.015, 0.035), gain: rand(0.15, 0.35) * strength, delay: rand(0, 0.15), pan,
    });
  }
}
function whoosh(pan, amount = 1) {
  synth.noise({ filter: "bandpass", freq: 300, to: 1600, q: 1.2, dur: 0.4, gain: 0.35 * amount, attack: 0.08, pan });
}

let wind = null;
let swell = 0;
function startWind() {
  if (wind) return;
  const a = synth.context();
  if (!a) return;
  const { ctx, master, noise } = a;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 400;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  wind = { ctx, filter, gain };
}
function windSwell(v) { swell = Math.min(1.5, swell + v); }
function updateWind(dt, t) {
  swell *= Math.exp(-1.5 * dt);
  if (!wind) return;
  // slow, uneven gusting: two slow sines multiplied
  const g = config.wind ? 0.08 + 0.06 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1) + swell * 0.18 : 0;
  const f = 260 + 180 * (0.5 + 0.5 * Math.sin(t * 0.09)) + swell * 900;
  wind.gain.gain.setTargetAtTime(g, wind.ctx.currentTime, 0.1);
  wind.filter.frequency.setTargetAtTime(f, wind.ctx.currentTime, 0.1);
}

// ---------- 6. drawing ----------
const clouds = Array.from({ length: 8 }, () => ({ x: rand(-1, 1), y: rand(-0.1, 0.9), z: rand(28, 40), s: rand(2.5, 5.5), seed: rand(10) }));
const dust = Array.from({ length: 90 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(2, ZFAR), ph: rand(6.3) }));

function skyRGB() { return config.night ? [12, 18, 32] : [222, 229, 234]; }
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function draw(t) {
  const { ctx, W, H } = stage;
  ctx.clearRect(0, 0, W, H);
  const sky = skyRGB();

  // clouds, far away, drifting slowly in the wind
  for (const c of clouds) {
    const s = { x: (0.5 + c.x * 0.7) * W, y: (0.5 - c.y * 0.5) * H };
    const r = (c.s / c.z) * focal;
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * r * 0.55, oy = Math.sin(c.seed + i * 1.7) * r * 0.18;
      const g = ctx.createRadialGradient(s.x + ox, s.y + oy, 0, s.x + ox, s.y + oy, r * 0.7);
      const a = config.night ? 0.05 : 0.45;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x + ox, s.y + oy, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // dust motes: tiny depth cues
  for (const d of dust) {
    const s = { x: (0.5 + d.x * 0.5) * W, y: (0.5 - d.y * 0.5) * H + Math.sin(t * 0.3 + d.ph) * 6 };
    const a = (1 - d.z / ZFAR) * (config.night ? 0.5 : 0.35);
    ctx.fillStyle = config.night ? `rgba(220,230,255,${a})` : `rgba(90,100,115,${a})`;
    const r = Math.max(0.6, 1.6 * (4 / d.z));
    ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
  }

  // flight paths
  if (config.trails) {
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    for (const p of planes) {
      if (p.trail.length < 2) continue;
      ctx.strokeStyle = config.night ? "rgba(200,210,255,0.35)" : "rgba(40,55,75,0.3)";
      ctx.beginPath();
      let started = false;
      for (const [x, y, z] of p.trail) {
        const s = project(x, y, z);
        if (s.z < NEAR) { started = false; continue; }
        started ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        started = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // planes: gather every triangle, sort far → near, paint (painter's algorithm)
  const tris = [];
  for (const p of planes) {
    const base = config.colour ? hex(p.paper) : [251, 250, 246];
    for (const tri of TRIS) {
      const w = tri.v.map((c) => toWorld(p, c));
      const s = w.map((v) => project(v[0], v[1], v[2]));
      if (s.some((v) => v.z < NEAR)) continue;
      const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
      // paper is lit on both sides, so use |n·L|
      const light = (0.6 + 0.4 * Math.abs(dot(n, LIGHT))) * tri.tone * (config.night ? 0.8 : 1);
      const depth = (s[0].z + s[1].z + s[2].z) / 3;
      const fog = clamp((depth - 5) / (ZFAR - 5), 0, 1) * 0.9;
      tris.push({ s, depth, light, fog, base });
    }
  }
  tris.sort((a, b) => b.depth - a.depth);
  ctx.lineJoin = "round";
  for (const tr of tris) {
    const lit = tr.base.map((c) => Math.min(255, c * tr.light));
    const [r, g, b] = mix(lit, sky, tr.fog);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = config.night ? `rgba(0,0,0,${0.45 * (1 - tr.fog)})` : `rgba(35,45,60,${0.4 * (1 - tr.fog)})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(tr.s[0].x, tr.s[0].y);
    ctx.lineTo(tr.s[1].x, tr.s[1].y);
    ctx.lineTo(tr.s[2].x, tr.s[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // aiming a throw
  if (drag) {
    const ptr = stage.pointer;
    ctx.strokeStyle = config.night ? "rgba(255,255,255,0.6)" : "rgba(30,40,55,0.55)";
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(drag.x, drag.y);
    ctx.lineTo(ptr.x, ptr.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(drag.x, drag.y, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---------- the loop ----------
syncCount(true);
stage.loop((dt, t) => {
  if (!focal || focal === 1) focal = stage.H * 1.05;
  syncCount();
  gusts(dt, t);
  for (const c of clouds) {
    // clouds drift with the flight direction, very slowly
    if (config.mode === "side") { c.x -= 0.004 * dt * config.speed; if (c.x < -1.3) c.x = 1.3; }
    else { c.x += 0.003 * dt; if (c.x > 1.3) c.x = -1.3; }
  }
  for (const d of dust) {
    d.x += Math.sin(t * 0.2 + d.ph) * 0.002 * dt;
    d.y += 0.004 * dt;
    if (d.y > 1) d.y = -1;
  }
  for (const p of planes) fly(p, dt, t);
  // recycle planes that left the view (or drop extras after throws / lowering the count)
  for (let i = planes.length - 1; i >= 0; i--) {
    if (!exited(planes[i])) continue;
    if (planes.length > config.count) planes.splice(i, 1);
    else place(planes[i], false);
  }
  updateWind(dt, t);
  draw(t);
});

// ---------- 7. wiring ----------
const soundBtn = document.getElementById("soundBtn");
const tuneBtn = document.getElementById("tuneBtn");
const panel = document.getElementById("panel");
const modeBtns = document.querySelectorAll("[data-mode]");

function applySound() {
  synth.set({ volume: config.volume, enabled: soundBtn.getAttribute("aria-pressed") === "true" });
}
soundBtn.addEventListener("click", () => {
  const on = soundBtn.getAttribute("aria-pressed") !== "true";
  soundBtn.setAttribute("aria-pressed", String(on));
  synth.unlock();
  startWind();
  applySound();
});
tuneBtn.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  tuneBtn.setAttribute("aria-expanded", String(!panel.hidden));
});

function setMode(m) {
  if (config.mode === m) return;
  config.mode = m;
  planes = [];
  syncCount(true);
  sync();
  save();
}
modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

const FORMAT = {
  count: (v) => `${v}`,
  speed: (v) => `${Number(v).toFixed(1)}`,
  swoop: (v) => `${Math.round(v * 100)}%`,
  wander: (v) => `${Math.round(v * 100)}%`,
  bank: (v) => `${Number(v).toFixed(1)}×`,
  poke: (v) => `${Number(v).toFixed(1)}`,
  recover: (v) => `${Number(v).toFixed(1)}s`,
  gust: (v) => `${Math.round(v * 100)}%`,
  size: (v) => `${Number(v).toFixed(2)}`,
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
  modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === config.mode)));
  stageEl.classList.toggle("night", config.night);
}
panel.addEventListener("input", (e) => {
  const k = e.target.dataset.key;
  if (!k) return;
  if (k === "mode") { setMode(e.target.value); return; }
  config[k] = e.target.type === "checkbox" ? e.target.checked : e.target.tagName === "SELECT" ? e.target.value : Number(e.target.value);
  applySound();
  sync();
  save();
});
panel.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]")?.dataset.action;
  if (!a) return;
  synth.unlock();
  startWind();
  if (a === "throw") {
    const sx = config.mode === "side" ? stage.W * 0.85 : stage.W * rand(0.35, 0.65);
    throwPlane(sx, stage.H * rand(0.4, 0.6), 0, 0, 1);
  }
  if (a === "scatter") {
    planes.forEach((p, i) => {
      const s = screenOf(p);
      if (!s) return;
      setTimeout(() => knock(p, s.x + rand(-20, 20), s.y + rand(5, 25), 0.8), i * 25);
    });
  }
  if (a === "reset") {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    planes = [];
    syncCount(true);
    applySound();
    sync();
  }
});

applySound();
sync();
