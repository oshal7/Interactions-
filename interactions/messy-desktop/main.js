// ---------------------------------------------------------------
// 02 · Messy desktop
//
// Structure:
//   1. config + persistence
//   2. window model           (centre x/y, rotation, scale, velocity)
//   3. the animation loop     (drag tilt, momentum, glides)
//   4. pointer + keyboard     (drag, throw, bring to front)
//   5. put away / bring back + arrangements
//   6. menu bar, popover, playground wiring
// ---------------------------------------------------------------
import { createClicker } from "../../assets/js/sound.js";
import { WINDOWS } from "./windows.js";

// ---------- 1. config ----------
const DEFAULTS = {
  lift: 1.03,        // scale multiplier while held
  tilt: true,
  tiltAmount: 1,     // how much horizontal speed turns into rotation
  maxTilt: 10,       // degrees
  momentum: true,
  glide: 0.94,       // velocity kept per 16ms after release (friction)
  bounce: true,
  bounciness: 0.5,   // energy kept after hitting a wall
  size: 1,
  stagger: 45,       // ms between windows when putting away / bringing back
  sound: true,
  volume: 0.5,
};
const STORE_KEY = "lab:messy-desktop";
const config = { ...DEFAULTS, ...load() };
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

const $ = (s, el = document) => el.querySelector(s);
const desk = $("#desk");
const layer = $("#windows");
const trayBtn = $("#trayBtn");
const popover = $("#popover");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const MENU_H = 28;
let W = desk.clientWidth;
let H = desk.clientHeight;
let topZ = 10;

// ---------- sounds (synthesised, see assets/js/sound.js) ----------
const sfx = {
  pick: createClicker({ profile: "pop", pitch: 2400 }),
  drop: createClicker({ profile: "thocky", pitch: 2600 }),
  tick: createClicker({ profile: "clicky", pitch: 2600 }),
};
function applySound() {
  for (const c of Object.values(sfx)) c.set({ enabled: config.sound, volume: config.volume });
}

// ---------- 2. window model ----------
const baseScale = () => Math.min(1, Math.max(0.42, W / 1150)) * config.size;

const wins = WINDOWS.map((def, i) => {
  const el = document.createElement("div");
  el.className = `win ${def.theme}`;
  el.style.width = `${def.w}px`;
  el.style.height = `${def.h}px`;
  el.style.zIndex = String(++topZ);
  el.tabIndex = 0;
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", `${def.title} window. Drag it, or use the arrow keys to move it.`);
  el.innerHTML = `
    <div class="win-bar">
      <span class="lights"><button type="button" aria-label="Put ${def.title} away" tabindex="-1"></button><i></i><i></i></span>
      <span class="title">${def.title}</span>
    </div>
    <div class="win-body">${def.body}</div>`;
  layer.append(el);
  return {
    el, def, i,
    x: def.x * W, y: def.y * H,
    rot: 0, baseRot: 0, lift: 1, s: 1, alpha: 1,
    vx: 0, vy: 0,
    grab: null, samples: [],
    glide: null, away: false, home: null, lastTick: 0,
  };
});

function render(w) {
  const sc = baseScale() * w.lift * w.s;
  w.el.style.transform =
    `translate(${w.x - w.def.w / 2}px, ${w.y - w.def.h / 2}px) rotate(${w.rot}deg) scale(${sc})`;
  w.el.style.opacity = w.alpha;
}

function bounds() {
  return { minX: 24, maxX: W - 24, minY: MENU_H + 18, maxY: H - 18 };
}

// ---------- 3. animation loop (only runs while something moves) ----------
let raf = 0;
let last = 0;
function kick() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}
function tick(now) {
  const dt = Math.min(48, now - last);
  last = now;
  let active = false;
  for (const w of wins) {
    if (step(w, dt, now)) active = true;
    render(w);
  }
  raf = active ? requestAnimationFrame(tick) : 0;
}

const ease = (dt, k) => 1 - Math.pow(1 - k, dt / 16);   // frame-rate independent lerp factor
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tiltFor = (vx) => (config.tilt ? clamp(vx * 20 * config.tiltAmount, -config.maxTilt, config.maxTilt) : 0);

