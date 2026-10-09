// ---------------------------------------------------------------
// 03 · Star dodger
//
// Structure:
//   1. config, best scores, sounds
//   2. canvas + input (pointer, touch, keyboard)
//   3. game state + start / pause / game over
//   4. update(dt): move, spawn, collide
//   5. draw(): paint everything
//   6. HUD + playground wiring
// ---------------------------------------------------------------
import { createSynth } from "../../assets/js/sound.js";

// ---------- 1. config ----------
const DEFAULTS = {
  follow: 0.2,       // fraction of the gap the dot closes per 60Hz frame
  lives: 3,
  god: false,
  stars: 1,
  spikeStart: 3,     // seconds
  spikeSpeed: 1,
  spikeRate: 1,
  bombStart: 10,
  bombSize: 140,     // px
  fuse: 1.4,         // seconds from warning to blast
  showZone: true,
  ramp: 1,
  shake: true,
  hitboxes: false,
  sound: true,
  volume: 0.6,
};
const STORE_KEY = "lab:star-dodger";
const BEST_KEY = "lab:star-dodger:best";
const config = { ...DEFAULTS, ...read(STORE_KEY) };
let best = { time: 0, score: 0, ...read(BEST_KEY) };

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// ---------- sounds: every effect is a recipe of tone() + noise() ----------
const synth = createSynth();
const SFX = {
  star(streak = 0) {
    const f = 880 * Math.pow(2, Math.min(streak, 12) / 12);   // up a semitone per chained star
    synth.tone({ freq: f, to: f * 1.5, type: "triangle", dur: 0.12, gain: 0.35 });
    synth.tone({ freq: f * 1.5, type: "sine", dur: 0.18, gain: 0.2, delay: 0.06 });
  },
  hit() {
    synth.noise({ dur: 0.3, freq: 600, to: 80, gain: 0.7 });
    synth.tone({ freq: 160, to: 50, type: "sine", dur: 0.28, gain: 0.6 });
  },
  tick() { synth.tone({ freq: 1400, type: "square", dur: 0.03, gain: 0.08 }); },
  boom() {
    synth.noise({ dur: 0.7, freq: 1200, to: 60, gain: 0.8 });
    synth.tone({ freq: 110, to: 30, type: "sine", dur: 0.5, gain: 0.7 });
  },
  phase() { synth.tone({ freq: 300, to: 900, type: "sine", dur: 0.25, gain: 0.25 }); },
  start() {
    [523, 659, 784].forEach((f, i) => synth.tone({ freq: f, type: "triangle", dur: 0.12, gain: 0.25, delay: i * 0.07 }));
  },
  over() {
    synth.tone({ freq: 440, to: 110, type: "triangle", dur: 0.8, gain: 0.35 });
    synth.noise({ dur: 0.6, freq: 800, to: 100, gain: 0.25, delay: 0.1 });
  },
};
function applySound() { synth.set({ enabled: config.sound, volume: config.volume }); }

// ---------- 2. canvas + input ----------
const $ = (s) => document.querySelector(s);
const arena = $("#arena");
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  W = arena.clientWidth;
  H = arena.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels
  if (state !== "playing") draw();
}
new ResizeObserver(resize).observe(arena);

// Where the crosshair is (the dot chases this).
const target = { x: 0, y: 0 };
let pointerInside = false;

arena.addEventListener("pointermove", (e) => {
  const r = arena.getBoundingClientRect();
  target.x = e.clientX - r.left;
  target.y = e.clientY - r.top;
  pointerInside = true;
});
arena.addEventListener("pointerdown", (e) => {
  if (state !== "playing") return;
  // touch: the finger *is* the crosshair, and it shouldn't scroll the page
  if (e.pointerType === "touch") arena.setPointerCapture(e.pointerId);
  const r = arena.getBoundingClientRect();
  target.x = e.clientX - r.left;
  target.y = e.clientY - r.top;
});
arena.addEventListener("pointerleave", () => { pointerInside = false; });

// Keyboard: arrows / WASD steer the crosshair.
const keys = new Set();
const KEYMAP = { ArrowLeft: "l", a: "l", ArrowRight: "r", d: "r", ArrowUp: "u", w: "u", ArrowDown: "d", s: "d" };
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  const k = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase?.()];
  if (state === "playing" && k) { keys.add(k); e.preventDefault(); }
  if (e.key === "Escape" && state === "playing") pause();
});
document.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase?.()];
  if (k) keys.delete(k);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") pause();
});

// ---------- 3. game state ----------
let state = "idle";           // idle | playing | paused | over
let time = 0;
let score = 0;
let lives = config.lives;
let streak = 0;
let lastStarAt = -10;
let invuln = 0;               // seconds of post-hit invincibility left
let shake = 0;
let phase = -1;
let spikeTimer = 0;
let bombTimer = 0;

