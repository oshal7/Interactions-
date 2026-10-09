// ---------------------------------------------------------------
// The library. One entry per interaction pattern.
// To add your own: copy interactions/_template, then add an entry here.
// ---------------------------------------------------------------

export const INTERACTIONS = [
  {
    slug: "press-to-feel",
    number: "01",
    title: "Press to feel",
    summary:
      "A chunky 3D key that clicks like a mechanical switch and floods the page with a new colour from the point you pressed.",
    spottedOn: { label: "shashankmahajan.in", url: "https://shashankmahajan.in" },
    ingredients: ["CSS 3D transforms", "clip-path reveal", "Web Audio", "Blur crossfade", "State machine"],
    accent: "#3b3bff",
    accent2: "#f2c94c",
    added: "2026-10-09",
    thumb: "key",
  },
  {
    slug: "messy-desktop",
    number: "02",
    title: "Messy desktop",
    summary:
      "A landing page dressed up as a cluttered desktop. Drag, throw and stack app windows, then put them all away from the menu bar.",
    spottedOn: { label: "Later (Mac app landing page)" },
    ingredients: ["Pointer events", "Pointer capture", "z-index stacking", "rAF physics loop", "Velocity sampling", "backdrop-filter"],
    accent: "#0a0a0c",
    accent2: "#4c6bff",
    added: "2026-10-09",
    thumb: "windows",
  },
  {
    slug: "star-dodger",
    number: "03",
    title: "Star dodger",
    summary:
      "A tiny survival game hidden in a portfolio card. Steer a dot with your cursor, grab stars, dodge falling spikes and exploding bombs.",
    spottedOn: { label: "alyssax.com", url: "https://alyssax.com" },
    ingredients: ["Canvas 2D", "Game loop + delta time", "Collision checks", "Spawn timers", "Web Audio synth", "localStorage"],
    accent: "#050506",
    accent2: "#a855f7",
    added: "2026-10-09",
    thumb: "game",
  },
  // {
  //   slug: "my-next-pattern",
  //   number: "02",
  //   title: "My next pattern",
  //   summary: "One sentence on what it does and why it feels good.",
  //   spottedOn: { label: "example.com", url: "https://example.com" },
  //   ingredients: ["…"],
  //   accent: "#ff5a36",
  //   accent2: "#111111",
  //   added: "YYYY-MM-DD",
  // },
];
