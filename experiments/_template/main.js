// ---------------------------------------------------------------
// Template experiment: "Ripples".
// Copy this folder, keep the wiring at the bottom, replace the piece.
// ---------------------------------------------------------------
import { createStage, rand } from "../../assets/js/stage.js";
import { createSynth } from "../../assets/js/sound.js";

// ---------- config (the Tune panel edits these) ----------
const DEFAULTS = { speed: 140, life: 2.4, rain: true, volume: 0.5 };
const STORE_KEY = "exp:template";
const config = { ...DEFAULTS, ...read() };
function read() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* ignore */ } }

// ---------- stage + sound ----------
const stage = createStage(document.getElementById("stage"));
const synth = createSynth({ volume: config.volume });

// A pentatonic scale can't sound "wrong", whatever order notes come in.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
function pluck(x, y) {
  // left → right = low → high, top → bottom = louder → softer
  const step = SCALE[Math.floor((x / stage.W) * SCALE.length)] ?? 0;
  const freq = 220 * Math.pow(2, step / 12);
  const gain = 0.12 + 0.2 * (1 - y / stage.H);
  synth.tone({ freq, type: "sine", dur: 1.2, gain, attack: 0.004 });
  synth.tone({ freq: freq * 2, type: "triangle", dur: 0.3, gain: gain * 0.25 });
}

// ---------- the piece ----------
let ripples = [];
let rainTimer = 0;
let lastDrop = 0;

function drop(x, y, strength = 1) {
  ripples.push({ x, y, age: 0, strength });
  pluck(x, y);
}

stage.onDown = (p) => { synth.unlock(); drop(p.x, p.y, 1); };

stage.loop((dt, t) => {
  const { ctx, W, H, pointer } = stage;

  // dragging leaves a trail of smaller drops
  if (pointer.down && t - lastDrop > 0.09 && Math.hypot(pointer.vx, pointer.vy) > 60) {
    lastDrop = t;
    drop(pointer.x, pointer.y, 0.6);
  }

  // ambient rain (silent until the first tap unlocks audio)
  rainTimer -= dt;
  if (config.rain && rainTimer <= 0) {
    rainTimer = rand(0.5, 1.6);
    ripples.push({ x: rand(W), y: rand(H), age: 0, strength: 0.4 });
  }

  for (const r of ripples) r.age += dt;
  ripples = ripples.filter((r) => r.age < config.life);

  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for (const r of ripples) {
    const k = r.age / config.life;               // 0 → 1 over its life
    const a = (1 - k) * (1 - k) * r.strength;    // fade out, faster at the end
    for (let ring = 0; ring < 3; ring++) {
      const rad = Math.max(0, r.age * config.speed - ring * 14);
      ctx.strokeStyle = `rgba(190, 220, 255, ${a * (1 - ring * 0.3)})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rad, rad * 0.45, 0, 0, Math.PI * 2);   // squashed = perspective
      ctx.stroke();
    }
  }
});

// ---------- wiring: sound toggle, Tune panel (same in every experiment) ----------
const soundBtn = document.getElementById("soundBtn");
const tuneBtn = document.getElementById("tuneBtn");
const panel = document.getElementById("panel");

function applySound() {
  synth.set({ volume: config.volume, enabled: soundBtn.getAttribute("aria-pressed") === "true" });
}
soundBtn.addEventListener("click", () => {
  const on = soundBtn.getAttribute("aria-pressed") !== "true";
  soundBtn.setAttribute("aria-pressed", String(on));
  synth.unlock();
  applySound();
});
tuneBtn.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  tuneBtn.setAttribute("aria-expanded", String(!panel.hidden));
});

const FORMAT = {
  speed: (v) => `${v}px/s`,
  life: (v) => `${Number(v).toFixed(1)}s`,
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
}
panel.addEventListener("input", (e) => {
  const k = e.target.dataset.key;
  if (!k) return;
  config[k] = e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
  applySound();
  sync();
  save();
});

applySound();
sync();