function step(w, dt, now) {
  // a) gliding to a target (put away, bring back, arrange)
  if (w.glide) {
    const g = w.glide;
    if (now < g.start) return true;
    if (!g.started) { g.started = true; g.onStart?.(); }
    const k = reducedMotion.matches ? 1 : ease(dt, 0.14);
    w.x += (g.x - w.x) * k;
    w.y += (g.y - w.y) * k;
    w.s += (g.s - w.s) * k;
    w.alpha += (g.alpha - w.alpha) * k;
    w.rot += (g.rot - w.rot) * k;
    const done = Math.abs(g.x - w.x) < 0.5 && Math.abs(g.y - w.y) < 0.5 &&
      Math.abs(g.s - w.s) < 0.002 && Math.abs(g.alpha - w.alpha) < 0.01;
    if (done) {
      Object.assign(w, { x: g.x, y: g.y, s: g.s, alpha: g.alpha, rot: g.rot, baseRot: g.rot });
      w.glide = null;
      g.onDone?.();
    }
    return true;
  }

  // b) being dragged: follow is done in pointermove; here we only tilt + lift
  if (w.grab) {
    const v = velocity(w, now);
    w.vx = v.x; w.vy = v.y;
    w.rot += (w.baseRot + tiltFor(w.vx) - w.rot) * ease(dt, 0.2);
    w.lift += (config.lift - w.lift) * ease(dt, 0.25);
    return true;
  }

  // c) free: momentum + walls, then settle tilt and lift
  let moving = false;
  if (Math.hypot(w.vx, w.vy) > 0.005) {
    moving = true;
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    const f = Math.pow(config.glide, dt / 16);
    w.vx *= f; w.vy *= f;
    walls(w, now);
  } else {
    w.vx = w.vy = 0;
  }
  w.rot += (w.baseRot + tiltFor(w.vx) - w.rot) * ease(dt, 0.18);
  w.lift += (1 - w.lift) * ease(dt, 0.25);
  return moving || Math.abs(w.rot - w.baseRot) > 0.05 || Math.abs(w.lift - 1) > 0.001;
}

function walls(w, now) {
  const b = bounds();
  let hit = 0;
  if (w.x < b.minX || w.x > b.maxX) {
    w.x = clamp(w.x, b.minX, b.maxX);
    hit = Math.abs(w.vx);
    w.vx = config.bounce ? -w.vx * config.bounciness : 0;
  }
  if (w.y < b.minY || w.y > b.maxY) {
    w.y = clamp(w.y, b.minY, b.maxY);
    hit = Math.max(hit, Math.abs(w.vy));
    w.vy = config.bounce ? -w.vy * config.bounciness : 0;
  }
  if (hit > 0.15 && config.bounce && now - w.lastTick > 80) {
    w.lastTick = now;
    sfx.tick.set({ pitch: 2600, volume: config.volume * Math.min(1, hit) * 0.8 });
    sfx.tick.press();
  }
}

// Speed over the last ~80ms of pointer samples, in px per ms.
function velocity(w, now) {
  const s = w.samples;
  if (s.length < 2 || now - s[s.length - 1].t > 60) return { x: 0, y: 0 };
  const a = s[0], b = s[s.length - 1];
  const t = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / t, y: (b.y - a.y) / t };
}

// ---------- 4. pointer + keyboard ----------
function toStage(e) {
  const r = desk.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function front(w) { w.el.style.zIndex = String(++topZ); }

for (const w of wins) {
  const el = w.el;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || w.away || w.glide?.leaving || e.target.closest("button")) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    front(w);
    w.glide = null;
    w.vx = w.vy = 0;
    const p = toStage(e);
    w.grab = { dx: p.x - w.x, dy: p.y - w.y };
    w.samples = [{ ...p, t: e.timeStamp }];
    el.classList.add("is-dragging");
    sfx.pick.set({ pitch: 2400 });
    sfx.pick.press();
    kick();
  });

  el.addEventListener("pointermove", (e) => {
    if (!w.grab) return;
    const p = toStage(e);
    w.x = p.x - w.grab.dx;
    w.y = p.y - w.grab.dy;
    w.samples.push({ ...p, t: e.timeStamp });
    while (w.samples.length > 2 && e.timeStamp - w.samples[0].t > 80) w.samples.shift();
    render(w);   // 1:1 with the pointer, no waiting for the next frame
  });

  const release = (e) => {
    if (!w.grab) return;
    const v = velocity(w, e.timeStamp);
    w.grab = null;
    w.samples = [];
    el.classList.remove("is-dragging");
    const throwable = config.momentum && !reducedMotion.matches;
    w.vx = throwable ? clamp(v.x, -4, 4) : 0;
    w.vy = throwable ? clamp(v.y, -4, 4) : 0;
    if (!throwable) { const b = bounds(); w.x = clamp(w.x, b.minX, b.maxX); w.y = clamp(w.y, b.minY, b.maxY); }
    sfx.drop.press();
    kick();
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  // red "close" light puts just this window away
  el.querySelector(".lights button").addEventListener("click", () => putAway([w]));

  // keyboard: focus brings to front, arrows move
  el.addEventListener("focus", () => front(w));
  el.addEventListener("keydown", (e) => {
    const d = e.shiftKey ? 48 : 12;
    const move = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!move) return;
    e.preventDefault();
    const b = bounds();
    w.x = clamp(w.x + move[0], b.minX, b.maxX);
    w.y = clamp(w.y + move[1], b.minY, b.maxY);
    render(w);
  });
}

