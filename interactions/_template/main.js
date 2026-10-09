// Pattern logic. Reuse shared helpers from assets/js where they fit:
import { createClicker } from "../../assets/js/sound.js";

const sfx = createClicker({ profile: "pop", pitch: 1800, volume: 0.5 });
const target = document.getElementById("target");

target.addEventListener("pointerdown", () => sfx.press());
target.addEventListener("pointerup", () => sfx.release());
