// ---------------------------------------------------------------
// Experiments: physical, generative and musical pieces.
// Kept separate from the UI interactions in registry.js.
//
// status: "built"   → has a folder in experiments/<slug>/
//         "queued"  → spotted, waiting for a recording to rebuild
// ---------------------------------------------------------------

export const SOURCE = { label: "tol.is", url: "https://tol.is", author: "Tolis C" };

export const EXPERIMENTS = [
  // ---- built ----
  {
    slug: "paper-plane",
    title: "Paper plane",
    summary: "A flock of folded paper planes gliding through a 3D sky. Tap one to knock it tumbling, sweep past for a gust, drag to throw a new one.",
    status: "built",
    tags: ["3D projection", "Glider physics", "Painter's algorithm", "Panned Web Audio"],
    source: { label: "tol.is", url: "https://tol.is" },
    accent: "#9fb6cc",
  },

  // ---- queued from tol.is (names as listed on the site) ----
  ...[
    ["Stormy clouds", "https://tol.is/"],
    ["Silk"], ["Skolex"],
    ["Orca", "https://tol.is/orca"],
    ["Stoma"], ["Elasma"],
    ["Lychnos", "https://tol.is/lychnos"],
    ["Marble"], ["Komboloi"],
    ["Potter's clay", "https://tol.is/clay"],
    ["Slinky"], ["Pelagos"], ["Strandbeest"], ["Tholos"], ["Paper plane"],
    ["Balloon", "https://tol.is/balloon"],
    ["Manta ray"], ["Heart equation"], ["Medusa"], ["Bluefin tuna"],
    ["Dot grid heightfield"], ["Hénon–Heiles"], ["Aizawa attractor"], ["Butterfly equation"],
    ["Resonance"],
    ["Antikythera", "https://tol.is/antikythera"],
    ["Drone dynamics"], ["N-body simulation"], ["Autonomous agents"],
    ["Kintsugi fracture", "https://tol.is/kintsugi"],
    ["Spherical projection"],
    ["Blueprint", "https://tol.is/blueprint"],
    ["Manhattan polylines", "https://tol.is/circuit"],
    ["Ballistic sim"], ["Elastic collision"], ["Karesansui"], ["Impulse propagation"],
    ["Harmonic mesh", "https://tol.is/mesh"],
    ["Marching squares", "https://tol.is/topo"],
    ["Curl noise field", "https://tol.is/vortex"],
    ["Radial scan"],
  ].map(([title, url]) => ({ title, status: "queued", source: url ? { label: url.replace("https://", ""), url } : null })),
];
