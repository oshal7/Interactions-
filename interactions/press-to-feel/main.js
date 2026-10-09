// ---------------------------------------------------------------
// 01 · Press to feel
//
// Structure:
//   1. config + persistence      (what the playground controls)
//   2. apply()                   (config → CSS variables / text)
//   3. the interaction           (press, release, toggle, reveal)
//   4. playground wiring         (inputs, buttons)
// ---------------------------------------------------------------
import { createClicker, haptic } from "../../assets/js/sound.js";

// ---------- 1. config ----------
const DEFAULTS = {
  // angle (degrees)
  rz: -6, rx: 18, ry: -12,
  afterPress: "straighten",
  // placement (% of stage) + size
  x: 50, y: 68, scale: 1, showHint: true,
  // feel
  depth: 9, dur: 650, ease: "cubic-bezier(0.65, 0, 0.35, 1)", origin: "key",
  // sound
  sound: true, profile: "clicky", pitch: 3300, volume: 0.6, haptics: true,
  // colours
  bgA: "#121216", bgB: "#3b3bff", capA: "#3b3bff", capB: "#f2c94c",
  // placeholder copy
  headA: "Small moves. / Big moods.",
  headB: "Tiny touch. / Huge grin.",
  labelA: "Press this, please.",
  labelB: "There it is.",
};

const STORE_KEY = "lab:press-to-feel";
const config = { ...DEFAULTS, ...load() };

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch { /* private mode etc. */ }
}

// ---------- elements ----------
const $ = (s, el = document) => el.querySelector(s);
const stage = $("#stage");
const bg = $("#stageBg");
const reveal = $("#stageReveal");
const key = $("#key");
const anchor = $("#keyAnchor");
const panel = $(".panel");
const status = $("#panelStatus");
const pressCountEl = $("#pressCount");

const sfx = createClicker();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let state = "a";
let presses = 0;
let angles = restAngles();   // the angle the key is showing right now
let running = null;          // the in-flight reveal animation, if any

// ---------- 2. apply config ----------
function apply() {
  const s = stage.style;
  s.setProperty("--bg-a", config.bgA);
  s.setProperty("--bg-b", config.bgB);
  s.setProperty("--ink-a", readableInk(config.bgA));
  s.setProperty("--ink-b", readableInk(config.bgB));
  s.setProperty("--cap-a", config.capA);
  s.setProperty("--cap-b", config.capB);
  s.setProperty("--cap-ink-a", readableInk(config.capA));
  s.setProperty("--cap-ink-b", readableInk(config.capB));
  s.setProperty("--dur", `${config.dur}ms`);
  s.setProperty("--ease", config.ease);
  s.setProperty("--x", `${config.x}%`);
  s.setProperty("--y", `${config.y}%`);
  s.setProperty("--scale", config.scale);
  s.setProperty("--depth", `${config.depth}px`);
  setAngles(angles);

  if (!running) bg.style.background = state === "a" ? config.bgA : config.bgB;

  anchor.classList.toggle("hint-left", config.x > 62);
  anchor.classList.toggle("no-hint", !config.showHint);

  sfx.set({ enabled: config.sound, profile: config.profile, pitch: config.pitch, volume: config.volume });

  // placeholder copy
  const [a1, a2 = ""] = split(config.headA);
  const [b1, b2 = ""] = split(config.headB);
  setText("headA1", a1); setText("headA2", a2);
  setText("headB1", b1); setText("headB2", b2);
  setText("labelA", config.labelA);
  setText("labelB", config.labelB);

  syncPanel();
}

function setAngles({ rx, ry, rz }) {
  stage.style.setProperty("--rx", `${rx}deg`);
  stage.style.setProperty("--ry", `${ry}deg`);
  stage.style.setProperty("--rz", `${rz}deg`);
}

// The angle for each state, based on the "After a press…" setting.
function restAngles() {
  return { rx: config.rx, ry: config.ry, rz: config.rz };
}
function pressedAngles() {
  const { rx, ry, rz } = config;
  switch (config.afterPress) {
    case "straighten": return { rx: Math.round(rx * 0.5), ry: 0, rz: 0 };
    case "mirror": return { rx, ry: -ry, rz: -rz };
    case "random": return randomAngles();
    default: return { rx, ry, rz };
  }
}
function randomAngles() {
  const r = (n) => Math.round((Math.random() * 2 - 1) * n);
  return { rx: r(30), ry: r(25), rz: r(22) };
}