const player = { x: 0, y: 0, r: 6 };
let stars = [];
let spikes = [];
let bombs = [];
let particles = [];

function start() {
  synth.unlock();             // we're inside a click: allow audio from now on
  time = 0; score = 0; streak = 0; lastStarAt = -10;
  lives = config.lives;
  invuln = 1;                 // a short grace period at the start
  shake = 0; phase = -1;
  spikeTimer = 0.4; bombTimer = 1;
  stars = []; spikes = []; bombs = []; particles = [];
  player.x = target.x = W / 2;
  player.y = target.y = H * 0.62;
  keys.clear();
  setState("playing");
  SFX.start();
  updateHud(true);
  announce("Game started.");
  arena.focus({ preventScroll: true });
  loop();
}

function pause() {
  setState("paused");
  $("#pauseOverlay").hidden = false;
  $("#pauseOverlay button").focus({ preventScroll: true });
}
function resume() {
  $("#pauseOverlay").hidden = true;
  setState("playing");
  loop();
}

function gameOver() {
  setState("over");
  SFX.over();
  const t = Math.floor(time);
  const newBest = t > best.time || score > best.score;
  best = { time: Math.max(best.time, t), score: Math.max(best.score, score) };
  write(BEST_KEY, best);
  $("#overTime").textContent = fmt(t);
  $("#overScore").textContent = `✦ ${score}`;
  $("#bestTime").textContent = fmt(best.time);
  $("#bestScore").textContent = `✦ ${best.score}`;
  $("#newBest").hidden = !newBest;
  $("#overOverlay").hidden = false;
  $("#overOverlay [data-action='again']").focus({ preventScroll: true });
  announce(`Game over. You lasted ${t} seconds and got ${score} stars.`);
}

function goHome() {
  $("#overOverlay").hidden = true;
  stars = []; spikes = []; bombs = []; particles = [];
  setState("idle");
  draw();
  $("#playCard").focus({ preventScroll: true });
}

function setState(s) {
  state = s;
  arena.dataset.state = s;
}

// ---------- the loop ----------
let last = 0;
let raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state !== "playing") return;
  update(dt);
  draw();
  if (state === "playing") raf = requestAnimationFrame(frame);
}

// ---------- 4. update ----------
const rand = (a, b) => a + Math.random() * (b - a);
const touching = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;

function update(dt) {
  time += dt;
  const level = 1 + (time / 30) * config.ramp;

  // keyboard steering moves the crosshair
  if (keys.size) {
    const v = 420 * dt;
    if (keys.has("l")) target.x -= v;
    if (keys.has("r")) target.x += v;
    if (keys.has("u")) target.y -= v;
    if (keys.has("d")) target.y += v;
  }
  target.x = Math.min(W - 4, Math.max(4, target.x));
  target.y = Math.min(H - 4, Math.max(4, target.y));

  // the dot eases toward the crosshair (frame-rate independent)
  const k = 1 - Math.pow(1 - config.follow, dt * 60);
  player.x += (target.x - player.x) * k;
  player.y += (target.y - player.y) * k;

  invuln = Math.max(0, invuln - dt);
  shake = Math.max(0, shake - dt);

  updatePhase();

  // --- stars: keep N on screen, collect on touch
  while (stars.length < config.stars) stars.push(spawnStar());
  if (stars.length > config.stars) stars.length = config.stars;
  for (const s of stars) {
    s.age += dt;
    if (s.age > 0.15 && touching(player, s)) {
      s.dead = true;
      score += 1;
      streak = time - lastStarAt < 2.5 ? streak + 1 : 0;
      lastStarAt = time;
      SFX.star(streak);
      burst(s.x, s.y, "#ffffff", 14);
      bumpStat("score", "pop");
    }
  }
  stars = stars.filter((s) => !s.dead);

  // --- spikes: fall from the top, speed and rate ramp up
  spikeTimer -= dt;
  if (time >= config.spikeStart && spikeTimer <= 0) {
    spikes.push({ x: rand(10, W - 10), y: -10, r: 6, len: rand(50, 90), speed: rand(180, 280) * config.spikeSpeed * level });
    spikeTimer = rand(0.6, 1.1) / (config.spikeRate * level);
  }
  for (const s of spikes) {
    s.y += s.speed * dt;
    if (touching(player, s)) { s.dead = true; hurt(s.x, s.y); }
    if (s.y - s.len > H) s.dead = true;
  }
  spikes = spikes.filter((s) => !s.dead);

  // --- bombs: warn, tick, blast
  bombTimer -= dt;
  if (time >= config.bombStart && bombTimer <= 0) {
    const half = config.bombSize / 2;
    bombs.push({
      // aim near the player so they have to move
      x: Math.min(W - half, Math.max(half, player.x + rand(-140, 140))),
      y: Math.min(H - half, Math.max(half, player.y + rand(-120, 120))),
      size: config.bombSize, fuse: config.fuse, age: 0, nextTick: 0, blasted: false,
    });
    bombTimer = rand(2.6, 4) / level;
  }
  for (const b of bombs) {
    b.age += dt;
    if (!b.blasted) {
      // ticks get faster as the fuse burns down
      if (b.age >= b.nextTick) {
        SFX.tick();
        const left = Math.max(0, b.fuse - b.age);
        b.nextTick = b.age + Math.max(0.07, left * 0.28);
      }
      if (b.age >= b.fuse) {
        b.blasted = true;
        b.age = 0;
        SFX.boom();
        if (config.shake && !reducedMotion.matches) shake = Math.max(shake, 0.25);
        const inside = Math.abs(player.x - b.x) < b.size / 2 + player.r &&
                       Math.abs(player.y - b.y) < b.size / 2 + player.r;
        if (inside) hurt(player.x, player.y);
      }
    } else if (b.age > 0.6) {
      b.dead = true;
    }
  }
  bombs = bombs.filter((b) => !b.dead);

  // --- particles
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.92; p.vy *= 0.92;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);

  updateHud();
}

