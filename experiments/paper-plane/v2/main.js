// ---------------------------------------------------------------
// Paper plane v2 · drift
//
// No controls, no spawning. Planes live in a bubble of sky around
// you and drift on a slow 3D flow field in loose flocks. Your finger
// moves the AIR (a fading grid of velocities); planes caught in it
// copy your motion. Hold still and they circle your fingertip.
//
//   1. config
//   2. plane model + 3D maths (same renderer as v1, no camera tilt)
//   3. the air: flow field + gesture grid
//   4. flight: natural drift, flocking, bubble, finger, orbit
//   5. sound: pad, chimes, wind
//   6. drawing
//   7. wiring
// ---------------------------------------------------------------
import { createStage, rand, clamp } from "../../../assets/js/stage.js";
import { createSynth } from "../../../assets/js/sound.js";

// ---------- 1. config ----------
const DEFAULTS = {
  count: 30,
  pace: 1,
  together: 0.8,
  current: 1,
  mood: "dusk",
  follow: 1,
  reach: 170,       // px around the finger that the air moves
  memory: 2.2,      // seconds for the moved air to fade
  orbit: true,
  showAir: false,
  size: 0.5,
  trails: true,
  volume: 0.55,
  pad: true,
  chimes: true,
  wind: true,
};
const STORE_KEY = "exp:paper-plane:v2";
const config = { ...DEFAULTS, ...read() };
function read() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ } }

const stageEl = document.getElementById("stage");
const stage = createStage(stageEl, { touchAction: "none" });
const synth = createSynth({ volume: config.volume, reverb: 3.5, wet: 0.55 });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------- 2. model + 3D maths ----------
const NOSE = [1.0, 0, 0];
const L_TIP = [-0.7, 0.08, -0.62], R_TIP = [-0.7, 0.08, 0.62];
const L_ROOT = [-0.7, 0, -0.04], R_ROOT = [-0.7, 0, 0.04];
const KEEL = [-0.7, -0.22, 0];
const TRIS = [
  { v: [NOSE, L_TIP, L_ROOT], tone: 1 },
  { v: [NOSE, R_ROOT, R_TIP], tone: 1 },
  { v: [NOSE, L_ROOT, KEEL], tone: 0.86 },
  { v: [NOSE, KEEL, R_ROOT], tone: 0.86 },
];
const NEAR = 0.8;

let focal = stage.H * 1.05;
const bubble = { cx: 0, cy: 0, cz: 11, rx: 6, ry: 4, rz: 8 };
function fitBubble() {
  focal = stage.H * 1.05;
  // a little wider than what's visible at the bubble's centre, so planes drift in and out of frame
  bubble.rx = (stage.W / 2 / focal) * bubble.cz * 1.25;
  bubble.ry = (stage.H / 2 / focal) * bubble.cz * 1.1;
  setupGrid();
}
stage.onResize = fitBubble;

const project = (x, y, z) => ({ x: stage.W / 2 + (x / z) * focal, y: stage.H / 2 - (y / z) * focal, z });
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
const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- 3. the air ----------
// (a) a slow, swirling 3D wind made of layered sines
function flow(x, y, z, t) {
  return [
    Math.sin(y * 0.35 + t * 0.07) + Math.sin(z * 0.21 - t * 0.05),
    Math.sin(z * 0.28 + t * 0.06) * 0.5 + Math.sin(x * 0.19 + t * 0.04) * 0.4,
    Math.sin(x * 0.31 - t * 0.06) + Math.sin(y * 0.23 + t * 0.08),
  ];
}

// (b) the gesture grid: screen-space velocities your finger leaves behind
const grid = { cols: 0, rows: 0, cw: 1, ch: 1, vx: null, vy: null };
function setupGrid() {
  grid.cols = 40;
  grid.rows = Math.max(8, Math.round((40 * stage.H) / Math.max(1, stage.W)));
  grid.cw = stage.W / grid.cols;
  grid.ch = stage.H / grid.rows;
  grid.vx = new Float32Array(grid.cols * grid.rows);
  grid.vy = new Float32Array(grid.cols * grid.rows);
}
fitBubble();

