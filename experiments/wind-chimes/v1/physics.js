// ---------------------------------------------------------------
// Wind chime physics (no library).
//
// Every hanging thing is a pendulum: a fixed pivot and one particle
// (its centre of mass) kept at a fixed distance by a constraint.
// Integration is Verlet: velocity is implied by (x - previous x),
// which makes constraints and collisions simple to apply.
//
//   tubes   : string + tube hang in a straight line from the pivot
//   striker : a horizontal puck on the central string, with a sail
//             (wind catcher) further down the same string
//   hand    : your cursor, a kinematic capsule along the view ray
//
// Collisions are resolved with impulses at the contact point.
// Because each body rotates about its pivot, a point at height h
// moves h/L as fast as the particle at L, so impulses and position
// fixes are scaled by that lever ratio.
// ---------------------------------------------------------------

const G = 9.81;

// tiny vector helpers on [x, y, z] arrays
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const vec = { add, sub, mul, dot, len, norm };

// Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
export function closestSegSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  return { pa: add(p1, mul(d1, s)), pb: add(p2, mul(d2, t)), s, t };
}

// ---------------------------------------------------------------
export function createChime({
  notes,                 // [{ freq }] lowest first
  ringRadius = 0.22,     // where tubes hang on the top disc
  topY = 1.62,
  stringLen = 0.1,
  maxLen = 1.1,          // longest tube (for the lowest note)
  tubeRadius = 0.026,
  strikerDrop = 0.55,    // pivot → striker centre
  sailDrop = 1.38,       // pivot → sail centre
  strikerRadius = 0.15,
}) {
  const fLow = Math.min(...notes.map((n) => n.freq));
  const tubes = notes.map((n, i) => {
    // free-free bar: frequency ∝ 1 / length², so length ∝ 1/√f
    const L = Math.max(0.32, maxLen * Math.sqrt(fLow / n.freq));
    const ang = Math.PI / 2 + (i / notes.length) * Math.PI * 2;    // lowest (longest) at the front (+z, toward the camera), descending round the ring
    const P = [Math.cos(ang) * ringRadius, topY, Math.sin(ang) * ringRadius];
    const Lc = stringLen + L / 2;
    return {
      kind: "tube", i, note: n, P, L, s: stringLen, Lc, r: tubeRadius,
      m: 0.25 + L * 0.6,   // aluminium tube: heavier when longer
      X: add(P, [0, -Lc, 0]), Xp: add(P, [0, -Lc, 0]),
      lastHit: -1, energy: 0,
    };
  });
  const striker = {
    kind: "striker", P: [0, topY, 0], Lc: strikerDrop, r: strikerRadius, half: 0.018,
    sail: sailDrop, m: 0.45,
    X: [0, topY - strikerDrop, 0], Xp: [0, topY - strikerDrop, 0], lastHit: -1,
  };

  const bodies = [...tubes, striker];
  const env = {
    gravity: G,
    air: 0.22,           // drag per second (low = long, smooth swinging)
    bounceMetal: 0.62,   // restitution tube ↔ tube
    bounceWood: 0.45,    // restitution striker ↔ tube
    wind: [0, 0, 0],     // m/s, horizontal
    windArea: { tube: 0.02, striker: 0.05, sail: 0.32 },
    hand: null,          // { a, b, r, va, vb } capsule along the view ray
    handMass: 0.12,      // a light finger: it nudges tubes and slips past, it doesn't bat them away
    handSoft: 0.12,      // while still touching: fraction of the overlap pushed out per step
    grabSpeed: 1.6,      // m/s: fastest a grabbed point moves (and is thrown on release)
    grab: null,          // { body, h, target }
    onHit: null,         // ({ kind, a, b, speed, point }) => void
    contacts: [],        // recent contact points (for drawing)
  };

  const axis = (b) => norm(sub(b.X, b.P));
  function tubeEnds(t) {
    const ax = axis(t);
    return [add(t.P, mul(ax, t.s)), add(t.P, mul(ax, t.s + t.L))];
  }
  const sailPoint = () => add(striker.P, mul(axis(striker), striker.sail));

  function constrain(b) {
    const d = sub(b.X, b.P);
    const l = len(d) || 1;
    b.X = add(b.P, mul(d, b.Lc / l));
  }

  // velocity of a body's point at distance h from its pivot (rotation about the pivot)
  const velAt = (b, h, dt) => mul(sub(b.X, b.Xp), (h / b.Lc) / dt);

  // Impulse between body A (point at distance hA) and body B, or an external object
  // (B = null) moving at vKin with inverse mass wKin (0 = immovable).
  // n points from B to A. Returns the closing speed (for sound).
  function resolve(A, hA, B, hB, n, pen, e, dt, vKin = [0, 0, 0], wKin = 0) {
    const rA = hA / A.Lc, wA = (rA * rA) / A.m;
    const rB = B ? hB / B.Lc : 0, wB = B ? (rB * rB) / B.m : wKin;
    const W = wA + wB;
    if (W <= 0) return 0;
    const vA = velAt(A, hA, dt);
    const vB = B ? velAt(B, hB, dt) : vKin;
    const vn = dot(sub(vA, vB), n);

    // push apart (moving X and Xp together keeps velocity unchanged)
    if (pen > 0) {
      const mA = mul(n, (pen * wA) / W / Math.max(rA, 0.05));
      A.X = add(A.X, mA); A.Xp = add(A.Xp, mA);
      if (B) {
        const mB = mul(n, (-pen * wB) / W / Math.max(rB, 0.05));
        B.X = add(B.X, mB); B.Xp = add(B.Xp, mB);
      }
    }
    if (vn >= 0) return 0;            // already separating
    const j = (-(1 + e) * vn) / W;
    // Δv of the particle = j · r / m   (torque about the pivot)
    const dA = mul(n, (j * rA) / A.m);
    A.Xp = sub(A.Xp, mul(dA, dt));
    if (B) {
      const dB = mul(n, (-j * rB) / B.m);
      B.Xp = sub(B.Xp, mul(dB, dt));
    }
    return -vn;
  }

  function hit(kind, a, b, speed, point, t) {
    env.contacts.push({ point, t, speed });
    if (env.contacts.length > 40) env.contacts.shift();
    env.onHit?.({ kind, a, b, speed, point });
  }

  // one physics substep
  function step(dt, t) {
    // 1. forces + Verlet integration
    const drag = Math.exp(-env.air * dt);
    for (const b of bodies) {
      const v = sub(b.X, b.Xp);
      let ax = 0, ay = -env.gravity, az = 0;
      // wind pushes on area; on the striker the sail (lower down, big) dominates
      const area = b.kind === "tube" ? env.windArea.tube * b.L : env.windArea.striker;
      ax += (env.wind[0] * area) / b.m;
      az += (env.wind[2] * area) / b.m;
      if (b.kind === "striker") {
        const lever = b.sail / b.Lc;   // force at the sail acts like lever× force at the puck
        ax += (env.wind[0] * env.windArea.sail * lever) / b.m;
        az += (env.wind[2] * env.windArea.sail * lever) / b.m;
      }
      b.Xp = b.X;
      b.X = add(b.X, add(mul(v, drag), [ax * dt * dt, ay * dt * dt, az * dt * dt]));
      constrain(b);
    }

    // 2. grabbed body follows the pointer (position-based, so letting go keeps the swing),
    //    but no faster than a hand would move it: a flick can't fling a tube
    if (env.grab) {
      const { body, h, target } = env.grab;
      const cur = add(body.P, mul(axis(body), h));
      const delta = sub(target, cur);
      body.X = add(body.X, mul(delta, (0.25 * body.Lc) / h));
      constrain(body);
      const v = sub(body.X, body.Xp);
      const vMax = env.grabSpeed * (body.Lc / h) * dt;   // cap the grabbed point at grabSpeed m/s
      const l = len(v);
      if (l > vMax) body.Xp = sub(body.X, mul(v, vMax / l));
    }

    // 3. collisions
    // tube ↔ tube
    for (let i = 0; i < tubes.length; i++) {
      const A = tubes[i];
      const [a0, a1] = tubeEnds(A);
      for (let k = i + 1; k < tubes.length; k++) {
        const B = tubes[k];
        const [b0, b1] = tubeEnds(B);
        const c = closestSegSeg(a0, a1, b0, b1);
        const d = sub(c.pa, c.pb);
        const dist = len(d);
        const rr = A.r + B.r;
        if (dist >= rr || dist < 1e-6) continue;
        const n = mul(d, 1 / dist);
        const hA = A.s + c.s * A.L, hB = B.s + c.t * B.L;
        const sp = resolve(A, hA, B, hB, n, rr - dist, env.bounceMetal, dt);
        constrain(A); constrain(B);
        if (sp > 0.015) hit("tube-tube", A, B, sp, mul(add(c.pa, c.pb), 0.5), t);
      }
    }

    // striker (a horizontal puck) ↔ tube: compare at the puck's height
    const S = striker;
    for (const T of tubes) {
      const [a0, a1] = tubeEnds(T);
      const span = a0[1] - a1[1];
      if (span <= 1e-6) continue;
      const u = clamp((a0[1] - S.X[1]) / span, 0, 1);
      const pT = add(a0, mul(sub(a1, a0), u));
      if (Math.abs(pT[1] - S.X[1]) > S.half + T.r) continue;   // puck is above/below this tube
      const dxz = [pT[0] - S.X[0], 0, pT[2] - S.X[2]];
      const dist = len(dxz);
      const rr = S.r + T.r;
      if (dist >= rr || dist < 1e-6) continue;
      const n = mul(dxz, 1 / dist);                              // striker → tube
      const hT = T.s + u * T.L;
      const sp = resolve(T, hT, S, S.Lc, n, rr - dist, env.bounceWood, dt);
      constrain(T); constrain(S);
      if (sp > 0.015) hit("striker-tube", T, S, sp, pT, t);
    }

    // your hand (a capsule along the view ray, moving with the pointer)
    const H = env.hand;
    if (!H) for (const B of bodies) B.handTouch = false;
    if (H) {
      for (const B of bodies) {
        if (env.grab && env.grab.body === B) { B.handTouch = false; continue; }
        let segA, segB, rB, hOf;
        if (B.kind === "tube") {
          [segA, segB] = tubeEnds(B);
          rB = B.r;
          hOf = (s) => B.s + s * B.L;
        } else {
          // the striker string from puck to sail is what your finger catches
          segA = B.X;
          segB = sailPoint();
          rB = 0.05;
          hOf = (s) => B.Lc + s * (B.sail - B.Lc);
        }
        const c = closestSegSeg(segA, segB, H.a, H.b);
        const d = sub(c.pa, c.pb);
        const dist = len(d);
        const rr = rB + H.r;
        if (dist >= rr || dist < 1e-6) { B.handTouch = false; continue; }
        const n = mul(d, 1 / dist);
        const vHand = add(mul(H.va, 1 - c.t), mul(H.vb, c.t));
        const h = Math.max(0.05, Math.min(hOf(c.s), B.kind === "tube" ? B.s + B.L : B.sail));
        if (!B.handTouch) {
          // first touch: one light tap, like a finger brushing past
          resolve(B, h, null, 0, n, 0, 0.1, dt, vHand, 1 / env.handMass);
          B.handTouch = true;
        } else {
          // still touching: a soft push out of the way (slow pushes still move it; fast sweeps slip past).
          // Move X and Xp together: a displacement, not a kick (in Verlet, moving X alone adds speed).
          const r = h / B.Lc;
          const move = mul(n, ((rr - dist) * env.handSoft) / Math.max(r, 0.05));
          B.X = add(B.X, move);
          B.Xp = add(B.Xp, move);
        }
        constrain(B);
        B.Xp = add(B.P, mul(norm(sub(B.Xp, B.P)), B.Lc));   // keep Xp on the same sphere, so no radial speed sneaks in
      }
    }
  }

  // energy of each tube's swing (for subtle visuals)
  function swing(b, dt) { return len(sub(b.X, b.Xp)) / dt; }

  return { tubes, striker, bodies, env, step, tubeEnds, sailPoint, axis, swing };
}
