// ---------------------------------------------------------------
// 04 · ASCII pet
//
// A creature made of text lives at the bottom of a page. Feed it, pet it
// or ring a bell to wake it; every bit of care adds up, and at each
// threshold it grows into its next ASCII stage (seed → sprig → budlet →
// bloomkin → one of three final forms, picked by how you cared for it).
//
// Structure:
//   1. config + the saved creature
//   2. art: every stage is a few strings; faces are filled in per frame
//   3. sounds
//   4. grid canvas + input (tools: feed, pet, wake)
//   5. the creature: care → growth → evolution, and its little state machine
//   6. particles (food, hearts, z's, sparkles, bell rings)
//   7. draw(): everything snapped to the character grid
//   8. HUD + playground wiring
// ---------------------------------------------------------------
import { createSynth, haptic } from "../../assets/js/sound.js";

// ---------- 1. config ----------
const DEFAULTS = {
  name: "Pip",
  growth: 1,        // × how fast care turns into growth
  time: 1,          // × how fast it gets hungry and sleepy
  size: 16,         // px, text size of the grid
  pour: 14,         // crumbs per second while pouring
  look: true,       // eyes follow the cursor and the food
  bars: true,
  form: "auto",     // final form: auto (by care) or a fixed one
  sound: true,
  volume: 0.6,
};
const STORE_KEY = "lab:ascii-pet";
const PET_KEY = "lab:ascii-pet:creature";
const config = { ...DEFAULTS, ...read(STORE_KEY) };

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const petName = () => String(config.name || "").trim().slice(0, 12) || "Pip";

// ---------- 2. art ----------
// Each stage is a list of rows. Inside the rows, 1 and 2 mark the eyes and 3 the mouth:
// they're swapped for the current mood's characters every frame. `paint` gives each row
// a colour: F = flower, L = leaf/stem, B = body.
const LEAF = "#b9bd5c";
const FACE_INK = "#fffdf4";
const SPECIES = {
  seed: {
    name: "Seed",
    rows: ['  .-"-.  ', " /     \\ ", "|       |", " \\_____/ "],
    paint: "BBBB", flower: "#efe7d1", body: "#efe7d1", voice: 1.6, tuft: 3,
  },
  sprig: {
    name: "Sprig",
    rows: ["    ,    ", "  .-|-.  ", " ( 1 2 ) ", "  `-3-'  "],
    paint: "LBBB", flower: LEAF, body: "#efe7d1", voice: 1.5, tuft: 3,
  },
  budlet: {
    name: "Budlet",
    rows: ["   \\v/   ", "  .-|-.  ", " ( 1 2 ) ", " /`-3-'\\ ", '   " "   '],
    paint: "FBBBB", flower: "#f2a7b8", body: "#efe7d1", voice: 1.3, tuft: 5,
  },
  bloomkin: {
    name: "Bloomkin",
    rows: ["   vVVVv   ", "   (___)   ", "  .-~Y~-.  ", " ( 1   2 ) ", " (   3   ) ", "  `-\"-\"-'  "],
    paint: "FFLBBB", flower: "#e9a23b", body: "#efe7d1", voice: 1.12, tuft: 5,
  },
  // final forms: the care you gave most decides which one hatches out of a Bloomkin
  plumbloom: {
    name: "Plumbloom", care: "fed",
    rows: [" (@)     (@) ", "  \\Y\\   /Y/  ", " .-~~~~~~~-. ", "(   1   2   )", "(     3     )", " `-._____.-' ", '   ""   ""   '],
    paint: "FLBBBBB", flower: "#e5484d", body: "#f3d9cc", voice: 0.9, tuft: 7,
  },
  heartbloom: {
    name: "Heartbloom", care: "love",
    rows: ["  <3 vVv <3  ", "    (___)    ", " .-~~~Y~~~-. ", "(   1   2   )", "(  ,  3  ,  )", " `-._____.-' ", '   ""   ""   '],
    paint: "FFLBBBB", flower: "#ff7aa8", body: "#f7e3ea", voice: 0.95, tuft: 7,
  },
  starbloom: {
    name: "Starbloom", care: "play",
    rows: ["  *  (o)  *  ", "   `.\\|/.'   ", " .-~~~~~~~-. ", "(   1   2   )", "(     3     )", " `-._____.-' ", "   /\\   /\\   "],
    paint: "FLBBBBB", flower: "#8cc8ff", body: "#e3edfb", voice: 1, tuft: 7,
  },
};
for (const sp of Object.values(SPECIES)) sp.w = Math.max(...sp.rows.map((r) => r.length));

const STAGES = ["seed", "sprig", "budlet", "bloomkin"];          // then a final form
const FINALS = { love: "heartbloom", fed: "plumbloom", play: "starbloom" };
const NEED = [6, 20, 44, 80];   // total care needed to leave each stage
const need = (stage) => Math.max(1, Math.round(NEED[stage] / config.growth));