// ---------- 3. the interaction ----------
let isDown = false;
let lastKeyboardAt = 0;

function down() {
  if (isDown) return;
  isDown = true;
  key.classList.add("is-down");
  sfx.press();
  if (config.haptics) haptic(8);
}

function up(commit, point) {
  if (!isDown) return;
  isDown = false;
  key.classList.remove("is-down");
  if (!commit) return;
  sfx.release();
  toggle(point);
}

function toggle(point) {
  const next = state === "a" ? "b" : "a";
  const nextColor = next === "a" ? config.bgA : config.bgB;

  revealFrom(originPoint(point), nextColor);

  state = next;
  stage.dataset.state = next;
  key.setAttribute("aria-pressed", String(next === "b"));
  $(".hl-a").setAttribute("aria-hidden", String(next !== "a"));
  $(".hl-b").setAttribute("aria-hidden", String(next !== "b"));
  $(".face-a").setAttribute("aria-hidden", String(next !== "a"));
  $(".face-b").setAttribute("aria-hidden", String(next !== "b"));

  angles = next === "a" ? restAngles() : pressedAngles();
  setAngles(angles);

  presses += 1;
  pressCountEl.textContent = `${presses} ${presses === 1 ? "press" : "presses"}`;
}

// Where the colour circle starts, in stage-local pixels.
function originPoint(point) {
  const r = stage.getBoundingClientRect();
  if (config.origin === "corner") return { x: 0, y: 0, r };
  if (config.origin === "pointer" && point) return { x: point.x - r.left, y: point.y - r.top, r };
  const k = $(".key-cap").getBoundingClientRect();
  return { x: k.left + k.width / 2 - r.left, y: k.top + k.height / 2 - r.top, r };
}

function revealFrom({ x, y, r }, color) {
  // A press during a running reveal: commit that one's colour right away
  // (synchronously — the `finish` event would arrive a frame too late).
  if (running) {
    bg.style.background = running.color;
    running.cancel();
    running = null;
  }

  if (reducedMotion.matches) {
    bg.style.background = color;
    return;
  }

  // Radius that reaches the farthest corner from the origin.
  const R = Math.ceil(Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)));

  reveal.style.background = color;
  const anim = reveal.animate(
    [
      { clipPath: `circle(0px at ${x}px ${y}px)` },
      { clipPath: `circle(${R}px at ${x}px ${y}px)` },
    ],
    { duration: config.dur, easing: config.ease, fill: "forwards" },
  );
  anim.color = color;
  running = anim;
  anim.onfinish = () => {
    bg.style.background = color;  // commit the new colour underneath…
    anim.cancel();                // …and reset the mask for next time
    if (running === anim) running = null;
  };
}

// Pointer (mouse, touch, pen)
key.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  key.setPointerCapture(e.pointerId);
  down();
});
key.addEventListener("pointerup", (e) => {
  // Only counts if released over the key, like a native button.
  const k = key.getBoundingClientRect();
  const inside = e.clientX >= k.left && e.clientX <= k.right && e.clientY >= k.top && e.clientY <= k.bottom;
  up(inside, { x: e.clientX, y: e.clientY });
});
key.addEventListener("pointercancel", () => up(false));

// Keyboard (Space / Enter)
key.addEventListener("keydown", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault(); // stop the native click; we drive it ourselves
  if (!e.repeat) down();
});
key.addEventListener("keyup", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  lastKeyboardAt = performance.now();
  up(true);
});
key.addEventListener("blur", () => up(false));

// Assistive tech (e.g. VoiceOver) can "click" without pointer or key events.
key.addEventListener("click", (e) => {
  if (e.detail !== 0 || performance.now() - lastKeyboardAt < 300) return;
  sfx.preview();
  toggle();
});

// ---------- 4. playground wiring ----------
const POSITIONS = [
  [22, 40], [50, 40], [78, 40],
  [22, 64], [50, 64], [78, 64],
  [22, 84], [50, 84], [78, 84],
];
const posGrid = $("#posGrid");
posGrid.innerHTML = POSITIONS.map(([x, y], i) =>
  `<button type="button" data-pos="${i}" aria-label="Place key at ${x}% across, ${y}% down"></button>`).join("");