function writeAir(dt) {
  const ptr = stage.pointer;
  const touching = ptr.down || (ptr.inside && ptr.type === "mouse");
  if (!touching) return;
  let vx = ptr.vx, vy = ptr.vy;
  const sp = Math.hypot(vx, vy);
  if (sp < 30) return;                       // standing still doesn't erase the air
  if (sp > 1500) { vx *= 1500 / sp; vy *= 1500 / sp; }
  const R = config.reach;
  const strength = ptr.down ? 1 : 0.7;      // a hovering mouse moves the air a bit less
  const c0 = Math.max(0, Math.floor((ptr.x - R) / grid.cw)), c1 = Math.min(grid.cols - 1, Math.ceil((ptr.x + R) / grid.cw));
  const r0 = Math.max(0, Math.floor((ptr.y - R) / grid.ch)), r1 = Math.min(grid.rows - 1, Math.ceil((ptr.y + R) / grid.ch));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const d = Math.hypot((c + 0.5) * grid.cw - ptr.x, (r + 0.5) * grid.ch - ptr.y);
      if (d > R) continue;
      const fall = (1 - d / R) ** 2 * strength;
      const i = r * grid.cols + c;
      const k = Math.min(1, fall * dt * 16);
      // blend toward your velocity (so the air reflects your motion, it doesn't pile up)
      grid.vx[i] += (vx - grid.vx[i]) * k;
      grid.vy[i] += (vy - grid.vy[i]) * k;
    }
  }
}
function fadeAir(dt) {
  const f = Math.exp(-dt / config.memory);
  for (let i = 0; i < grid.vx.length; i++) { grid.vx[i] *= f; grid.vy[i] *= f; }
}
function sampleAir(sx, sy) {
  const gx = sx / grid.cw - 0.5, gy = sy / grid.ch - 0.5;
  const c0 = Math.floor(gx), r0 = Math.floor(gy);
  const fx = gx - c0, fy = gy - r0;
  let vx = 0, vy = 0;
  for (const [dc, dr, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const c = c0 + dc, r = r0 + dr;
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
    vx += grid.vx[r * grid.cols + c] * w;
    vy += grid.vy[r * grid.cols + c] * w;
  }
  return [vx, vy];
}

// ---------- 4. flight ----------
let planes = [];
function makePlane() {
  const b = bubble;
  const p = {
    x: b.cx + rand(-1, 1) * b.rx * 0.8,
    y: b.cy + rand(-1, 1) * b.ry * 0.8,
    z: b.cz + rand(-1, 1) * b.rz * 0.8,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, roll: 0, turn: 0, prevYaw: null,
    rate: rand(0.75, 1.25), ph: rand(6.3),
    trail: [], trailT: 0, follow: 0, alpha: 0,
  };
  const d = norm([rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)]);
  p.vx = d[0]; p.vy = d[1]; p.vz = d[2];
  p.yaw = Math.atan2(p.vz, p.vx);
  return p;
}
// fewer planes on narrow (portrait) screens, so the sky stays calm rather than crowded
const targetCount = () => Math.max(4, Math.round(config.count * clamp(stage.W / stage.H / 1.6, 0.45, 1)));
function syncCount() {
  const n = targetCount();
  while (planes.length < n) planes.push(makePlane());
  if (planes.length > n) planes.length = n;
}

let holdTime = 0;
let lastChime = 0;