// [left eye, right eye, mouth]
const FACES = {
  idle: ["o", "o", "-"], blink: ["-", "-", "-"], happy: ["^", "^", "w"],
  eat1: [">", "<", "o"], eat2: [">", "<", "-"], sleep: ["-", "-", "."], dream: ["-", "-", "w"],
  surprised: ["O", "O", "o"], grumpy: ["-", "-", "~"], hungry: ["o", "o", "n"], tired: ["_", "_", "."],
};

// The cursor tools, drawn in the same font and tilted with the canvas.
const TOOL_ART = {
  feed: ["  .---.", " /o . o\\", " \\_____/"],
  pet: [" .-.-.-.", " | | | |-.", " |      _)", "  \\____/"],
  wake: ["   _", "  ( )", " /   \\", "/_____\\", "   o"],
};

// ---------- 3. sounds ----------
const synth = createSynth({ reverb: 1.4, wet: 0.18 });
const voice = () => SPECIES[kindNow()].voice;
const SFX = {
  drop() { synth.tone({ freq: rand(2200, 3400), type: "sine", dur: 0.03, gain: 0.035 }); },
  nom() {
    const p = voice();
    for (const d of [0, 0.15]) {
      synth.noise({ dur: 0.07, freq: 900, to: 300, gain: 0.22, delay: d });
      synth.tone({ freq: 330 * p, to: 220 * p, type: "triangle", dur: 0.09, gain: 0.12, delay: d + 0.02 });
    }
  },
  purr() {
    synth.noise({ dur: 0.2, freq: 240, to: 140, gain: 0.2 });
    synth.tone({ freq: 62, type: "sine", dur: 0.2, gain: 0.1 });
    synth.tone({ freq: 1100 * voice(), to: 1500 * voice(), type: "sine", dur: 0.1, gain: 0.05, delay: 0.05 });
  },
  bell() {
    // a small hand bell: a few inharmonic partials, the high ones dying first
    [1, 2.76, 5.4].forEach((m, i) => synth.tone({ freq: 1180 * m, type: "sine", dur: 1.3 / (i + 1), gain: 0.16 / (i + 1) }));
    synth.tone({ freq: 1186, type: "sine", dur: 0.9, gain: 0.06, delay: 0.22 });
  },
  startle() { synth.tone({ freq: 500 * voice(), to: 1250 * voice(), type: "square", dur: 0.09, gain: 0.05 }); },
  chirp() {
    const p = voice();
    synth.tone({ freq: 880 * p, to: 1320 * p, type: "triangle", dur: 0.1, gain: 0.12 });
    synth.tone({ freq: 1320 * p, to: 1760 * p, type: "triangle", dur: 0.1, gain: 0.1, delay: 0.1 });
  },
  snore() { synth.noise({ dur: 1.5, freq: 260, to: 150, gain: 0.07, attack: 0.6 }); },
  grumble() { synth.tone({ freq: 210 * voice(), to: 150 * voice(), type: "sawtooth", dur: 0.28, gain: 0.04 }); },
  hungry() { synth.tone({ freq: 640 * voice(), to: 500 * voice(), type: "sine", dur: 0.22, gain: 0.06 }); },
  crack() { synth.noise({ dur: 0.05, freq: 3000, filter: "highpass", gain: 0.25 }); },
  evolve(stage = 2) {
    // a rising pentatonic run; later stages get a longer one
    const notes = [523, 587, 659, 784, 880, 1047, 1175, 1319];
    const n = 3 + Math.min(stage, 4);
    for (let i = 0; i < n; i++) synth.tone({ freq: notes[i], type: "triangle", dur: 0.22, gain: 0.12, delay: i * 0.09 });
    synth.noise({ dur: 0.9, freq: 5000, to: 9000, filter: "highpass", gain: 0.05, attack: 0.3 });
  },
};
function applySound() { synth.set({ enabled: config.sound, volume: config.volume }); }

// ---------- 4. grid canvas + input ----------
const $ = (s) => document.querySelector(s);
const arena = $("#arena");
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let W = 0, H = 0, dpr = 1;
let font = "", fs = 16, cw = 10, ch = 20, cols = 60, rowsN = 24, groundRow = 22, offX = 0;
let ground = [];   // [{col, ch}] dirt and grass along the ground row
let decor = [];    // little garden sprouts at the edges, a nod to the original

