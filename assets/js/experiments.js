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
  // (the first rebuild goes here, e.g.)
  // {
  //   slug: "potters-clay",
  //   title: "Potter's clay",
  //   summary: "Press into a spinning lump of clay and shape it one revolution at a time.",
  //   status: "built",
  //   tags: ["Lathe geometry", "Web Audio"],
  //   source: { label: "tol.is/clay", url: "https://tol.is/clay" },
  //   accent: "#c2703d",
  // },

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
