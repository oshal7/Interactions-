// ---------------------------------------------------------------
// Placeholder "app windows". Each one is plain HTML + CSS (no
// screenshots), so they stay crisp at any size and are easy to edit.
//
//   w, h   natural size in px (scaled to the stage at runtime)
//   x, y   starting centre, as a fraction of the stage (0–1)
//   theme  "light" | "dark" (title bar + body colours)
// ---------------------------------------------------------------

export const WINDOWS = [
  {
    id: "notes", title: "Notes", w: 250, h: 200, x: 0.13, y: 0.22, theme: "light",
    body: `
      <div class="notes">
        <b>Weekend list</b>
        <label><i></i>Water the plants</label>
        <label><i class="on"></i>Call the bakery</label>
        <label><i></i>Return library books</label>
        <label><i class="on"></i>Fix the bike chain</label>
        <label><i></i>Try the new noodle place</label>
      </div>`,
  },
  {
    id: "code", title: "app.js — sandbox", w: 340, h: 220, x: 0.6, y: 0.2, theme: "dark",
    body: `
      <pre class="code"><span class="k">const</span> desk = <span class="f">createDesk</span>();

desk.<span class="f">on</span>(<span class="s">"drag"</span>, (win) =&gt; {
  win.<span class="f">bringToFront</span>();
  win.<span class="f">follow</span>(pointer);
});

<span class="c">// TODO: make it feel nice</span>
desk.<span class="f">open</span>(<span class="s">"notes"</span>, <span class="s">"music"</span>);</pre>`,
  },
  {
    id: "calendar", title: "Calendar", w: 290, h: 210, x: 0.11, y: 0.74, theme: "dark",
    body: `
      <div class="cal">
        <div class="cal-head"><b>March</b><span>Today</span></div>
        <div class="cal-grid">${calendarCells()}</div>
      </div>`,
  },
  {
    id: "music", title: "Player", w: 270, h: 132, x: 0.36, y: 0.6, theme: "dark",
    body: `
      <div class="music">
        <div class="art"></div>
        <div class="track">
          <b>Placeholder Song</b>
          <span>The Sample Band</span>
          <div class="bar"><i></i></div>
          <div class="ctrls">⏮ <em>❚❚</em> ⏭</div>
        </div>
      </div>`,
  },
  {
    id: "chat", title: "Messages", w: 230, h: 250, x: 0.88, y: 0.66, theme: "light",
    body: `
      <div class="chat">
        <p class="them">are we still on for friday?</p>
        <p class="me">yes! 7pm?</p>
        <p class="them">perfect. bring the board game</p>
        <p class="me">which one 👀</p>
        <p class="them">the one with the tiny trains</p>
      </div>`,
  },
  {
    id: "photos", title: "Photos", w: 270, h: 190, x: 0.63, y: 0.73, theme: "light",
    body: `<div class="photos">${Array.from({ length: 8 }, (_, i) => `<i style="--h:${i * 41}"></i>`).join("")}</div>`,
  },
  {
    id: "terminal", title: "zsh", w: 290, h: 160, x: 0.87, y: 0.24, theme: "dark",
    body: `
      <pre class="term"><span class="p">~/desk</span> $ npm run tidy
✔ 9 windows found
✔ 0 windows tidy
<span class="p">~/desk</span> $ <span class="cursor"></span></pre>`,
  },
  {
    id: "board", title: "Board", w: 310, h: 190, x: 0.36, y: 0.15, theme: "light",
    body: `
      <div class="board">
        <div><b>To do</b><i></i><i></i><i class="s"></i></div>
        <div><b>Doing</b><i class="a"></i><i></i></div>
        <div><b>Done</b><i class="d"></i><i class="d"></i><i class="d s"></i></div>
      </div>`,
  },
  {
    id: "weather", title: "Weather", w: 190, h: 150, x: 0.42, y: 0.86, theme: "dark",
    body: `
      <div class="weather">
        <span>Somewhere</span>
        <b>21°</b>
        <span>☀︎ Mostly sunny</span>
      </div>`,
  },
];

function calendarCells() {
  const marks = { 4: "a", 11: "b", 12: "b", 19: "a", 23: "c" };
  let html = "";
  for (let d = 1; d <= 28; d++) {
    html += `<span class="${marks[d] ?? ""}${d === 14 ? " today" : ""}">${d}</span>`;
  }
  return html;
}