function spawnStar() {
  // somewhere clear of the player and away from the edges
  let s;
  for (let i = 0; i < 20; i++) {
    s = { x: rand(30, W - 30), y: rand(30, H - 30), r: 11, age: 0, spin: rand(0, Math.PI) };
    if (Math.hypot(s.x - player.x, s.y - player.y) > 140) break;
  }
  return s;
}

function hurt(x, y) {
  if (invuln > 0 || config.god) return;
  lives -= 1;
  invuln = 1.2;
  streak = 0;
  SFX.hit();
  burst(x, y, "#e11d48", 18);
  if (config.shake && !reducedMotion.matches) shake = 0.3;
  bumpStat("lives", "hurt");
  if (lives <= 0) { updateHud(true); gameOver(); }
}

function burst(x, y, color, n) {
  if (reducedMotion.matches) return;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 260);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.6), max: 0.6, color });
  }
}

// Phase hints (and a little sweep when a new one starts)
const PHASES = [
  () => `Grab the <span class="ic-star">✦</span> <b>stars</b> to get points`,
  () => `Dodge the <span class="ic-spike">▼</span> <b>spikes</b> at all costs!`,
  () => `Watch out for the <span class="ic-bomb">■</span> <b>bombs</b>!`,
  () => `It only gets faster from here…`,
];
function phaseFor(t) {
  const marks = [config.spikeStart, config.bombStart].sort((a, b) => a - b);
  if (t < marks[0]) return 0;
  if (t < marks[1]) return config.spikeStart <= config.bombStart ? 1 : 2;
  if (t < marks[1] + 15) return config.spikeStart <= config.bombStart ? 2 : 1;
  return 3;
}
function updatePhase() {
  const p = phaseFor(time);
  if (p === phase) return;
  if (phase !== -1) SFX.phase();
  phase = p;
  const hint = $("#hint");
  hint.innerHTML = PHASES[p]();
  hint.classList.remove("flash");
  void hint.offsetWidth;
  hint.classList.add("flash");
  announce(hint.textContent);
}

