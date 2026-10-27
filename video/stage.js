// Tiny deterministic animation engine: setT(t) draws the frame for time t (seconds).
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  out: (x) => 1 - Math.pow(1 - x, 3),
  io: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  spring: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(11 * x)),
};
function reveal(el, l, a, d = 0.75, dy = 28) {
  const k = E.out(seg(l, a, a + d));
  el.style.opacity = k;
  el.style.transform = `translateY(${(1 - k) * dy}px)`;
}
// Splits an element's text into word spans once, then staggers them in.
function words(el, text, l, a, per = 0.07, d = 0.5) {
  if (el.dataset.built !== text) {
    el.dataset.built = text;
    el.innerHTML = text.split(' ').map((w) => `<span class="w">${w} </span>`).join('');
  }
  [...el.children].forEach((s, i) => {
    const k = E.out(seg(l, a + i * per, a + i * per + d));
    s.style.opacity = k;
    s.style.transform = `translateY(${(1 - k) * 22}px)`;
  });
}
function typed(el, text, l, a, cps = 24, caret = true) {
  const n = Math.floor(clamp((l - a) * cps, 0, text.length));
  el.textContent = text.slice(0, n) + (caret && l > a && n < text.length ? '|' : '');
}
function path(l, pts) { // pts: [t, x, y] with easing between
  if (l <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let i = 1; i < pts.length; i++) if (l <= pts[i][0]) {
    const a = pts[i - 1], b = pts[i], k = E.io(seg(l, a[0], b[0]));
    return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }
  const z = pts[pts.length - 1]; return [z[1], z[2]];
}
function cursor(show, x, y) { const c = $('cur'); c.style.opacity = show ? 1 : 0; c.style.left = x + 'px'; c.style.top = y + 'px'; }
function ripple(l, a, x, y) {
  const r = $('rip'); const k = seg(l, a, a + 0.5);
  r.style.opacity = k > 0 && k < 1 ? 0.9 * (1 - k) : 0;
  r.style.left = x + 'px'; r.style.top = y + 'px';
  r.style.width = r.style.height = 20 + 70 * E.out(k) + 'px';
}
function keycap(el, l, on, off) {
  const k = seg(l, on, on + 0.25) * (1 - seg(l, off - 0.25, off));
  el.style.opacity = k;
  el.style.transform = `translateY(${(1 - E.out(seg(l, on, on + 0.25))) * 24}px)`;
}
function press(el, l, at) { el.style.transform += ` translateY(${l > at && l < at + 0.16 ? 6 : 0}px)`; el.style.borderBottomWidth = l > at && l < at + 0.16 ? '2px' : '7px'; }
// Rect of a stored element (css px of its page) mapped into a displayed image of width W.
function box(name, W, i) { const r = i == null ? RECTS[name] : RECTS[name][i]; const f = W / r.vw; return { x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f }; }
function ring(el, b, a, l, pad = 8, d = 0.5) {
  const k = E.out(seg(l, a, a + d));
  el.style.opacity = k; el.style.left = b.x - pad + 'px'; el.style.top = b.y - pad + 'px';
  el.style.width = b.w + pad * 2 + 'px'; el.style.height = b.h + pad * 2 + 'px';
  el.style.transform = `scale(${1.08 - 0.08 * k})`;
}
// Camera over a shot: s = scale, (cx, cy) = point in the shot (display px) to centre in the window.
function camera(cam, win, from, to, a, b, l) {
  const k = E.io(seg(l, a, b));
  const s = lerp(from.s, to.s, k), cx = lerp(from.x, to.x, k), cy = lerp(from.y, to.y, k);
  const W = win.offsetWidth, H = win.offsetHeight;
  cam.style.transform = `translate(${W / 2 - cx * s}px,${H / 2 - cy * s}px) scale(${s})`;
}
function makeRunner(SC) {
  window.setT = (t) => {
    for (const sc of SC) {
      const el = $(sc.id);
      const live = t >= sc.a && t < sc.b;
      el.style.opacity = live ? Math.min(seg(t, sc.a, sc.a + 0.45), 1 - seg(t, sc.b - 0.45, sc.b)) : 0;
      el.style.visibility = live ? 'visible' : 'hidden';
      if (live && sc.fn) sc.fn(t - sc.a, t);
    }
  };
  window.TOTAL = SC[SC.length - 1].b;
}
const CURSOR_SVG = '<svg class="cur" id="cur" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><div class="rip" id="rip"></div>';
const NAME = new URLSearchParams(location.search).get('name') || 'Tessel';
