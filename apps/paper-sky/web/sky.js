// ---------------------------------------------------------------
// Paper Sky: the paper plane v2 "drift" sky, packaged to run
// anywhere: a browser tab, the macOS screen saver, the menu-bar app's
// live wallpaper and ambient mode.
//
// One classic script (no ES modules), so it also loads from disk
// inside a native WKWebView, where module imports are blocked.
//
// URL options (all optional):
//   mode     interactive | wallpaper | screensaver   (default interactive)
//   fps      frame cap, e.g. 30                       (default 60, 30 for wallpaper/screensaver)
//   dpr      max pixel density, e.g. 1 or 1.5          (default 1.5)
//   planes   how many planes                           (default 28)
//   mood     dusk | day | night                        (default dusk)
//   sound    0 | 1                                     (default 1 interactive, 0 otherwise)
//   trails   0 | 1                                     (default 1, 0 for wallpaper)
//   clock    0 | 1                                     (default 1 for screensaver)
//   scale    exact pixel ratio, ignoring the device    (wallpaper exports, e.g. 3 for iPhone)
//   app      1 = installed phone app: small ⋯ menu for mood + clock, choices remembered
//
// Native hosts drive it through window.paperSky:
//   paperSky.pointer(x, y, down)  feed the cursor (CSS px) when the page can't receive events
//   paperSky.pause() / resume()   stop/start all work (hidden, screen asleep, covered)
//   paperSky.set({ ... })         change options live
//   paperSky.stats()              { fps, frameMs, planes, px } for profiling
//   paperSky.snapshot()           → canvas: background + planes (+ clock if on), full resolution
//   paperSky.record(seconds)      → Promise<Blob>: a looping video of the sky (mp4 where supported, else webm)
// ---------------------------------------------------------------
(function () {
  "use strict";

  // ---------- options ----------
  const Q = new URLSearchParams(location.search);
  const mode = Q.get("mode") || "interactive";
  const passive = mode !== "interactive";
  const num = (k, d) => (Q.has(k) && !isNaN(+Q.get(k)) ? +Q.get(k) : d);
  const flag = (k, d) => (Q.has(k) ? Q.get(k) !== "0" : d);
  const opt = {
    fps: num("fps", passive ? 30 : 60),
    dpr: num("dpr", 1.5),
    planes: num("planes", 28),
    mood: Q.get("mood") || "dusk",
    sound: flag("sound", !passive),
    trails: flag("trails", mode !== "wallpaper"),
    clock: flag("clock", mode === "screensaver"),
    autopilot: flag("autopilot", mode === "screensaver"),
    follow: 1,
    reach: 170,
    memory: 2.2,
    pace: num("pace", 1),
    size: 0.5,
  };

  // the installed phone app remembers mood + clock
  const isApp = Q.get("app") === "1";
  if (isApp) {
    try {
      const saved = JSON.parse(localStorage.getItem("paperSky:app") || "{}");
      if (saved.mood) opt.mood = saved.mood;
      if (typeof saved.clock === "boolean") opt.clock = saved.clock;
    } catch { /* storage unavailable */ }
  }

  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.mood = opt.mood;

  // ---------- canvas ----------
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d", { alpha: true });
  let W = 0, H = 0, focal = 1;
  function resize() {
    const dpr = Q.has("scale") ? num("scale", 1) : Math.min(opt.dpr, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = H * 1.05;
    fitBubble();
    setupGrid();
  }
  window.addEventListener("resize", resize);

  // ---------- maths ----------
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- the plane: four triangles ----------
  const NOSE = [1, 0, 0], L_TIP = [-0.7, 0.08, -0.62], R_TIP = [-0.7, 0.08, 0.62];
  const L_ROOT = [-0.7, 0, -0.04], R_ROOT = [-0.7, 0, 0.04], KEEL = [-0.7, -0.22, 0];
  const TRIS = [
    { v: [NOSE, L_TIP, L_ROOT], tone: 1 }, { v: [NOSE, R_ROOT, R_TIP], tone: 1 },
    { v: [NOSE, L_ROOT, KEEL], tone: 0.86 }, { v: [NOSE, KEEL, R_ROOT], tone: 0.86 },
  ];
  const NEAR = 0.8;
  const bubble = { cx: 0, cy: 0, cz: 11, rx: 6, ry: 4, rz: 8 };
  function fitBubble() {
    bubble.rx = (W / 2 / focal) * bubble.cz * 1.25;
    bubble.ry = (H / 2 / focal) * bubble.cz * 1.1;
  }
  const project = (x, y, z) => ({ x: W / 2 + (x / z) * focal, y: H / 2 - (y / z) * focal, z });
  function toWorld(p, c) {
    const s = opt.size, x = c[0], y = c[1], z = c[2];
    const cr = Math.cos(p.roll), sr = Math.sin(p.roll), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const y1 = y * cr - z * sr, z1 = y * sr + z * cr;
    const x2 = x * cp - y1 * sp, y2 = x * sp + y1 * cp;
    const x3 = x2 * cy - z1 * sy, z3 = x2 * sy + z1 * cy;
    return [p.x + x3 * s, p.y + y2 * s, p.z + z3 * s];
  }

  // ---------- the air ----------
  function flow(x, y, z, t) {
    return [
      Math.sin(y * 0.35 + t * 0.07) + Math.sin(z * 0.21 - t * 0.05),
      Math.sin(z * 0.28 + t * 0.06) * 0.5 + Math.sin(x * 0.19 + t * 0.04) * 0.4,
      Math.sin(x * 0.31 - t * 0.06) + Math.sin(y * 0.23 + t * 0.08),
    ];
  }
  const grid = { cols: 0, rows: 0, cw: 1, ch: 1, vx: new Float32Array(1), vy: new Float32Array(1) };
  function setupGrid() {
    grid.cols = 36;
    grid.rows = Math.max(8, Math.round((36 * H) / Math.max(1, W)));
    grid.cw = W / grid.cols;
    grid.ch = H / grid.rows;
    grid.vx = new Float32Array(grid.cols * grid.rows);
    grid.vy = new Float32Array(grid.cols * grid.rows);
  }

  // pointer: from DOM events (interactive) or from the native host (wallpaper)
  const ptr = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, inside: false, seen: 0 };
  function feed(x, y, down) {
    if (!ptr.inside) { ptr.px = x; ptr.py = y; }
    ptr.x = x; ptr.y = y; ptr.down = !!down; ptr.inside = true; ptr.seen = performance.now();
  }
  if (mode === "interactive") {
    canvas.addEventListener("pointermove", (e) => feed(e.clientX, e.clientY, ptr.down));
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); feed(e.clientX, e.clientY, true); startSound(); });
    const up = () => { ptr.down = false; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", () => { if (!ptr.down) ptr.inside = false; });
  }

  // autopilot (screen saver): a slow, invisible hand drawing lazy loops now and then
  const ghost = { on: false, t0: 0, dur: 0, cx: 0, cy: 0, r: 0, dir: 1, next: 4 };
  function autopilot(t) {
    if (!opt.autopilot) return;
    if (!ghost.on && t > ghost.next) {
      Object.assign(ghost, { on: true, t0: t, dur: rand(5, 9), cx: rand(0.3, 0.7) * W, cy: rand(0.35, 0.65) * H, r: rand(0.12, 0.22) * Math.min(W, H), dir: Math.random() < 0.5 ? -1 : 1 });
    }
    if (ghost.on) {
      const k = (t - ghost.t0) / ghost.dur;
      if (k >= 1) { ghost.on = false; ghost.next = t + rand(6, 14); ptr.inside = false; return; }
      const a = k * Math.PI * 2 * ghost.dir;
      feed(ghost.cx + Math.cos(a) * ghost.r, ghost.cy + Math.sin(a) * ghost.r * 0.6, true);
    }
  }

  function writeAir(dt) {
    // a native host that stopped feeding us means the cursor isn't moving
    if (passive && !ghost.on && performance.now() - ptr.seen > 250) ptr.inside = false;
    if (!ptr.inside) return;
    let vx = ptr.vx, vy = ptr.vy;
    const sp = Math.hypot(vx, vy);
    if (sp < 30) return;
    if (sp > 1500) { vx *= 1500 / sp; vy *= 1500 / sp; }
    const R = opt.reach, strength = ptr.down ? 1 : 0.7;
    const c0 = Math.max(0, Math.floor((ptr.x - R) / grid.cw)), c1 = Math.min(grid.cols - 1, Math.ceil((ptr.x + R) / grid.cw));
    const r0 = Math.max(0, Math.floor((ptr.y - R) / grid.ch)), r1 = Math.min(grid.rows - 1, Math.ceil((ptr.y + R) / grid.ch));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const d = Math.hypot((c + 0.5) * grid.cw - ptr.x, (r + 0.5) * grid.ch - ptr.y);
      if (d > R) continue;
      const i = r * grid.cols + c, k = Math.min(1, (1 - d / R) ** 2 * strength * dt * 16);
      grid.vx[i] += (vx - grid.vx[i]) * k;
      grid.vy[i] += (vy - grid.vy[i]) * k;
    }
  }
  function fadeAir(dt) {
    const f = Math.exp(-dt / opt.memory);
    for (let i = 0; i < grid.vx.length; i++) { grid.vx[i] *= f; grid.vy[i] *= f; }
  }
  function sampleAir(sx, sy) {
    const gx = sx / grid.cw - 0.5, gy = sy / grid.ch - 0.5, c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0;
    let vx = 0, vy = 0;
    const add = (c, r, w) => { if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return; vx += grid.vx[r * grid.cols + c] * w; vy += grid.vy[r * grid.cols + c] * w; };
    add(c0, r0, (1 - fx) * (1 - fy)); add(c0 + 1, r0, fx * (1 - fy)); add(c0, r0 + 1, (1 - fx) * fy); add(c0 + 1, r0 + 1, fx * fy);
    return [vx, vy];
  }

  // ---------- flight ----------
  let planes = [];
  function makePlane() {
    const b = bubble, d = norm([rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)]);
    return {
      x: b.cx + rand(-1, 1) * b.rx * 0.8, y: b.cy + rand(-1, 1) * b.ry * 0.8, z: b.cz + rand(-1, 1) * b.rz * 0.8,
      vx: d[0], vy: d[1], vz: d[2], yaw: Math.atan2(d[2], d[0]), pitch: 0, roll: 0, turn: 0, prevYaw: null,
      rate: rand(0.75, 1.25), ph: rand(6.3), trail: [], trailT: 0, follow: 0, alpha: 0,
    };
  }
  const target = () => Math.max(4, Math.round(opt.planes * clamp(W / H / 1.6, 0.6, 1)));   // fewer on narrow screens, but phones still get a full sky
  function syncCount() {
    const n = target();
    while (planes.length < n) planes.push(makePlane());
    if (planes.length > n) planes.length = n;
  }

  let holdTime = 0, lastChime = 0;
  function fly(p, i, dt, t) {
    const c = 1.1 * opt.pace * p.rate, b = bubble;
    const f = flow(p.x, p.y, p.z, t), sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
    let dx = p.vx / sp * 1.2 + f[0] * 0.6, dy = p.vy / sp * 1.2 + f[1] * 0.6, dz = p.vz / sp * 1.2 + f[2] * 0.6;
    // loose flocking (O(n²), fine for a few dozen planes)
    let n = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < planes.length; j++) {
      if (j === i) continue;
      const q = planes[j], ex = p.x - q.x, ey = p.y - q.y, ez = p.z - q.z, d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > 12) continue;
      n++; ax += q.vx; ay += q.vy; az += q.vz; cx += q.x; cy += q.y; cz += q.z;
      if (d2 < 1.4) { sx += ex / (d2 + 0.05); sy += ey / (d2 + 0.05); sz += ez / (d2 + 0.05); }
    }
    if (n) {
      const al = norm([ax, ay, az]), tg = 0.8;
      dx += al[0] * 0.8 * tg + (cx / n - p.x) * 0.12 * tg;
      dy += al[1] * 0.8 * tg + (cy / n - p.y) * 0.12 * tg;
      dz += al[2] * 0.8 * tg + (cz / n - p.z) * 0.12 * tg;
    }
    dx += sx * 0.5; dy += sy * 0.5; dz += sz * 0.5;
    const ox = (p.x - b.cx) / b.rx, oy = (p.y - b.cy) / b.ry, oz = (p.z - b.cz) / b.rz, r = Math.hypot(ox, oy, oz);
    if (r > 0.7) { const push = (r - 0.7) * 5; dx -= (ox / r) * push; dy -= (oy / r) * push * 1.3; dz -= (oz / r) * push; }
    if (p.z < 2.5) dz += (2.5 - p.z) * 3;
    const nn = norm([dx, dy, dz]), glide = 1 - 0.3 * nn[1];
    let wx = nn[0] * c * glide, wy = nn[1] * c * glide, wz = nn[2] * c * glide;

    // copy the motion of the air the pointer moved
    const s = project(p.x, p.y, p.z);
    let w = 0;
    if (s.z > NEAR) {
      const g = sampleAir(s.x, s.y);
      let fx = (g[0] * p.z) / focal, fy = (-g[1] * p.z) / focal;
      const m = Math.hypot(fx, fy), cap = c * 4;
      if (m > cap) { fx *= cap / m; fy *= cap / m; }
      w = clamp(m / (c * 0.6), 0, 1) * opt.follow;
      wx += (fx - wx) * w; wy += (fy - wy) * w; wz *= 1 - 0.7 * w;
    }
    // holding still: circle the fingertip
    if (ptr.down && holdTime > 0.25 && s.z > NEAR) {
      const ds = Math.hypot(s.x - ptr.x, s.y - ptr.y), R = opt.reach * 1.8;
      if (ds < R) {
        const fxw = ((ptr.x - W / 2) / focal) * p.z, fyw = (-(ptr.y - H / 2) / focal) * p.z;
        const ex = fxw - p.x, ey = fyw - p.y, d = Math.hypot(ex, ey) || 0.001;
        const ring = (opt.reach * 0.55 * p.z) / focal, radial = clamp((d - ring) / ring, -1, 1);
        const wo = (1 - ds / R) * Math.min(1, holdTime);
        wx += ((-ey / d) * c * 1.3 + (ex / d) * radial * c - wx) * wo;
        wy += ((ex / d) * c * 1.3 + (ey / d) * radial * c - wy) * wo;
        wz *= 1 - 0.8 * wo;
        w = Math.max(w, wo);
      }
    }
    const k = 1 - Math.exp(-(0.9 + 5 * w) * dt);
    p.vx += (wx - p.vx) * k; p.vy += (wy - p.vy) * k; p.vz += (wz - p.vz) * k;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

    if (w > 0.55 && p.follow < 0.3 && t - lastChime > 0.28) { lastChime = t; chime(clamp((s.x / W) * 2 - 1, -1, 1), s.y); }
    p.follow += (w - p.follow) * (1 - Math.exp(-6 * dt));

    const hor = Math.hypot(p.vx, p.vz), yawT = hor > 0.02 ? Math.atan2(p.vz, p.vx) : p.yaw;
    const pitchT = Math.atan2(p.vy, Math.max(hor, 0.001)) * 0.85;
    if (p.prevYaw !== null && dt > 0) p.turn += (wrap(yawT - p.prevYaw) / dt - p.turn) * (1 - Math.exp(-4 * dt));
    p.prevYaw = yawT;
    const rollT = clamp(p.turn * 0.9, -1, 1) + 0.06 * Math.sin(t * 0.9 + p.ph), e = 1 - Math.exp(-4 * dt);
    p.yaw += wrap(yawT - p.yaw) * e; p.pitch += wrap(pitchT - p.pitch) * e; p.roll += wrap(rollT - p.roll) * e;
    p.alpha = Math.min(1, p.alpha + dt * 0.5);
    if (opt.trails) {
      p.trailT -= dt;
      if (p.trailT <= 0) { p.trailT = 0.07; p.trail.push([p.x, p.y, p.z]); if (p.trail.length > 24) p.trail.shift(); }
    } else if (p.trail.length) p.trail.length = 0;
  }

  // ---------- drawing ----------
  const MOODS = {
    dusk: { paper: [255, 244, 236], fog: [118, 104, 134], line: "rgba(40,30,50,", trail: "rgba(255,236,226,", light: norm([0.5, 0.35, -0.6]), dot: "rgba(255,240,230," },
    day: { paper: [252, 251, 247], fog: [214, 224, 232], line: "rgba(35,45,60,", trail: "rgba(40,55,75,", light: norm([-0.3, 0.85, -0.45]), dot: "rgba(70,80,95," },
    night: { paper: [222, 228, 245], fog: [16, 22, 40], line: "rgba(0,0,0,", trail: "rgba(200,215,255,", light: norm([0.2, 0.9, -0.3]), dot: "rgba(220,230,255," },
  };
  const motes = Array.from({ length: 90 }, () => ({ x: rand(), y: rand(), z: rand(0.2, 1), ph: rand(6.3) }));
  const tris = [];   // reused every frame (no garbage)

  function draw(t) {
    const mood = MOODS[opt.mood] || MOODS.dusk;
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      const tw = opt.mood === "night" ? 0.5 + 0.5 * Math.sin(t * (0.5 + m.z) + m.ph) : 1;
      ctx.fillStyle = mood.dot + ((0.12 + 0.3 * m.z) * tw) + ")";
      const r = opt.mood === "night" ? 0.6 + m.z : 0.8 + m.z * 1.2;
      ctx.fillRect(((m.x + t * 0.002 * m.z) % 1) * W, m.y * H + Math.sin(t * 0.2 + m.ph) * 8, r, r);
    }
    if (opt.trails) {
      ctx.lineWidth = 1;
      for (const p of planes) {
        const tr = p.trail;
        for (let k = 1; k < tr.length; k++) {
          const a = project(tr[k - 1][0], tr[k - 1][1], tr[k - 1][2]), b = project(tr[k][0], tr[k][1], tr[k][2]);
          if (a.z < NEAR || b.z < NEAR) continue;
          ctx.strokeStyle = mood.trail + ((k / tr.length) * 0.22 * p.alpha * (1 - clamp((tr[k][2] - 6) / 16, 0, 0.85))) + ")";
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    tris.length = 0;
    for (const p of planes) {
      for (const tri of TRIS) {
        const w0 = toWorld(p, tri.v[0]), w1 = toWorld(p, tri.v[1]), w2 = toWorld(p, tri.v[2]);
        const s0 = project(w0[0], w0[1], w0[2]), s1 = project(w1[0], w1[1], w1[2]), s2 = project(w2[0], w2[1], w2[2]);
        if (s0.z < NEAR || s1.z < NEAR || s2.z < NEAR) continue;
        const nrm = norm(cross(sub(w1, w0), sub(w2, w0)));
        const depth = (s0.z + s1.z + s2.z) / 3;
        tris.push({ s0, s1, s2, depth, light: (0.58 + 0.42 * Math.abs(dot(nrm, mood.light))) * tri.tone, fog: clamp((depth - 6) / 16, 0, 1) * 0.85, alpha: p.alpha });
      }
    }
    tris.sort((a, b) => b.depth - a.depth);
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.7;
    for (const tr of tris) {
      const r = mood.paper[0] * tr.light, g = mood.paper[1] * tr.light, bl = mood.paper[2] * tr.light;
      ctx.globalAlpha = tr.alpha;
      ctx.fillStyle = `rgb(${Math.round(Math.min(255, r) + (mood.fog[0] - Math.min(255, r)) * tr.fog)},${Math.round(Math.min(255, g) + (mood.fog[1] - Math.min(255, g)) * tr.fog)},${Math.round(Math.min(255, bl) + (mood.fog[2] - Math.min(255, bl)) * tr.fog)})`;
      ctx.strokeStyle = mood.line + (0.35 * (1 - tr.fog)) + ")";
      ctx.beginPath(); ctx.moveTo(tr.s0.x, tr.s0.y); ctx.lineTo(tr.s1.x, tr.s1.y); ctx.lineTo(tr.s2.x, tr.s2.y); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // fingertip glow (interactive only; on the desktop the real cursor is visible)
    if (mode === "interactive" && (ptr.inside || ptr.down)) {
      const g = ctx.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, 26);
      g.addColorStop(0, mood.trail + "0.45)"); g.addColorStop(1, mood.trail + "0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 26, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- sound (pad, chimes, wind), all synthesised ----------
  let ac = null, master = null, windG = null, windF = null, padTimer = 0.5;
  const PENTA = [0, 2, 4, 7, 9], ROOTS = { dusk: 50, day: 55, night: 45 };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const noteAt = (d, root) => root + PENTA[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
  function startSound() {
    if (!opt.sound || ac) { if (ac && ac.state === "suspended") ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    // short synthetic reverb (2.5 s keeps the convolver cheap)
    const len = Math.floor(ac.sampleRate * 2.5), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const verb = ac.createConvolver(); verb.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = 0.5;
    master.connect(verb).connect(wet).connect(ac.destination);
    // wind: looped noise through a slow low-pass
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = nb; src.loop = true;
    windF = ac.createBiquadFilter(); windF.type = "lowpass"; windF.frequency.value = 320;
    windG = ac.createGain(); windG.gain.value = 0;
    src.connect(windF).connect(windG).connect(master); src.start();
    if (ac.state === "suspended") ac.resume();
  }
  function tone(freq, dur, attack, gain, type, pan) {
    if (!ac || ac.state !== "running") return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function pad() {
    const root = ROOTS[opt.mood] || 50, base = Math.floor(rand(0, 5));
    for (const st of [0, 2, 4]) { const f = mtof(noteAt(base + st, root)); tone(f, 9, 2.5, 0.05, "sine"); tone(f * 2.003, 7, 3, 0.008, "triangle"); }
    tone(mtof(root - 12), 10, 3, 0.035, "sine");
  }
  function chime(pan, sy) {
    const f = mtof(noteAt(Math.floor((1 - sy / H) * 8), (ROOTS[opt.mood] || 50) + 24));
    tone(f, 2.6, 0.01, 0.05, "sine", pan); tone(f * 3, 0.9, 0.01, 0.008, "sine", pan);
  }
  function updateSound(dt, t) {
    if (!ac || ac.state !== "running") return;
    padTimer -= dt;
    if (padTimer <= 0) { pad(); padTimer = rand(5, 8); }
    const motion = ptr.inside ? clamp(Math.hypot(ptr.vx, ptr.vy) / 1200, 0, 1) : 0;
    windG.gain.setTargetAtTime(0.035 + 0.02 * Math.sin(t * 0.11) + motion * 0.05, ac.currentTime, 0.3);
    windF.frequency.setTargetAtTime(280 + 120 * Math.sin(t * 0.07) + motion * 500, ac.currentTime, 0.3);
  }

  // ---------- clock (screen saver / lock vibe) ----------
  const clockEl = document.getElementById("clock");
  let clockMin = -1;
  function updateClock() {
    if (!opt.clock) { clockEl.hidden = true; return; }
    clockEl.hidden = false;
    const d = new Date();
    if (d.getMinutes() === clockMin) return;
    clockMin = d.getMinutes();
    clockEl.querySelector(".time").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    clockEl.querySelector(".date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }

  // ---------- loop: frame cap, pause, profiling ----------
  let raf = 0, last = 0, lastDraw = 0, t = 0, paused = false;
  const perf = { frames: 0, since: performance.now(), fps: 0, work: 0, frameMs: 0 };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const minGap = 1000 / opt.fps - 1;
    if (now - lastDraw < minGap) return;           // frame cap: skip this vsync
    lastDraw = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const w0 = performance.now();
    syncCount();
    autopilot(t);
    ptr.vx += ((ptr.x - ptr.px) / Math.max(dt, 1e-3) - ptr.vx) * 0.5;
    ptr.vy += ((ptr.y - ptr.py) / Math.max(dt, 1e-3) - ptr.vy) * 0.5;
    ptr.px = ptr.x; ptr.py = ptr.y;
    holdTime = ptr.down && Math.hypot(ptr.vx, ptr.vy) < 60 ? holdTime + dt : 0;
    writeAir(dt); fadeAir(dt);
    for (let i = 0; i < planes.length; i++) fly(planes[i], i, dt, t);
    updateSound(dt, t);
    draw(t);
    updateClock();
    perf.work += performance.now() - w0;
    perf.frames++;
    if (now - perf.since > 1000) {
      perf.fps = perf.frames * 1000 / (now - perf.since);
      perf.frameMs = perf.work / perf.frames;
      perf.frames = 0; perf.work = 0; perf.since = now;
    }
  }
  function pause() {
    if (paused) return;
    paused = true;
    cancelAnimationFrame(raf);
    if (ac && ac.state === "running") ac.suspend();
  }
  function resume() {
    if (!paused) return;
    paused = false;
    last = lastDraw = performance.now();
    raf = requestAnimationFrame(frame);
    if (ac && ac.state === "suspended") ac.resume();
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));

  // ---------- interactive chrome ----------
  const begin = document.getElementById("begin");
  if (begin) {
    if (mode !== "interactive" || !opt.sound) begin.hidden = true;
    begin.addEventListener("click", () => { startSound(); begin.classList.add("fading"); setTimeout(() => { begin.hidden = true; }, 1100); });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.webkit?.messageHandlers?.paperSky?.postMessage("close");
  });

  // ---------- export: still + video (wallpaper studio) ----------
  // The sky canvas is transparent (the gradient is CSS), so exports paint the gradient first.
  const SKY_STOPS = {
    dusk: [[0, "#232a45"], [0.45, "#4b4a6b"], [0.8, "#b48a8f"], [1, "#e7b99c"]],
    day: [[0, "#a9c3dc"], [0.55, "#d5e1ea"], [1, "#f4ece0"]],
    night: [[0, "#03050b"], [0.6, "#0a1020"], [1, "#141a2c"]],
  };
  function compose(out) {
    const c = out.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, out.height);
    for (const [at, col] of SKY_STOPS[opt.mood] || SKY_STOPS.dusk) g.addColorStop(at, col);
    c.fillStyle = g;
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, 0, 0, out.width, out.height);
    if (opt.clock && !clockEl.hidden) {
      const s = out.width / W, d = new Date();
      c.fillStyle = opt.mood === "day" ? "rgba(25,32,42,0.85)" : "rgba(255,248,242,0.92)";
      c.textAlign = "center";
      c.font = `500 ${Math.round(18 * s)}px -apple-system, system-ui, sans-serif`;
      c.fillText(d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }), out.width / 2, out.height * 0.14);
      c.font = `600 ${Math.round(Math.min(150, W * 0.2) * s)}px -apple-system, system-ui, sans-serif`;
      c.fillText(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), out.width / 2, out.height * 0.14 + Math.min(150, W * 0.2) * s);
    }
    return out;
  }
  function snapshot() {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    return compose(out);
  }
  function record(seconds = 6) {
    return new Promise((resolve, reject) => {
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      if (!out.captureStream || !window.MediaRecorder) { reject(new Error("Video recording isn't supported in this browser.")); return; }
      const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const type = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(out.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 12e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type || "video/webm" }));
      rec.onerror = (e) => reject(e.error || e);
      let live = true;
      const pump = () => { if (!live) return; compose(out); requestAnimationFrame(pump); };
      pump();
      rec.start(250);
      setTimeout(() => { live = false; rec.stop(); }, seconds * 1000);
    });
  }

  // ---------- installed phone app: a tiny ⋯ menu ----------
  const appMenu = document.getElementById("appMenu");
  if (appMenu) {
    appMenu.hidden = !isApp;
    const remember = () => { try { localStorage.setItem("paperSky:app", JSON.stringify({ mood: opt.mood, clock: opt.clock })); } catch { /* ignore */ } };
    appMenu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-app]");
      if (!b) { appMenu.classList.toggle("open"); return; }
      if (b.dataset.app === "mood") {
        const order = ["dusk", "day", "night"];
        window.paperSky.set({ mood: order[(order.indexOf(opt.mood) + 1) % order.length] });
      }
      if (b.dataset.app === "clock") window.paperSky.set({ clock: !opt.clock });
      if (b.dataset.app === "sound") { startSound(); if (ac) (ac.state === "running" ? ac.suspend() : ac.resume()); }
      remember();
    });
  }

  // ---------- public API for native hosts ----------
  window.paperSky = {
    pointer(x, y, down) { feed(x, y, down); },
    pause, resume,
    set(patch) {
      Object.assign(opt, patch);
      root.dataset.mood = opt.mood;
      if ("dpr" in patch) resize();
      if (patch.sound) startSound();
      if (patch.sound === false && ac) ac.suspend();
      if (patch.sound === true && ac && ac.state === "suspended") ac.resume();
      clockMin = -1;
    },
    startSound,
    stats: () => ({ fps: Math.round(perf.fps), frameMs: +perf.frameMs.toFixed(2), planes: planes.length, px: `${canvas.width}×${canvas.height}` }),
    options: opt,
    snapshot,
    record,
  };

  resize();
  syncCount();
  if (passive && opt.sound) startSound();   // native hosts allow audio without a click
  raf = requestAnimationFrame((n) => { last = lastDraw = n; frame(n); });
})();