function resize() {
  const r = arena.getBoundingClientRect();
  W = r.width; H = r.height;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  fs = Math.round(clamp(Math.min(config.size, W / 30), 10, 26));
  font = `500 ${fs}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  ctx.font = font;
  cw = ctx.measureText("M").width;
  ch = Math.round(fs * 1.3);
  cols = Math.floor(W / cw);
  rowsN = Math.floor(H / ch);
  groundRow = rowsN - 2;
  offX = (W - cols * cw) / 2;
  buildGround();
  pet.x = clamp(pet.x || cols * 0.62, 6, cols - 6);
}

// Seeded random so the ground looks the same every visit.
function buildGround() {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ground = [];
  for (let c = 0; c < cols; c++) {
    const v = r();
    if (v < 0.05) ground.push({ col: c, ch: "^" });
    else if (v < 0.12) ground.push({ col: c, ch: pick2(r, [".", ",", "'", "_"]) });
  }
  decor = [
    { col: 3, bloom: "v", color: "#e5484d" },
    { col: 8, bloom: "w", color: "#f2f1ea" },
    { col: cols - 5, bloom: "v", color: "#ff7aa8" },
  ].filter((d) => cols > 40 || d.col < 5);
}
function pick2(r, list) { return list[Math.floor(r() * list.length)]; }

const pointer = { x: 0, y: 0, inside: false, down: false, speed: 0, type: "mouse", lastT: 0 };
let tool = "feed";
let toolAngle = -0.2;
let bellT = 9;      // seconds since the bell was rung (drives its swing)
let pourAcc = 0;

function toCol(x) { return (x - offX) / cw; }

canvas.addEventListener("pointermove", (e) => {
  const x = e.offsetX, y = e.offsetY;
  const now = performance.now();
  const dist = pointer.inside ? Math.hypot(x - pointer.x, y - pointer.y) : 0;   // no jump when the cursor arrives
  const dt = Math.max(1, now - pointer.lastT) / 1000;
  pointer.speed += (Math.min(4000, dist / dt) - pointer.speed) * 0.35;
  pointer.lastT = now;
  pointer.type = e.pointerType;
  if (e.pointerType !== "touch" || pointer.down) pointer.inside = true;
  if (tool === "pet" && pointer.inside && overPet(x, y)) rub(dist);
  pointer.x = x; pointer.y = y;
});
canvas.addEventListener("pointerdown", (e) => {
  synth.unlock();
  canvas.setPointerCapture?.(e.pointerId);
  pointer.x = e.offsetX; pointer.y = e.offsetY;
  pointer.type = e.pointerType;
  pointer.inside = true;
  pointer.down = true;
  pointer.lastT = performance.now();
  if (tool === "wake") ring(pointer.x, pointer.y);
  e.preventDefault();
});
const release = (e) => {
  pointer.down = false;
  if (e.pointerType === "touch" || e.type === "pointerleave" || e.type === "pointercancel") pointer.inside = false;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", release);

function setTool(name) {
  tool = name;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === name)));
}
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => { synth.unlock(); setTool(b.dataset.tool); }));

// Keyboard: 1/2/3 pick a tool, Space or Enter uses it on the pet.
arena.addEventListener("keydown", (e) => {
  const map = { 1: "feed", 2: "pet", 3: "wake" };
  if (map[e.key]) { setTool(map[e.key]); return; }
  if (e.key === " " || e.key === "Enter") {
    if (e.target.closest("button")) return;
    e.preventDefault();
    synth.unlock();
    useToolOnPet();
  }
});
function useToolOnPet() {
  const box = petBox();
  const cx = box.x + box.w / 2;
  if (tool === "feed") for (let i = 0; i < 4; i++) spawnCrumb(cx + rand(-2.5, 2.5) * cw, box.y - ch * 3, rand(-15, 15));
  if (tool === "pet") { petTick(); petTick(); }
  if (tool === "wake") ring(cx, box.y - ch * 2);
}

// ---------- 5. the creature ----------
function freshPet() {
  return { stage: 0, xp: 0, care: { fed: 0, love: 0, play: 0 }, form: null, full: 0.7, energy: 1, asleep: false };
}
const saved = read(PET_KEY);
const pet = {
  ...freshPet(), ...saved, care: { ...freshPet().care, ...(saved.care || {}) },
  x: 0, action: "idle", actionT: 0, target: null, look: 0,
  blinkT: 3, blink: 0, petGlow: 0, wobble: 0, mood: null, moodT: 0, idleT: 0,
  petBudget: 6, ringCool: 0, rub: 0, bubble: null, hungryT: 4, fullSaidAt: -99, zT: 0, snoreT: 1,
  from: null, toStage: 0,
};
if (saved.savedAt) {
  // it got a little hungry while you were away (gently: it never gets sick or runs away)
  const away = Math.min((Date.now() - saved.savedAt) / 1000, 900);
  pet.full = clamp(pet.full - (away * config.time) / 300, 0.1, 1);
}
if (saved.asleep && pet.stage > 0) pet.action = "sleep";
if (pet.stage >= 4 && !pet.form) pet.form = chooseForm();

function kindNow() { return kindOf(pet.stage, pet.form); }
function kindOf(stage, form) { return stage < 4 ? STAGES[stage] : form || "heartbloom"; }

function chooseForm() {
  if (config.form !== "auto" && SPECIES[config.form]) return config.form;
  const c = pet.care;
  const best = ["love", "fed", "play"].reduce((a, k) => (c[k] > c[a] ? k : a), "love");
  return FINALS[best];
}

function setAction(a) {
  if (pet.action !== a) { pet.action = a; pet.actionT = 0; }
}
function say(text, life = 1.8) { pet.bubble = { text, age: 0, life }; }
function announce(text) { $("#announce").textContent = text; }

// The frame as rows of {ch, color} cells, with the face filled in.
function cellsFor(kind, faceName, look = 0) {
  const sp = SPECIES[kind];
  const rows = kind === "seed" ? seedRows(pet.xp / need(0)) : sp.rows;
  const face = FACES[faceName] || FACES.idle;
  const flower = sp.flower, body = sp.body;
  return rows.map((row, r) => {
    const chars = [...row.padEnd(sp.w)];
    const e1 = chars.indexOf("1"), e2 = chars.indexOf("2"), m = chars.indexOf("3");
    const color = { F: flower, L: LEAF, B: body }[sp.paint[r]] || body;
    const cells = chars.map((c) => ({ ch: c, color }));
    for (const i of [e1, e2, m]) if (i >= 0) cells[i] = { ch: " ", color };
    if (e1 >= 0) cells[e1 + look] = { ch: face[0], color: FACE_INK };
    if (e2 >= 0) cells[e2 + look] = { ch: face[1], color: FACE_INK };
    if (m >= 0) cells[m] = { ch: face[2], color: FACE_INK };
    return cells;
  });
}

// The egg cracks a little more with every bit of care.
function seedRows(p) {
  const a = SPECIES.seed.rows.map((s) => [...s]);
  if (p > 0.25) a[2][3] = "/";
  if (p > 0.45) a[2][4] = "\\";
  if (p > 0.6) a[2][5] = "/";
  if (p > 0.8) a[1][5] = "'";
  return a.map((x) => x.join(""));
}

function faceNow() {
  const a = pet.action;
  if (a === "evolve" || a === "dance") return "happy";
  if (a === "sleep") return pet.petGlow > 0 ? "dream" : "sleep";
  if (a === "surprised") return pet.energy < 0.3 ? "grumpy" : "surprised";
  if (a === "eat") return pet.actionT % 0.24 < 0.12 ? "eat1" : "eat2";
  if (pet.petGlow > 0) return "happy";
  if (pet.mood) return pet.mood;
  if (pet.blink > 0) return "blink";
  if (pet.full < 0.3) return "hungry";
  if (pet.energy < 0.25) return "tired";
  return "idle";
}

function hopNow() {
  if (pet.stage === 0 || reducedMotion.matches) return 0;
  if (pet.action === "walk") return Math.floor(clock / 0.2) % 2;
  if (pet.action === "dance") return Math.floor(pet.actionT / 0.18) % 2;
  if (pet.action === "surprised") return pet.actionT < 0.35 ? 1 : 0;
  return 0;
}

// Where the creature is on screen, in pixels (for petting and for spawning effects).
function petBox() {
  const sp = SPECIES[kindNow()];
  const h = sp.rows.length;
  const col0 = Math.round(pet.x - sp.w / 2);
  const bottom = groundRow - 1 - hopNow();
  return { x: offX + col0 * cw, y: (bottom - h + 1) * ch, w: sp.w * cw, h: h * ch, col0, top: bottom - h + 1, bottom };
}
function overPet(x, y) {
  const b = petBox();
  return x > b.x - cw && x < b.x + b.w + cw && y > b.y - ch * 0.5 && y < b.y + b.h + ch * 0.5;
}

const EVOLVE_TIME = 1.8;
function startEvolve(next) {
  pet.from = cellsFor(kindNow(), "happy");
  pet.toStage = next;
  if (next >= 4) pet.form = chooseForm();
  if (pet.stage === 0) SFX.crack();
  setAction("evolve");
  pet.target = null;
  SFX.evolve(next);
  haptic(12);
  burst(14);
}
function finishEvolve() {
  pet.stage = pet.toStage;
  pet.from = null;
  setAction("idle");
  const name = SPECIES[kindNow()].name;
  say(pet.stage === 1 ? "hello!" : "!");
  SFX.chirp();
  burst(8);
  announce(`${petName()} ${pet.stage === 1 ? "hatched into" : "grew into"} a ${name}!`);
  save();
}

function petTick() {
  pet.idleT = 0;
  pet.petGlow = 0.7;
  spawnHeart();
  SFX.purr();
  if (pet.stage === 0) pet.wobble = 1;
  // a budget stops frantic rubbing from skipping a stage in two seconds
  if (pet.petBudget >= 1 && pet.action !== "evolve") {
    pet.petBudget -= 1;
    pet.xp += 1;
    pet.care.love += 1;
  }
  if (pet.action === "walk" || pet.action === "idle") { pet.target = null; setAction("idle"); }
}
function rub(dist) {
  pet.rub += dist;
  while (pet.rub >= 70) { pet.rub -= 70; petTick(); }
  pet.petGlow = Math.max(pet.petGlow, 0.25);
}

function ring(x, y) {
  bellT = 0;
  SFX.bell();
  haptic(10);
  for (const [vx, d] of [[-1, 0], [1, 0], [-1, 0.12], [1, 0.12]]) {
    spawn({ x: x + vx * 2 * cw, y, vx: vx * 110, ch: d ? (vx < 0 ? "((" : "))") : vx < 0 ? "(" : ")", color: "#d9d4bf", life: 0.5, delay: d });
  }
  pet.idleT = 0;
  if (pet.ringCool > 0 || pet.action === "evolve") return;
  pet.ringCool = 0.7;
  if (pet.stage === 0) { pet.wobble = 1; pet.xp += 1; pet.care.play += 1; return; }
  if (pet.action === "sleep") {
    setAction("surprised");
    SFX.startle();
    if (pet.energy < 0.3) say("5 more min...", 2.2);
    else { say("!"); pet.xp += 2; pet.care.play += 1; }
    return;
  }
  if (pet.energy < 0.25) { say("tired..."); pet.mood = "tired"; pet.moodT = 1.5; SFX.grumble(); return; }
  setAction("dance");
  pet.target = null;
  pet.energy = Math.max(0, pet.energy - 0.05);
  pet.xp += 1;
  pet.care.play += 1;
  SFX.chirp();
  say(pick(["yay!", "hi!", "!!", "again!"]));
}

function fallAsleep() {
  setAction("sleep");
  pet.target = null;
  pet.zT = 0.4;
  pet.snoreT = 1.5;
  pet.idleT = 0;
  say("zz...", 1.4);
}

function eat(crumb) {
  crumbs.splice(crumbs.indexOf(crumb), 1);
  if (pet.full < 0.95) { pet.xp += 1; pet.care.fed += 1; }
  pet.full = Math.min(1, pet.full + 0.12);
  setAction("eat");
  SFX.nom();
  if (Math.random() < 0.35) say(pick(["nom", "mm!", "*munch*"]), 1.1);
}

let clock = 0;
function updatePet(dt) {
  const T = config.time;
  pet.actionT += dt;
  pet.idleT += dt;
  pet.petGlow = Math.max(0, pet.petGlow - dt);
  pet.wobble *= Math.pow(0.03, dt);
  pet.ringCool -= dt;
  pet.petBudget = Math.min(6, pet.petBudget + dt / 1.5);
  if (pet.moodT > 0 && (pet.moodT -= dt) <= 0) pet.mood = null;
  if (pet.bubble && (pet.bubble.age += dt) > pet.bubble.life) pet.bubble = null;
  if ((pet.blinkT -= dt) <= 0) { pet.blink = 0.13; pet.blinkT = rand(2.5, 5.5); }
  pet.blink = Math.max(0, pet.blink - dt);

  if (pet.action === "evolve") {
    if (Math.random() < dt * 14) burst(1);
    if (pet.actionT >= (reducedMotion.matches ? 0.3 : EVOLVE_TIME)) finishEvolve();
    return;
  }
  if (pet.stage === 0) {
    if (pet.xp >= need(0)) startEvolve(1);
    return;
  }

  const asleep = pet.action === "sleep";
  pet.full = clamp(pet.full - (dt * T) / (asleep ? 220 : 110), 0, 1);
  pet.energy = clamp(pet.energy + (asleep ? (dt * T) / 18 : -(dt * T) / 140), 0, 1);

  switch (pet.action) {
    case "sleep":
      if ((pet.zT -= dt) <= 0) { pet.zT = 1.3; spawnZ(); }
      if ((pet.snoreT -= dt) <= 0) { pet.snoreT = 3.4; SFX.snore(); }
      if (pet.energy >= 1 && pet.actionT > 8) { setAction("idle"); say("*yawn*"); }
      return;
    case "surprised":
      if (pet.actionT > 0.8) {
        if (pet.energy < 0.3) { setAction("sleep"); SFX.grumble(); }
        else setAction("dance");
      }
      return;
    case "dance":
      if (pet.actionT > 1.4) setAction("idle");
      return;
    case "eat":
      if (pet.actionT > 0.55) setAction("idle");
      return;
  }

  // idle or walking
  if (pet.stage < 4 && pet.xp >= need(pet.stage)) { startEvolve(pet.stage + 1); return; }
  if (pet.energy < 0.12 || pet.idleT > 50 / T) { fallAsleep(); return; }

  const food = pet.full < 0.95 ? nearestCrumb() : null;
  if (food) pet.target = toCol(food.x);
  else if (pet.full >= 0.95 && crumbs.some((c) => c.landed) && clock - pet.fullSaidAt > 7) {
    pet.fullSaidAt = clock;
    say("full!");
  } else if (pet.action === "idle" && pet.target == null && Math.random() < dt * 0.22) {
    pet.target = clamp(pet.x + rand(-12, 12), 6, cols - 6);
  }

  if (pet.target != null) {
    const half = SPECIES[kindNow()].w / 2;
    pet.target = clamp(pet.target, half, cols - half);
    const d = pet.target - pet.x;
    if (Math.abs(d) < 0.6) {
      pet.target = null;
      setAction("idle");
      if (food && Math.abs(toCol(food.x) - pet.x) < 1.5) eat(food);
    } else {
      setAction("walk");
      const speed = pet.full < 0.3 ? 7 : 5;   // hungry = hurries to the food
      pet.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    }
  }

  if (pet.full < 0.3 && (pet.hungryT -= dt) <= 0) { pet.hungryT = 9; say("hungry..."); SFX.hungry(); }
}

function nearestCrumb() {
  let best = null, bd = Infinity;
  for (const c of crumbs) {
    if (!c.landed) continue;
    const d = Math.abs(toCol(c.x) - pet.x);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---------- 6. particles ----------
const crumbs = [];   // food: falls with gravity, then sits on the ground until eaten
const parts = [];    // hearts, z's, sparkles, bell rings: drift and fade
const BERRIES = ["#e5484d", "#f08c3a", "#b07cf0", "#e9c46a"];
let lastDrop = 0;

function spawnCrumb(x, y, vx = rand(-25, 10)) {
  pet.idleT = 0;
  if (crumbs.length > 90) {
    const i = crumbs.findIndex((c) => c.landed);
    crumbs.splice(i >= 0 ? i : 0, 1);
  }
  crumbs.push({ x, y, vx, vy: rand(10, 60), ch: pick(["o", "o", "°", "."]), color: pick(BERRIES), landed: false, age: 0 });
}
function spawn(p) {
  if (parts.length > 300) return;
  parts.push({ vx: 0, vy: 0, delay: 0, age: 0, ...p });
}
function spawnHeart() {
  const b = petBox();
  spawn({ x: b.x + b.w / 2 + rand(-1.5, 1.5) * cw, y: b.y - ch * 0.5, vx: rand(-14, 14), vy: -46, ch: "<3", color: "#ff7aa8", life: 1.3 });
}
function spawnZ() {
  const b = petBox();
  spawn({ x: b.x + b.w * 0.75, y: b.y - ch * 0.3, vx: 16, vy: -22, ch: "z", grow: "Z", color: "#9fb3d9", life: 2.5 });
}
function burst(n) {
  if (reducedMotion.matches) n = Math.min(n, 2);
  const b = petBox();
  const color = SPECIES[kindOf(pet.toStage || pet.stage, pet.form)].flower;
  for (let i = 0; i < n; i++) {
    spawn({
      x: b.x + rand(-1, 1) * cw + Math.random() * (b.w + 2 * cw), y: b.y + Math.random() * b.h,
      vx: rand(-30, 30), vy: rand(-60, -10), ch: "+", sparkle: true,
      color: Math.random() < 0.5 ? color : "#fffdf4", life: rand(0.6, 1.1),
    });
  }
}

function updateParticles(dt) {
  const restY = (groundRow - 1) * ch;
  const egg = pet.stage === 0 ? petBox() : null;
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i];
    c.age += dt;
    if (!c.landed) {
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      // food bounces off the egg: it can't eat yet
      if (egg && c.vy > 0 && c.x > egg.x && c.x < egg.x + egg.w && c.y > egg.y && c.y < egg.y + ch) {
        c.vy *= -0.35;
        c.vx += (c.x < egg.x + egg.w / 2 ? -1 : 1) * 70;
        pet.wobble = Math.max(pet.wobble, 0.4);
      }
      if (c.y >= restY) {
        c.y = restY;
        c.landed = true;
        c.x = freeCell(c.x);
        c.age = 0;
        if (clock - lastDrop > 0.04) { lastDrop = clock; SFX.drop(); }
      }
    }
    if (c.x < offX || c.x > W - offX || (c.landed && c.age > 40)) crumbs.splice(i, 1);
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.age >= p.life) parts.splice(i, 1);
  }
}

// Berries on the ground spread out to the nearest empty cell instead of stacking in one.
function freeCell(x) {
  const col = Math.round(toCol(x));
  const taken = new Set(crumbs.filter((c) => c.landed).map((c) => Math.round(toCol(c.x))));
  for (let d = 0; d < 12; d++) {
    for (const s of d ? [d, -d] : [0]) {
      const c = col + s;
      if (c > 0 && c < cols - 1 && !taken.has(c)) return offX + c * cw;
    }
  }
  return x;
}

function updateTool(dt) {
  bellT += dt;
  pointer.speed *= Math.pow(0.02, dt);
  let target = -0.15;
  if (tool === "feed" && pointer.inside) {
    const pouring = pointer.down || pointer.speed > 900;   // hold to pour, or shake the bag
    target = pouring ? -0.95 : -0.15;
    if (pouring && toolAngle < -0.6) {
      pourAcc += dt * config.pour;
      while (pourAcc >= 1) {
        pourAcc -= 1;
        // the spout is the bag's left corner, wherever the tilt has put it
        const lx = -3.6 * cw, ly = -0.2 * ch;
        const sx = pointer.x + lx * Math.cos(toolAngle) - ly * Math.sin(toolAngle);
        const sy = pointer.y + lx * Math.sin(toolAngle) + ly * Math.cos(toolAngle);
        spawnCrumb(sx + rand(-3, 3), sy);
      }
    }
  }
  if (tool === "pet") target = Math.sin(clock * 18) * 0.2 * Math.min(1, pointer.speed / 500);
  if (tool === "wake") target = Math.sin(bellT * 22) * 0.55 * Math.exp(-bellT * 4);
  toolAngle += (target - toolAngle) * (1 - Math.pow(0.0001, dt));
}

// ---------- 7. draw ----------
function put(col, row, text, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, offX + col * cw, row * ch);
}

const GLYPHS = "*+:.~%#";
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = font;
  ctx.textBaseline = "top";

  // ground + the garden sprouts at the edges
  for (const g of ground) put(g.col, groundRow, g.ch, "#5e5c33");
  for (const d of decor) {
    put(d.col, groundRow - 2, d.bloom, d.color);
    put(d.col, groundRow - 1, "|", LEAF);
    put(d.col - 1, groundRow, "^^^", LEAF);
  }

  // food
  for (const c of crumbs) {
    const a = c.landed && c.age > 36 ? (40 - c.age) / 4 : 1;
    put(Math.round(toCol(c.x)), Math.round(c.y / ch), c.ch, c.color, a);
  }

  // the creature, its grass tuft (wider as it grows, like the flowers), and evolution
  const b = petBox();
  const sp = SPECIES[kindNow()];
  const kind = pet.action === "evolve" ? kindOf(pet.toStage, pet.form) : kindNow();
  const tw = Math.max(sp.tuft, SPECIES[kind].tuft);
  put(Math.round(pet.x - tw / 2), groundRow, "^".repeat(tw), LEAF);
  const wob = pet.stage === 0 && !reducedMotion.matches ? Math.round(Math.sin(clock * 28) * pet.wobble) : 0;
  const look = config.look ? lookNow() : 0;
  let cells = cellsFor(kindNow(), faceNow(), look);
  if (pet.action === "evolve" && pet.from) cells = scramble(pet.from, cellsFor(kind, "happy"), pet.actionT / EVOLVE_TIME);
  const h = cells.length;
  const w = Math.max(...cells.map((r) => r.length));
  const col0 = Math.round(pet.x - w / 2) + wob;
  cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.ch !== " ") put(col0 + c, b.bottom - h + 1 + r, cell.ch, cell.color);
  }));

  // particles
  for (const p of parts) {
    if (p.delay > 0) continue;
    const t = p.age / p.life;
    let text = p.ch;
    if (p.grow && t > 0.45) text = p.grow;
    if (p.sparkle) text = t < 0.35 ? "+" : t < 0.7 ? "*" : ".";
    put(Math.round(toCol(p.x)), Math.round(p.y / ch), text, p.color, t > 0.7 ? (1 - t) / 0.3 : 1);
  }

  // speech bubble, typed out
  if (pet.bubble) {
    const { text, age, life } = pet.bubble;
    const shown = text.slice(0, Math.floor(age * 28) + 1);
    const a = age > life - 0.3 ? (life - age) / 0.3 : 1;
    put(Math.round(pet.x - text.length / 2), b.bottom - h - 1, shown, "#d9d4bf", Math.max(0, a));
  }

  // the tool under the cursor
  if (pointer.inside) {
    const art = TOOL_ART[tool];
    const tw2 = Math.max(...art.map((l) => l.length));
    ctx.save();
    ctx.translate(pointer.x, pointer.y);
    ctx.rotate(toolAngle);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f6f3ea";
    art.forEach((line, i) => ctx.fillText(line, (-tw2 * cw) / 2, (i - art.length / 2) * ch));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function lookNow() {
  if (pet.stage === 0 || pet.action === "sleep" || pet.action === "evolve") return 0;
  const tx = pet.target ?? (pointer.inside ? toCol(pointer.x) : null);
  if (tx == null) return 0;
  const d = tx - pet.x;
  return Math.abs(d) < 2 ? 0 : Math.sign(d);
}

// Old frame dissolves into random glyphs, the new one types itself in out of them.
function scramble(from, to, p) {
  if (reducedMotion.matches) return p < 0.5 ? from : to;
  const h = Math.max(from.length, to.length);
  const w = Math.max(...from.map((r) => r.length), ...to.map((r) => r.length));
  const at = (rows, r, c) => {
    const rr = r - (h - rows.length);                    // align bottoms
    const cc = c - Math.floor((w - (rows[0]?.length || 0)) / 2); // and centres
    return rows[rr]?.[cc] || { ch: " ", color: "#fff" };
  };
  const out = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) {
      const a = at(from, r, c), b = at(to, r, c);
      const k = ((r * 73 + c * 151) % 97) / 97;           // a fixed random order per cell
      const filled = a.ch !== " " || b.ch !== " ";
      const glyph = { ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], color: b.color };
      if (p < 0.5) row.push(k > p * 2 ? a : filled ? glyph : a);
      else row.push(k < (p - 0.5) * 2 ? b : filled ? glyph : b);
    }
    out.push(row);
  }
  return out;
}

// ---------- 8. loop, HUD + playground ----------
let last = performance.now();
let running = false;
let visible = true;
let hudT = 0, saveT = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  updateTool(dt);
  updatePet(dt);
  updateParticles(dt);
  draw();
  if ((hudT -= dt) <= 0) { hudT = 0.25; hud(); }
  if ((saveT -= dt) <= 0) { saveT = 3; save(); }
  if (visible && !document.hidden) requestAnimationFrame(frame);
  else running = false;
}
function kick() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(arena);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); else kick(); });
window.addEventListener("pagehide", save);
new ResizeObserver(() => resize()).observe(arena);

function save() {
  write(PET_KEY, {
    stage: pet.stage, xp: pet.xp, care: pet.care, form: pet.form,
    full: pet.full, energy: pet.energy, asleep: pet.action === "sleep", savedAt: Date.now(),
  });
}

const bar = (v) => `[${"#".repeat(Math.round(v * 10))}${"-".repeat(10 - Math.round(v * 10))}]`;
function hud() {
  const kind = kindNow();
  $("#petName").textContent = petName();
  $("#petStage").textContent = `${SPECIES[kind].name} · stage ${pet.stage + 1} of 5`;
  const prev = pet.stage > 0 ? need(pet.stage - 1) : 0;
  const grow = pet.stage >= 4 ? 1 : clamp((pet.xp - prev) / (need(pet.stage) - prev), 0, 1);
  const bars = $("#bars");
  bars.hidden = !config.bars;
  bars.textContent = pet.stage === 0
    ? `warm ${bar(grow)}`
    : `food ${bar(pet.full)}\nrest ${bar(pet.energy)}\ngrow ${bar(grow)}`;
  $("#hint").textContent = hintText(kind);
}
function hintText(kind) {
  const n = petName();
  if (pet.action === "evolve") return `${n} is changing…`;
  if (pet.stage === 0) return "An egg. Pet it to keep it warm, or ring the bell to rock it.";
  if (pet.action === "sleep") return `Shh, ${n} is asleep. Pet it gently, or ring the bell to wake it.`;
  if (pet.full < 0.3) return `${n} is hungry. Pick feed, then hold (or shake) to pour.`;
  if (pet.energy < 0.25) return `${n} is getting sleepy.`;
  if (pet.stage >= 4) return `${n} is fully grown: a ${SPECIES[kind].name}. Start a new egg from the panel.`;
  return `Feed, pet or play with ${n} to help it grow.`;
}

const FORMAT = {
  growth: (v) => `${Number(v).toFixed(1)}×`,
  time: (v) => `${Number(v).toFixed(2)}×`,
  size: (v) => `${v}px`,
  pour: (v) => `${v}/s`,
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
  const t = e.target;
  config[k] = t.type === "checkbox" ? t.checked : t.type === "range" ? Number(t.value) : t.value;
  if (k === "size") resize();
  if (k === "form" && pet.stage >= 4 && pet.action !== "evolve") {
    // re-bloom into the chosen form right away
    pet.from = cellsFor(kindNow(), "happy");
    pet.toStage = 4;
    pet.form = chooseForm();
    setAction("evolve");
    SFX.evolve(4);
  }
  applySound();
  sync();
  hud();
  write(STORE_KEY, config);
});
panel.addEventListener("click", (e) => {
  const sfx = e.target.closest("[data-sfx]")?.dataset.sfx;
  if (sfx) { synth.unlock(); SFX[sfx](4); return; }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  synth.unlock();
  if (action === "skip" && pet.stage < 4 && pet.action !== "evolve") {
    pet.xp = Math.max(pet.xp, need(pet.stage));
    if (pet.action === "sleep") setAction("idle");
  }
  if (action === "sleepy" && pet.stage > 0) { pet.energy = 0.1; pet.idleT = 99; }
  if (action === "hungry" && pet.stage > 0) { pet.full = 0.2; pet.hungryT = 0; }
  if (action === "newEgg") {
    Object.assign(pet, freshPet(), { action: "idle", actionT: 0, target: null, from: null, bubble: null, idleT: 0 });
    crumbs.length = 0;
    parts.length = 0;
    announce("A new egg.");
    save();
  }
  if (action === "reset") {
    Object.assign(config, DEFAULTS);
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    applySound();
    resize();
    sync();
  }
  hud();
});

applySound();
sync();
setTool("feed");
resize();
hud();
// The grid is measured in the page's mono font, so measure again once it has loaded.
document.fonts?.ready.then(resize);
kick();