// ---------- 5. put away / bring back + arrangements ----------
function glideTo(w, target, delay = 0, hooks = {}) {
  w.grab = null;
  w.vx = w.vy = 0;
  w.glide = {
    x: target.x ?? w.x, y: target.y ?? w.y,
    s: target.s ?? 1, alpha: target.alpha ?? 1, rot: target.rot ?? 0,
    start: performance.now() + (reducedMotion.matches ? 0 : delay),
    ...hooks,
  };
  kick();
}

function trayPoint() {
  const r = desk.getBoundingClientRect();
  const t = trayBtn.getBoundingClientRect();
  return { x: t.left + t.width / 2 - r.left, y: t.top + t.height / 2 - r.top };
}

function putAway(list = wins) {
  const tray = trayPoint();
  // topmost windows leave first
  const visible = list.filter((w) => !w.away && !w.glide?.leaving)
    .sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
  visible.forEach((w, i) => {
    w.home = { x: w.x, y: w.y, s: w.s, rot: w.baseRot };
    glideTo(w, { x: tray.x, y: tray.y, s: 0.05, alpha: 0 }, i * config.stagger, {
      leaving: true,
      onDone: () => {
        w.away = true;
        w.el.classList.add("is-away");
        w.el.setAttribute("aria-hidden", "true");
        w.el.tabIndex = -1;
        sfx.tick.set({ pitch: 2200 + i * 260, volume: config.volume * 0.7 });
        sfx.tick.press();
        trayBtn.classList.remove("bump");
        void trayBtn.offsetWidth;   // restart the CSS animation
        trayBtn.classList.add("bump");
      },
    });
  });
  closePopover();
}

function bringBack() {
  const tray = trayPoint();
  const away = wins.filter((w) => w.away || w.glide?.leaving);
  away.forEach((w, i) => {
    if (w.away) Object.assign(w, { x: tray.x, y: tray.y, s: 0.05, alpha: 0 });
    w.away = false;
    w.el.classList.remove("is-away");
    w.el.removeAttribute("aria-hidden");
    w.el.tabIndex = 0;
    const home = w.home ?? { x: w.def.x * W, y: w.def.y * H, s: 1, rot: 0 };
    glideTo(w, { ...home, alpha: 1 }, i * config.stagger, {
      onStart: () => {
        front(w);
        sfx.pick.set({ pitch: 1800 + i * 120 });
        sfx.pick.press();
      },
    });
  });
}

function arrange(kind) {
  bringBackSilently();
  const b = bounds();
  const n = wins.length;
  const base = baseScale();

  if (kind === "tidy") {
    const cols = Math.max(1, Math.round(Math.sqrt(n * (W / (H - MENU_H)) * 0.75)));
    const rows = Math.ceil(n / cols);
    const cw = W / cols, ch = (H - MENU_H) / rows;
    wins.forEach((w, i) => {
      const fit = Math.min(1, (cw * 0.88) / (w.def.w * base), (ch * 0.84) / (w.def.h * base));
      glideTo(w, { x: cw * (i % cols + 0.5), y: MENU_H + ch * (Math.floor(i / cols) + 0.5), s: fit }, i * 25);
    });
  } else if (kind === "pile") {
    wins.forEach((w, i) => glideTo(w, {
      x: W / 2 + (Math.random() - 0.5) * 80,
      y: H * 0.55 + (Math.random() - 0.5) * 60,
      rot: (Math.random() - 0.5) * 16,
    }, i * 30, { onStart: () => front(w) }));
  } else if (kind === "cascade") {
    const step = Math.min(34, (W * 0.5) / n);
    wins.forEach((w, i) => glideTo(w, {
      x: W * 0.3 + i * step,
      y: MENU_H + H * 0.22 + i * step * 0.8,
    }, i * 35, { onStart: () => front(w) }));
  } else if (kind === "scatter") {
    wins.forEach((w, i) => glideTo(w, {
      x: b.minX + Math.random() * (b.maxX - b.minX),
      y: b.minY + Math.random() * (b.maxY - b.minY),
    }, i * 20));
  } else if (kind === "reset") {
    wins.forEach((w, i) => glideTo(w, { x: w.def.x * W, y: w.def.y * H }, i * 20));
  }
}