function fly(p, i, dt, t) {
  const c = 1.1 * config.pace * p.rate;
  const b = bubble;

  // -- natural drift: flow field + own heading + flock
  const f = flow(p.x, p.y, p.z, t);
  const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
  let dx = p.vx / sp * 1.2 + f[0] * 0.6 * config.current;
  let dy = p.vy / sp * 1.2 + f[1] * 0.6 * config.current;
  let dz = p.vz / sp * 1.2 + f[2] * 0.6 * config.current;

  let n = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0;
  for (let j = 0; j < planes.length; j++) {
    if (j === i) continue;
    const q = planes[j];
    const ex = p.x - q.x, ey = p.y - q.y, ez = p.z - q.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > 12) continue;
    n++;
    ax += q.vx; ay += q.vy; az += q.vz;
    cx += q.x; cy += q.y; cz += q.z;
    if (d2 < 1.4) { sx += ex / (d2 + 0.05); sy += ey / (d2 + 0.05); sz += ez / (d2 + 0.05); }
  }
  if (n) {
    const al = norm([ax, ay, az]);
    dx += al[0] * 0.8 * config.together + (cx / n - p.x) * 0.12 * config.together;
    dy += al[1] * 0.8 * config.together + (cy / n - p.y) * 0.12 * config.together;
    dz += al[2] * 0.8 * config.together + (cz / n - p.z) * 0.12 * config.together;
  }
  dx += sx * 0.5; dy += sy * 0.5; dz += sz * 0.5;

  // -- soft bubble: the further outside, the harder it turns back (no edges, no respawn)
  const ox = (p.x - b.cx) / b.rx, oy = (p.y - b.cy) / b.ry, oz = (p.z - b.cz) / b.rz;
  const r = Math.hypot(ox, oy, oz);
  if (r > 0.7) {
    const push = (r - 0.7) * 5;
    dx -= (ox / r) * push; dy -= (oy / r) * push * 1.3; dz -= (oz / r) * push;
  }
  if (p.z < 2.5) dz += (2.5 - p.z) * 3;   // don't fly into the viewer's face

  let [nx, ny, nz] = norm([dx, dy, dz]);
  // a glider: a little faster going down, slower climbing
  const glide = 1 - 0.3 * ny;
  let wantX = nx * c * glide, wantY = ny * c * glide, wantZ = nz * c * glide;

  // -- your finger: copy the motion of the air you moved
  const s = project(p.x, p.y, p.z);
  let w = 0;
  if (s.z > NEAR && config.follow > 0) {
    const [gx, gy] = sampleAir(s.x, s.y);
    let fx = (gx * p.z) / focal, fy = (-gy * p.z) / focal;   // screen px/s → world units/s at this depth
    const m = Math.hypot(fx, fy);
    const cap = c * 4;
    if (m > cap) { fx *= cap / m; fy *= cap / m; }
    w = clamp(m / (c * 0.6), 0, 1) * Math.min(1, config.follow);
    const follow = Math.min(1.5, config.follow);
    wantX += (fx * follow - wantX) * w;
    wantY += (fy * follow - wantY) * w;
    wantZ *= 1 - 0.7 * w;
  }

  // -- holding still: circle the fingertip
  const ptr = stage.pointer;
  if (config.orbit && ptr.down && holdTime > 0.25 && s.z > NEAR) {
    const ds = Math.hypot(s.x - ptr.x, s.y - ptr.y);
    const R = config.reach * 1.8;
    if (ds < R) {
      const fxw = ((ptr.x - stage.W / 2) / focal) * p.z;
      const fyw = (-(ptr.y - stage.H / 2) / focal) * p.z;
      const ex = fxw - p.x, ey = fyw - p.y;
      const d = Math.hypot(ex, ey) || 0.001;
      const ring = ((config.reach * 0.55) * p.z) / focal;
      const radial = clamp((d - ring) / ring, -1, 1);
      const ox2 = (-ey / d) * c * 1.3 + (ex / d) * radial * c;
      const oy2 = (ex / d) * c * 1.3 + (ey / d) * radial * c;
      const wo = (1 - ds / R) * Math.min(1, holdTime);
      wantX += (ox2 - wantX) * wo;
      wantY += (oy2 - wantY) * wo;
      wantZ *= 1 - 0.8 * wo;
      w = Math.max(w, wo);
    }
  }

  // -- steer (quicker while following you, lazy otherwise)
  const k = 1 - Math.exp(-(0.9 + 5 * w) * dt);
  p.vx += (wantX - p.vx) * k;
  p.vy += (wantY - p.vy) * k;
  p.vz += (wantZ - p.vz) * k;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

  // a soft chime when a plane joins your gesture
  if (config.chimes && started && w > 0.55 && p.follow < 0.3 && t - lastChime > 0.28) {
    lastChime = t;
    chime(clamp((s.x / stage.W) * 2 - 1, -1, 1), s.y);
  }
  p.follow += (w - p.follow) * (1 - Math.exp(-6 * dt));

  // -- body follows velocity (as in v1), with slower, calmer easing
  const hor = Math.hypot(p.vx, p.vz);
  const yawT = hor > 0.02 ? Math.atan2(p.vz, p.vx) : p.yaw;
  const pitchT = Math.atan2(p.vy, Math.max(hor, 0.001)) * 0.85;
  if (p.prevYaw !== null && dt > 0) {
    const raw = wrap(yawT - p.prevYaw) / dt;
    p.turn += (raw - p.turn) * (1 - Math.exp(-4 * dt));
  }
  p.prevYaw = yawT;
  const rollT = clamp(p.turn * 0.9, -1, 1) + 0.06 * Math.sin(t * 0.9 + p.ph);
  const e = 1 - Math.exp(-4 * dt);
  p.yaw += wrap(yawT - p.yaw) * e;
  p.pitch += wrap(pitchT - p.pitch) * e;
  p.roll += wrap(rollT - p.roll) * e;

  p.alpha = Math.min(1, p.alpha + dt * 0.5);   // fade in on load

  if (config.trails) {
    p.trailT -= dt;
    if (p.trailT <= 0) {
      p.trailT = 0.07;
      p.trail.push([p.x, p.y, p.z]);
      if (p.trail.length > 28) p.trail.shift();
    }
  } else if (p.trail.length) p.trail = [];
}

