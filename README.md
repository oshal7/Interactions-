# Interaction Lab

A personal library of interaction patterns spotted across the web, rebuilt from scratch with placeholder content.
Each pattern has two parts:

- **A playground**: the interaction, plus a panel of controls to change angles, position, timing, colours and sound.
- **A breakdown**: what the original did, the ingredients it took, and the key code for each step.

It's plain HTML, CSS and JavaScript modules. There's no build step and nothing to install.

## Patterns

| # | Pattern | Spotted on | Ingredients |
|---|---------|-----------|-------------|
| 01 | [Press to feel](interactions/press-to-feel/) | shashankmahajan.in | CSS 3D transforms, `clip-path` reveal, Web Audio, blur crossfade |
| 02 | [Messy desktop](interactions/messy-desktop/) | Later (Mac app landing page) | Pointer events + capture, z-index stacking, rAF physics (throw, tilt, bounce), glides |
| 03 | [Star dodger](interactions/star-dodger/) | alyssax.com | Canvas 2D, game loop + delta time, collisions, spawn timers, Web Audio synth |

## Run it locally

ES modules need a server; opening the file directly won't load them.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publish on GitHub Pages

1. In the repo on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the *Deploy to GitHub Pages* workflow by hand). The site appears at
   `https://<your-username>.github.io/Interactions-/`.

## Add a new pattern

1. Copy `interactions/_template/` to `interactions/<your-slug>/`.
2. Build the interaction in `main.js` and `style.css` there. Shared helpers:
   - `assets/js/sound.js`: `createClicker()` for synthesised UI clicks, `createSynth()` for game sounds (`tone()` + `noise()`), and `haptic()` for a vibration tap.
   - `assets/css/site.css`: fonts, colour tokens, the playground layout (`.lab`, `.panel`, `.row`, `.btn`), and the explainer layout (`.ingredients`, `.steps`, `.facts`, `.callout`).
3. Fill in the **How it's built** section: what you observed, the ingredients, and the steps with code.
4. Add an entry to `assets/js/registry.js`. The home page builds its cards from that list.

Keep copy and assets original. Credit where you spotted the pattern, but don't copy someone's text, images or code.

## Structure

```
index.html                     library home (cards come from the registry)
assets/css/site.css            shared chrome + explainer styles
assets/js/registry.js          the list of patterns
assets/js/sound.js             Web Audio click synth (no audio files)
interactions/
  press-to-feel/               01 · playground + breakdown
  messy-desktop/               02 · draggable windows (windows.js holds the mock apps)
  star-dodger/                 03 · canvas mini-game with synthesised sound
  _template/                   copy this to start a new pattern
.github/workflows/pages.yml    deploys the site to GitHub Pages
```