// Arrangements should include windows that were put away.
function bringBackSilently() {
  const tray = trayPoint();
  for (const w of wins) {
    if (!w.away && !w.glide?.leaving) continue;
    if (w.away) Object.assign(w, { x: tray.x, y: tray.y, s: 0.05, alpha: 0 });
    w.away = false;
    w.el.classList.remove("is-away");
    w.el.removeAttribute("aria-hidden");
    w.el.tabIndex = 0;
  }
}

$("#restoreBtn").addEventListener("click", bringBack);
$("#stashBtn").addEventListener("click", () => putAway());

// "T" toggles put away / bring back (ignored while typing in a field)
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, select, textarea")) return;
  if (wins.every((w) => w.away || w.glide?.leaving)) bringBack(); else putAway();
});

// ---------- 6. menu bar, popover, playground ----------
function openPopover() {
  popover.hidden = false;
  trayBtn.setAttribute("aria-expanded", "true");
  desk.classList.add("hint-off");
  popover.querySelector("input")?.focus({ preventScroll: true });
}
function closePopover() {
  if (popover.hidden) return;
  popover.hidden = true;
  trayBtn.setAttribute("aria-expanded", "false");
}
trayBtn.addEventListener("click", () => (popover.hidden ? openPopover() : closePopover()));
document.addEventListener("pointerdown", (e) => {
  if (!popover.hidden && !e.target.closest(".tray-wrap")) closePopover();
});
popover.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closePopover(); trayBtn.focus(); }
});

const clock = $("#clock");
function updateClock() {
  clock.textContent = new Date().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
updateClock();
setInterval(updateClock, 15000);

const FORMAT = {
  lift: (v) => `${Number(v).toFixed(2)}×`,
  tiltAmount: (v) => `${Number(v).toFixed(1)}×`,
  maxTilt: (v) => `${v}°`,
  glide: (v) => Number(v).toFixed(3),
  bounciness: (v) => `${Math.round(v * 100)}%`,
  size: (v) => `${Number(v).toFixed(2)}×`,
  stagger: (v) => `${v}ms`,
  volume: (v) => `${Math.round(v * 100)}%`,
};

function sync() {
  document.querySelectorAll("[data-key]").forEach((input) => {
    const v = config[input.dataset.key];
    if (input.type === "checkbox") input.checked = Boolean(v);
    else if (document.activeElement !== input) input.value = v;
  });
  document.querySelectorAll("[data-out]").forEach((out) => {
    const k = out.dataset.out;
    out.textContent = FORMAT[k] ? FORMAT[k](config[k]) : config[k];
  });
}

document.addEventListener("input", (e) => {
  const el = e.target;
  const k = el.dataset?.key;
  if (!k || !(k in config)) return;
  config[k] = el.type === "checkbox" ? el.checked : Number(el.value);
  applySound();
  sync();
  save();
  if (k === "size") wins.forEach(render);
});

$(".panel").addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "reset") {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    applySound();
    sync();
    wins.forEach((w) => { w.home = null; });
  }
  arrange(action);
});

// Keep the layout proportional when the stage resizes.
new ResizeObserver(() => {
  const nw = desk.clientWidth, nh = desk.clientHeight;
  if (!nw || !nh || (nw === W && nh === H)) return;
  for (const w of wins) {
    w.x *= nw / W; w.y *= nh / H;
    if (w.home) { w.home.x *= nw / W; w.home.y *= nh / H; }
  }
  W = nw; H = nh;
  wins.forEach(render);
}).observe(desk);

applySound();
sync();
wins.forEach(render);
