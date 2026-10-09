// ---------------------------------------------------------------
// Full-bleed canvas stage for experiments.
//
// Handles the boring parts every canvas piece needs:
//   - sharp rendering on retina screens (devicePixelRatio)
//   - resizing with its container
//   - a pointer with position, velocity, pressed state (mouse/touch/pen)
//   - a requestAnimationFrame loop with delta time (seconds)
//   - pausing when the tab is hidden or the stage scrolls off-screen
//
// Usage:
//   import { createStage } from "../../assets/js/stage.js";
//   const stage = createStage(document.querySelector("#stage"));
//   stage.loop((dt, t) => {
//     const { ctx, W, H, pointer } = stage;
//     ctx.clearRect(0, 0, W, H);
//   });
// ---------------------------------------------------------------

// touchAction: "pan-y" (default) lets a vertical swipe scroll past the piece on phones;
// pass "none" when the piece needs every touch (it then needs its own way down the page).
export function createStage(container, { context = "2d", maxDpr = 2, touchAction = "pan-y" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:${touchAction};`;
  container.prepend(canvas);
  const ctx = context === "2d" ? canvas.getContext("2d") : canvas.getContext(context, { antialias: true });

  const stage = {
    canvas, ctx,
    W: 0, H: 0, dpr: 1,
    pointer: { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, inside: false, type: "mouse" },
    onResize: null,       // optional callback(W, H)
    onDown: null,         // optional callback(pointer, event)
    onUp: null,
    loop,
    stop,
  };

  // ---- size ----
  function resize() {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;
    stage.W = W; stage.H = H; stage.dpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (context === "2d") ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw in CSS pixels
    stage.onResize?.(W, H);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ---- pointer ----
  const p = stage.pointer;
  function setFrom(e) {
    const r = canvas.getBoundingClientRect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    p.type = e.pointerType;
  }
  canvas.addEventListener("pointermove", (e) => { setFrom(e); p.inside = true; });
  canvas.addEventListener("pointerdown", (e) => {
    setFrom(e);
    p.down = true;
    p.inside = true;
    canvas.setPointerCapture(e.pointerId);
    stage.onDown?.(p, e);
  });
  const up = (e) => {
    if (!p.down) return;
    p.down = false;
    stage.onUp?.(p, e);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (!p.down) p.inside = false; });

  // ---- loop ----
  let raf = 0, last = 0, t = 0, tick = null;
  let visible = true, onScreen = true;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // pointer velocity in px/s, smoothed a little
    const k = dt > 0 ? 1 / dt : 0;
    p.vx += ((p.x - p.px) * k - p.vx) * 0.5;
    p.vy += ((p.y - p.py) * k - p.vy) * 0.5;
    p.px = p.x; p.py = p.y;
    tick?.(dt, t);
    raf = requestAnimationFrame(frame);
  }
  function run() {
    if (raf || !tick || !visible || !onScreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function halt() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function loop(fn) { tick = fn; run(); }
  function stop() { tick = null; halt(); }

  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    visible ? run() : halt();
  });
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    onScreen ? run() : halt();
  }).observe(container);

  return stage;
}

// Small maths helpers most pieces end up needing.
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
// Frame-rate independent smoothing: move `k` of the way per 60Hz frame.
export const damp = (k, dt) => 1 - Math.pow(1 - k, dt * 60);