// ---------- 5. draw ----------
function draw() {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (shake > 0) ctx.translate(rand(-6, 6) * shake / 0.3, rand(-6, 6) * shake / 0.3);

  if (state !== "idle") {
    // bombs (under everything else)
    for (const b of bombs) {
      const h = b.size / 2;
      if (!b.blasted) {
        const t = b.age / b.fuse;
        if (config.showZone) {
          ctx.strokeStyle = `rgba(225,29,72,${0.15 + t * 0.35})`;
          ctx.setLineDash([4, 6]);
          ctx.strokeRect(b.x - h, b.y - h, b.size, b.size);
          ctx.setLineDash([]);
        }
        const pulse = 5 + 3 * Math.sin(b.age * (8 + t * 30));   // speeds up near the end
        ctx.fillStyle = "#e11d48";
        ctx.fillRect(b.x - pulse, b.y - pulse, pulse * 2, pulse * 2);
      } else {
        const a = 1 - b.age / 0.6;
        const grow = 0.85 + 0.15 * Math.min(1, b.age / 0.08);
        ctx.fillStyle = `rgba(160,10,50,${0.85 * a})`;
        ctx.fillRect(b.x - h * grow, b.y - h * grow, b.size * grow, b.size * grow);
      }
      if (config.hitboxes) { ctx.strokeStyle = "#22d3ee"; ctx.strokeRect(b.x - h, b.y - h, b.size, b.size); }
    }

    // spikes: gradient trail + triangle head
    for (const s of spikes) {
      const g = ctx.createLinearGradient(0, s.y - s.len, 0, s.y);
      g.addColorStop(0, "rgba(168,85,247,0)");
      g.addColorStop(1, "rgba(168,85,247,0.9)");
      ctx.fillStyle = g;
      ctx.fillRect(s.x - 1.5, s.y - s.len, 3, s.len);
      ctx.fillStyle = "#a855f7";
      ctx.beginPath();
      ctx.moveTo(s.x - 6, s.y - 4);
      ctx.lineTo(s.x + 6, s.y - 4);
      ctx.lineTo(s.x, s.y + 6);
      ctx.closePath();
      ctx.fill();
      if (config.hitboxes) circle(s.x, s.y, s.r, "#22d3ee");
    }

    // stars: four-point sparkle that scales in and slowly spins
    for (const s of stars) {
      const sc = Math.min(1, s.age / 0.2);
      sparkle(s.x, s.y, s.r * sc, s.spin + s.age * 0.8);
      if (config.hitboxes) circle(s.x, s.y, s.r, "#22d3ee");
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // crosshair (where you're aiming) …
    if (pointerInside || keys.size || state === "playing") {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(target.x, target.y, 9, 0, Math.PI * 2);
      ctx.moveTo(target.x - 14, target.y); ctx.lineTo(target.x - 5, target.y);
      ctx.moveTo(target.x + 5, target.y); ctx.lineTo(target.x + 14, target.y);
      ctx.moveTo(target.x, target.y - 14); ctx.lineTo(target.x, target.y - 5);
      ctx.moveTo(target.x, target.y + 5); ctx.lineTo(target.x, target.y + 14);
      ctx.stroke();
    }

    // … and the player dot, blinking while invincible
    const blink = invuln > 0 && Math.floor(invuln * 12) % 2 === 0;
    if (!blink) {
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (config.hitboxes) circle(player.x, player.y, player.r, "#22d3ee");
  }
  ctx.restore();
}

function sparkle(x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(255,255,255,0.7)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);                                   // point
    ctx.lineTo(Math.cos(a + Math.PI / 4) * r * 0.22, Math.sin(a + Math.PI / 4) * r * 0.22); // pinch
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function circle(x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ---------- 6. HUD + wiring ----------
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
let shown = { t: -1, lives: -1, score: -1 };
function updateHud(force = false) {
  const t = Math.floor(time);
  if (force || t !== shown.t) $("#timer").textContent = fmt(t);
  if (force || lives !== shown.lives) $("#lives").textContent = `♥ ${Math.max(0, lives)}`;
  if (force || score !== shown.score) $("#score").textContent = `✦ ${score}`;
  shown = { t, lives, score };
}
function bumpStat(id, cls) {
  const el = $(`#${id}`);
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 220);
}
function announce(msg) { $("#announce").textContent = msg; }

$("#playCard").addEventListener("click", start);
arena.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "again") { $("#overOverlay").hidden = true; start(); }
  if (action === "home") goHome();
  if (action === "resume") resume();
});
arena.tabIndex = -1;

// playground
const FORMAT = {
  follow: (v) => `${Math.round(v * 100)}%`,
  spikeStart: (v) => `${v}s`, bombStart: (v) => `${v}s`,
  spikeSpeed: (v) => `${Number(v).toFixed(1)}×`, spikeRate: (v) => `${Number(v).toFixed(1)}×`,
  bombSize: (v) => `${v}px`, fuse: (v) => `${Number(v).toFixed(1)}s`,
  ramp: (v) => (Number(v) === 0 ? "off" : `${Number(v).toFixed(1)}×`),
  volume: (v) => `${Math.round(v * 100)}%`,
};
function sync() {
  document.querySelectorAll(".panel [data-key]").forEach((input) => {
    const v = config[input.dataset.key];
    if (input.type === "checkbox") input.checked = Boolean(v);
    else if (document.activeElement !== input) input.value = v;
  });
  document.querySelectorAll(".panel [data-out]").forEach((out) => {
    const k = out.dataset.out;
    out.textContent = FORMAT[k] ? FORMAT[k](config[k]) : config[k];
  });
}
const panel = $(".panel");
panel.addEventListener("input", (e) => {
  const k = e.target.dataset.key;
  if (!k) return;
  config[k] = e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
  applySound();
  sync();
  write(STORE_KEY, config);
  if (state !== "playing") draw();
});
panel.addEventListener("click", (e) => {
  const sfx = e.target.closest("[data-sfx]")?.dataset.sfx;
  if (sfx) { synth.unlock(); SFX[sfx](sfx === "star" ? 4 : undefined); return; }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "reset") {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    applySound();
    sync();
  }
  if (action === "clearBest") {
    best = { time: 0, score: 0 };
    write(BEST_KEY, best);
    panel.querySelector(".panel-note").textContent = "Best scores cleared.";
  }
});

applySound();
sync();
resize();