// ---------- 5. sound ----------
let started = false;
// D major pentatonic: nothing clashes, whatever plays together
const PENTA = [0, 2, 4, 7, 9];
const ROOTS = { dusk: 50, day: 55, night: 45 };     // MIDI note of the scale's root
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const noteAt = (degree, root) => root + PENTA[((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5);

let padTimer = 0;
function pad() {
  const root = ROOTS[config.mood] ?? 50;
  const base = Math.floor(rand(0, 5));
  for (const step of [0, 2, 4]) {                     // stacked pentatonic "thirds": soft, open chords
    const f = mtof(noteAt(base + step, root));
    synth.tone({ freq: f, type: "sine", dur: 9, attack: 2.5, gain: 0.05 });
    synth.tone({ freq: f * 2.003, type: "triangle", dur: 7, attack: 3, gain: 0.008 });
  }
  synth.tone({ freq: mtof(root - 12), type: "sine", dur: 10, attack: 3, gain: 0.035 });   // low root underneath
}
function chime(pan, sy) {
  const root = (ROOTS[config.mood] ?? 50) + 24;
  const degree = Math.floor((1 - sy / stage.H) * 8);  // higher on screen = higher note
  const f = mtof(noteAt(degree, root));
  synth.tone({ freq: f, type: "sine", dur: 2.6, attack: 0.01, gain: 0.05, pan });
  synth.tone({ freq: f * 3, type: "sine", dur: 0.9, attack: 0.01, gain: 0.008, pan });
}

let wind = null;
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
  filter.frequency.value = 350;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  wind = { ctx, filter, gain };
}
function updateSound(dt, t) {
  if (!started) return;
  padTimer -= dt;
  if (config.pad && padTimer <= 0) { pad(); padTimer = rand(5, 8); }
  if (wind) {
    // the wind rises a little with how much air you're moving
    const ptr = stage.pointer;
    const motion = clamp(Math.hypot(ptr.vx, ptr.vy) / 1200, 0, 1) * (ptr.down || ptr.inside ? 1 : 0);
    const g = config.wind ? 0.035 + 0.02 * Math.sin(t * 0.11) + motion * 0.05 : 0;
    wind.gain.gain.setTargetAtTime(g, wind.ctx.currentTime, 0.3);
    wind.filter.frequency.setTargetAtTime(280 + 120 * Math.sin(t * 0.07) + motion * 500, wind.ctx.currentTime, 0.3);
  }
}

// ---------- 6. drawing ----------
const MOODS = {
  dusk: { paper: [255, 244, 236], fog: [118, 104, 134], line: "rgba(40,30,50,", trail: "rgba(255,236,226,", light: norm([0.5, 0.35, -0.6]), dot: "rgba(255,240,230," },
  day: { paper: [252, 251, 247], fog: [214, 224, 232], line: "rgba(35,45,60,", trail: "rgba(40,55,75,", light: norm([-0.3, 0.85, -0.45]), dot: "rgba(70,80,95," },
  night: { paper: [222, 228, 245], fog: [16, 22, 40], line: "rgba(0,0,0,", trail: "rgba(200,215,255,", light: norm([0.2, 0.9, -0.3]), dot: "rgba(220,230,255," },
};
const motes = Array.from({ length: 110 }, () => ({ x: rand(), y: rand(), z: rand(0.2, 1), ph: rand(6.3) }));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function draw(t) {
  const { ctx, W, H } = stage;
  const mood = MOODS[config.mood] ?? MOODS.dusk;
  ctx.clearRect(0, 0, W, H);

  // motes / stars
  for (const m of motes) {
    const tw = config.mood === "night" ? 0.5 + 0.5 * Math.sin(t * (0.5 + m.z) + m.ph) : 1;
    ctx.fillStyle = `${mood.dot}${(0.12 + 0.3 * m.z) * tw})`;
    const r = config.mood === "night" ? 0.6 + m.z : 0.8 + m.z * 1.2;
    const x = ((m.x + t * 0.002 * m.z) % 1) * W, y = (m.y * H + Math.sin(t * 0.2 + m.ph) * 8);
    ctx.fillRect(x, y, r, r);
  }

  // the air you moved (optional)
  if (config.showAir) {
    ctx.strokeStyle = `${mood.trail}0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c;
      const m = Math.hypot(grid.vx[i], grid.vy[i]);
      if (m < 20) continue;
      const x = (c + 0.5) * grid.cw, y = (r + 0.5) * grid.ch, l = Math.min(grid.cw * 0.9, m * 0.02);
      ctx.moveTo(x, y);
      ctx.lineTo(x + (grid.vx[i] / m) * l, y + (grid.vy[i] / m) * l);
    }
    ctx.stroke();
  }

  // soft trails
  if (config.trails) {
    ctx.lineWidth = 1;
    for (const p of planes) {
      const tr = p.trail;
      for (let k = 1; k < tr.length; k++) {
        const a = project(...tr[k - 1]), b2 = project(...tr[k]);
        if (a.z < NEAR || b2.z < NEAR) continue;
        const fade = (k / tr.length) * 0.22 * p.alpha * (1 - clamp((tr[k][2] - 6) / 16, 0, 0.85));
        ctx.strokeStyle = `${mood.trail}${fade})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.stroke();
      }
    }
  }

  // planes (painter's algorithm, as in v1)
  const tris = [];
  for (const p of planes) {
    for (const tri of TRIS) {
      const w = tri.v.map((c) => toWorld(p, c));
      const s = w.map((v) => project(v[0], v[1], v[2]));
      if (s.some((v) => v.z < NEAR)) continue;
      const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
      const light = (0.58 + 0.42 * Math.abs(dot(n, mood.light))) * tri.tone;
      const depth = (s[0].z + s[1].z + s[2].z) / 3;
      const fog = clamp((depth - 6) / 16, 0, 1) * 0.85;
      tris.push({ s, depth, light, fog, alpha: p.alpha });
    }
  }
  tris.sort((a, b) => b.depth - a.depth);
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.7;
  for (const tr of tris) {
    const lit = mood.paper.map((c) => Math.min(255, c * tr.light));
    const [r, g, b] = mix(lit, mood.fog, tr.fog);
    ctx.globalAlpha = tr.alpha;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = `${mood.line}${0.35 * (1 - tr.fog)})`;
    ctx.beginPath();
    ctx.moveTo(tr.s[0].x, tr.s[0].y);
    ctx.lineTo(tr.s[1].x, tr.s[1].y);
    ctx.lineTo(tr.s[2].x, tr.s[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // your fingertip: a soft light (the system cursor is hidden on desktop)
  const ptr = stage.pointer;
  if (ptr.inside || ptr.down) {
    const g = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, 28);
    g.addColorStop(0, `${mood.trail}0.5)`);
    g.addColorStop(1, `${mood.trail}0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ptr.x, ptr.y, 28, 0, Math.PI * 2);
    ctx.fill();
    if (ptr.down && config.orbit && holdTime > 0.25) {
      const breathe = 1 + 0.06 * Math.sin(t * 1.6);
      ctx.strokeStyle = `${mood.trail}${0.18 * Math.min(1, holdTime - 0.25)})`;
      ctx.beginPath();
      ctx.arc(ptr.x, ptr.y, config.reach * 0.55 * breathe, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ---------- the loop ----------
syncCount();
stage.loop((dt, t) => {
  syncCount();
  const ptr = stage.pointer;
  holdTime = ptr.down && Math.hypot(ptr.vx, ptr.vy) < 60 ? holdTime + dt : 0;
  writeAir(dt);
  fadeAir(dt);
  const step = reducedMotion.matches ? dt * 0.6 : dt;
  for (let i = 0; i < planes.length; i++) fly(planes[i], i, step, t);
  updateSound(dt, t);
  draw(t);
});

// ---------- 7. wiring ----------
const soundBtn = document.getElementById("soundBtn");
const tuneBtn = document.getElementById("tuneBtn");
const panel = document.getElementById("panel");
const beginBtn = document.getElementById("begin");

function begin() {
  if (started) return;
  started = true;
  synth.unlock();
  startWind();
  padTimer = 0.4;
  applySound();
  beginBtn.classList.add("fading");
  setTimeout(() => { beginBtn.hidden = true; }, 1300);
}
beginBtn.addEventListener("click", begin);

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

const FORMAT = {
  count: (v) => `${v}`,
  pace: (v) => `${Number(v).toFixed(2)}×`,
  together: (v) => `${Math.round(v * 100)}%`,
  current: (v) => `${Math.round(v * 100)}%`,
  follow: (v) => `${Math.round(v * 100)}%`,
  reach: (v) => `${v}px`,
  memory: (v) => `${Number(v).toFixed(1)}s`,
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
  stageEl.dataset.mood = config.mood;
}
panel.addEventListener("input", (e) => {
  const el = e.target;
  const k = el.dataset.key;
  if (!k) return;
  config[k] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value);
  applySound();
  sync();
  save();
});
panel.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='reset']")) {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    applySound();
    sync();
  }
});

applySound();
sync();

// ?debug exposes state for automated checks
if (new URLSearchParams(location.search).has("debug")) {
  window.__pp = { planes: () => planes, project, grid };
}