posGrid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pos]");
  if (!b) return;
  const [x, y] = POSITIONS[b.dataset.pos];
  update({ x, y });
});

const FORMAT = {
  rz: (v) => `${v}°`, rx: (v) => `${v}°`, ry: (v) => `${v}°`,
  x: (v) => `${v}%`, y: (v) => `${v}%`, scale: (v) => `${Number(v).toFixed(2)}×`,
  depth: (v) => `${v}px`, dur: (v) => `${v}ms`, pitch: (v) => `${v} Hz`,
  volume: (v) => `${Math.round(v * 100)}%`,
};

// Push config values into the form controls.
function syncPanel() {
  panel.querySelectorAll("[data-key]").forEach((input) => {
    const v = config[input.dataset.key];
    if (input.type === "checkbox") input.checked = Boolean(v);
    else if (document.activeElement !== input) input.value = v;
  });
  panel.querySelectorAll("[data-text]").forEach((input) => {
    if (document.activeElement !== input) input.value = config[input.dataset.text];
  });
  panel.querySelectorAll("[data-out]").forEach((out) => {
    const k = out.dataset.out;
    out.textContent = FORMAT[k] ? FORMAT[k](config[k]) : config[k];
  });
  posGrid.querySelectorAll("[data-pos]").forEach((b) => {
    const [x, y] = POSITIONS[b.dataset.pos];
    b.setAttribute("aria-pressed", String(x === config.x && y === config.y));
  });
}

const ANGLE_KEYS = new Set(["rx", "ry", "rz", "afterPress"]);

function update(patch) {
  Object.assign(config, patch);
  // Angle edits should show immediately, in whichever state we're in.
  if (Object.keys(patch).some((k) => ANGLE_KEYS.has(k))) {
    angles = state === "a" ? restAngles() : pressedAngles();
  }
  apply();
  save();
}

panel.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.key) {
    const k = el.dataset.key;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "range") v = Number(v);
    update({ [k]: v });
  } else if (el.dataset.text) {
    update({ [el.dataset.text]: el.value });
  }
});

const PALETTES = [
  ["#121216", "#3b3bff", "#3b3bff", "#f2c94c"],
  ["#f4efe6", "#ff5a36", "#ff5a36", "#1d1d1f"],
  ["#0f2a1d", "#c6f432", "#c6f432", "#0f2a1d"],
  ["#1b1035", "#ff7ad9", "#ff7ad9", "#fff3b0"],
  ["#e9f1ff", "#0b3d91", "#0b3d91", "#ffd23f"],
  ["#111111", "#ffffff", "#f0f0f0", "#111111"],
];

panel.addEventListener("click", async (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  switch (action) {
    case "randomAngle": update(randomAngles()); break;
    case "flatAngle": update({ rx: 0, ry: 0, rz: 0 }); break;
    case "previewSound": sfx.preview(); break;
    case "shufflePalette": {
      const current = PALETTES.findIndex((p) => p[0] === config.bgA && p[1] === config.bgB);
      const [bgA, bgB, capA, capB] = PALETTES[(current + 1) % PALETTES.length];
      update({ bgA, bgB, capA, capB });
      break;
    }
    case "reset":
      Object.assign(config, DEFAULTS);
      angles = state === "a" ? restAngles() : pressedAngles();
      apply();
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      flash("Back to defaults.");
      break;
    case "copyJson":
      try {
        await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
        flash("Settings copied as JSON.");
      } catch {
        flash("Couldn't reach the clipboard. Settings are logged to the console instead.");
        console.log(JSON.stringify(config, null, 2));
      }
      break;
  }
});

// ---------- helpers ----------
function split(text) { return String(text).split(" / "); }
function setText(name, value) {
  document.querySelectorAll(`[data-copy="${name}"]`).forEach((el) => { el.textContent = value; });
}
let flashTimer;
function flash(msg) {
  status.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { status.textContent = ""; }, 2600);
}
// Pick near-black or near-white text for a background colour.
function readableInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? "#141416" : "#f7f6f2";
}

apply();
