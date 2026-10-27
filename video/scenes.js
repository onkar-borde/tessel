// Scene builders shared by the intro and the walkthrough. Each returns { html, fn(l, t) }.
const IMG = '../docs/img/';
const TITLES = ['ESP32 upload problems', 'Sleep and memory', 'Postgres index choices', 'Tax residency rules', 'Resume rewrite', 'Kubernetes probes', 'Thesis outline ideas', 'Regex for log lines', 'Trip to Lisbon', 'Pricing page copy', 'Python async patterns', 'Contract clause review', 'Meal prep plan', 'Chart colour advice', 'Interview prep', 'Bike gear ratios', 'SQL window functions', 'Grant proposal draft'];
const CH = { y: '255,213,0', g: '61,220,132', b: '77,163,255', p: '255,111,181' };
const bgHl = (c, a) => `rgba(${CH[c]},${(0.42 * a).toFixed(3)})`;

const Scenes = {
  // ---------- 1. the problem ----------
  problem(id) {
    return {
      html: `<div id="${id}-t" style="position:absolute;inset:0;opacity:.45"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(27,26,24,.97) 28%,rgba(27,26,24,.55) 100%)"></div>
        <div class="big" style="top:300px;font-size:80px" id="${id}-a"></div>
        <div class="big acc" style="top:600px;font-size:64px;font-weight:650" id="${id}-b"></div>`,
      fn(l) {
        const box = $(id + '-t');
        if (!box.childNodes.length) for (let i = 0; i < 40; i++) { const d = document.createElement('div'); d.textContent = TITLES[i % TITLES.length]; d.style.cssText = `position:absolute;left:${(i % 4) * 25 + 3}%;font-size:26px;color:#8f8a80;white-space:nowrap`; d.dataset.i = i; box.appendChild(d); }
        [...box.children].forEach((d) => { const i = +d.dataset.i; d.style.top = (((i * 97 + 1200 - l * 70) % 1300) - 100) + 'px'; });
        words($(id + '-a'), 'You have had hundreds of useful AI conversations.', l, 0.3, 0.09);
        words($(id + '-b'), 'How many can you actually find again?', l, 3.3, 0.1);
      },
    };
  },

  // ---------- 2. where the work happens ----------
  longchats(id) {
    const chips = [['Literature reviews', 330, 230], ['Debugging sessions', 1010, 190], ['Data analysis', 250, 430], ['Grant drafts', 1180, 410], ['Architecture decisions', 640, 320]];
    return {
      html: chips.map((c, i) => `<div class="chip" id="${id}-c${i}" style="left:${c[1]}px;top:${c[2]}px"></div>`).join('') +
        `<div class="big" style="top:640px;font-size:68px" id="${id}-a"></div><div class="big acc" style="top:790px;font-size:68px" id="${id}-b"></div>`,
      fn(l) {
        chips.forEach((c, i) => { const el = $(`${id}-c${i}`); el.textContent = c[0]; const k = E.back(seg(l, 0.3 + i * 0.28, 0.9 + i * 0.28)); el.style.opacity = clamp(k, 0, 1); el.style.transform = `translateY(${(1 - k) * 40}px) scale(${0.9 + 0.1 * k})`; const fade = seg(l, 4.4, 5.2); el.style.opacity = clamp(k, 0, 1) * (1 - 0.7 * fade); el.style.filter = `blur(${fade * 5}px)`; });
        words($(id + '-a'), 'The real work happens inside long chats.', l, 2.2, 0.08);
        words($(id + '-b'), 'Then it scrolls away.', l, 4.6, 0.12);
      },
    };
  },

  // ---------- 3. highlight + comment, synthetic chat ----------
  chatDemo(id, o = {}) {
    const html = `<div class="win" id="${id}-w" style="left:300px;top:150px;width:1320px;height:520px"><div class="bar"><i></i><i></i><i></i><span style="margin-left:14px">Any AI chat</span></div>
      <div class="chat"><div class="you">What does the evidence say about sleep and memory?</div>
      <p>The evidence is strongest for a division of labour between sleep stages. <span class="hl" id="${id}-1" style="display:inline-block">Slow-wave sleep supports declarative memory consolidation</span>, while REM sleep matters more for procedural memory. A recent meta-analysis found <span class="hl" id="${id}-2" style="display:inline-block">effect size d = 0.62 across 14 studies</span>, with moderate heterogeneity. Higher <span class="hl" id="${id}-3" style="display:inline-block">sleep spindle density</span> after learning predicts better retention the next day.</p></div></div>
      <div class="tb" id="${id}-tb" style="opacity:0"><div class="dot" style="background:var(--y)"></div><div class="dot" style="background:var(--g)"></div><div class="dot" style="background:var(--b)"></div><div class="dot" style="background:var(--p)"></div></div>
      <div class="keys" id="${id}-k" style="left:0;right:0;justify-content:center;top:830px;opacity:0"><div class="key" id="${id}-kk"></div></div>
      <div class="badge" id="${id}-bd" style="opacity:0"><svg width="18" height="18" viewBox="0 0 16 16"><path d="M2 3h12v8H7l-3 3v-3H2z" fill="#fff"/></svg></div>
      <div class="pop" id="${id}-pop" style="opacity:0"><div class="q">effect size d = 0.62 across 14 studies</div><div class="ta" id="${id}-ta"></div></div>
      <div class="cap" id="${id}-cap"></div>`;
    const sel = (l, el, a, b, color, keyAt, keyLabel) => {
      // returns background for span el given time
      const wipe = E.io(seg(l, a, b));
      if (l >= keyAt + 0.12) return bgHl(color, E.out(seg(l, keyAt + 0.12, keyAt + 0.55)));
      return wipe > 0 ? `linear-gradient(90deg,rgba(80,140,255,.55) ${wipe * 100}%,transparent 0)` : 'rgba(0,0,0,0)';
    };
    return {
      html,
      fn(l) {
        const w = $(id + '-w'); w.style.opacity = E.out(seg(l, 0, 0.7));
        const g = (n) => $(`${id}-${n}`);
        const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; };
        const r1 = R(g(1)), r2 = R(g(2)), r3 = R(g(3));
        // timeline
        const T1 = [1.2, 2.6, 3.4], T2 = [5.4, 6.6, 7.4], T3 = [9.2, 10.2, 11.0];
        g(1).style.background = sel(l, g(1), T1[0], T1[1], 'g', T1[2]);
        g(2).style.background = sel(l, g(2), T2[0], T2[1], 'y', T2[2]);
        g(3).style.background = sel(l, g(3), T3[0], T3[1], 'b', T3[2]);
        [[g(1), T1[2]], [g(2), T2[2]], [g(3), T3[2]]].forEach(([el, at]) => { const k = seg(l, at + 0.12, at + 0.7); el.style.transform = `scale(${1 + 0.05 * Math.sin(k * Math.PI)})`; });
        // toolbar: shows between selection end and key press
        const tb = $(id + '-tb'); const tbs = [[T1, r1], [T2, r2], [T3, r3]];
        let tbOn = 0, tbr = r1;
        for (const [T, r] of tbs) { const k = E.spring(seg(l, T[1] + 0.05, T[1] + 0.55)) * (1 - seg(l, T[2] + 0.1, T[2] + 0.35)); if (k > tbOn) { tbOn = k; tbr = r; } }
        tb.style.opacity = clamp(tbOn, 0, 1); tb.style.left = tbr.l + 'px'; tb.style.top = tbr.t - 74 + 'px'; tb.style.transform = `scale(${0.7 + 0.3 * clamp(tbOn, 0, 1.15)})`;
        // key caps
        const kk = $(id + '-kk'); const k$ = $(id + '-k');
        const keyAt = [[T1[2], '2'], [T2[2], '1'], [T3[2], 'C']];
        let label = '', on = 0;
        for (const [at, lab] of keyAt) { const k = seg(l, at - 0.3, at - 0.05) * (1 - seg(l, at + 0.5, at + 0.75)); if (k > on) { on = k; label = lab; } }
        kk.textContent = label; k$.style.opacity = on; kk.style.borderBottomWidth = keyAt.some(([at]) => l > at && l < at + 0.16) ? '2px' : '7px';
        kk.style.transform = keyAt.some(([at]) => l > at && l < at + 0.16) ? 'translateY(5px)' : 'none';
        // cursor
        const pts = [[0.4, 1500, 700], [T1[0], r1.l + 2, r1.t + 22], [T1[1], r1.r - 2, r1.t + 22], [T1[2] + 0.4, r1.r + 30, r1.t + 90], [T2[0] - 0.2, r2.l + 2, r2.t + 22], [T2[0], r2.l + 2, r2.t + 22], [T2[1], r2.r - 2, r2.t + 22], [T2[2] + 0.4, r2.r + 30, r2.t + 90], [T3[0] - 0.2, r3.l + 2, r3.t + 22], [T3[0], r3.l + 2, r3.t + 22], [T3[1], r3.r - 2, r3.t + 22], [T3[2] + 0.6, r3.r + 40, r3.t + 120]];
        const [cx, cy] = path(l, pts);
        cursor(l > 0.5 && l < 11.6, cx, cy);
        // comment
        const pop = $(id + '-pop'); const pk = E.spring(seg(l, 11.3, 11.9)); pop.style.opacity = clamp(pk, 0, 1);
        pop.style.left = r3.l - 120 + 'px'; pop.style.top = r3.b + 20 + 'px'; pop.style.transform = `scale(${0.85 + 0.15 * clamp(pk, 0, 1.1)})`;
        pop.querySelector('.q').textContent = 'sleep spindle density';
        typed($(id + '-ta'), 'cite this in section 2', l, 12.3, 20);
        const bd = $(id + '-bd'); const bk = E.back(seg(l, 15.2, 15.7)); bd.style.opacity = clamp(bk, 0, 1); bd.style.left = r3.r + 8 + 'px'; bd.style.top = r3.t + (r3.h - 34) / 2 + 'px'; bd.style.transform = `scale(${clamp(bk, 0, 1.2)})`;
        pop.style.opacity = clamp(pk, 0, 1) * (1 - seg(l, 15.1, 15.5));
        // captions
        const cap = $(id + '-cap');
        const c = l < 4.4 ? ['Select. Press a key.', 'Four colours, one keystroke.'] : l < 8.4 ? ['Highlighted. Permanently.', 'Stored in your browser, restored every time the chat loads.'] : ['Add a note with C.', 'Comments live with the highlight.'];
        const sw = cap.dataset.c !== c[0]; if (sw) { cap.dataset.c = c[0]; cap.innerHTML = `${c[0]}<small>${c[1]}</small>`; }
      },
    };
  },

  // ---------- 4. colours with meaning ----------
  colours(id) {
    const names = [['Yellow', 'Claim', 'y'], ['Green', 'Evidence', 'g'], ['Blue', 'Term', 'b'], ['Pink', 'To check', 'p']];
    return {
      html: `<div class="big" style="top:150px;font-size:66px" id="${id}-a"></div>
        <div id="${id}-row" style="position:absolute;left:0;right:0;top:440px;display:flex;justify-content:center;gap:34px">` +
        names.map((n, i) => `<div class="pill" id="${id}-p${i}"><i style="background:var(--${n[2]})"></i><span id="${id}-t${i}">${n[0]}</span></div>`).join('') +
        `</div><div class="cap" id="${id}-cap">Colours with meaning.<small>Names appear in the panel, filters, Markdown and shared pages.</small></div>`,
      fn(l) {
        words($(id + '-a'), 'Colours are just labels. Make them mean something.', l, 0.2, 0.07);
        names.forEach((n, i) => {
          const p = $(`${id}-p${i}`); const k = E.back(seg(l, 0.8 + i * 0.2, 1.4 + i * 0.2)); p.style.opacity = clamp(k, 0, 1); p.style.transform = `translateY(${(1 - k) * 40}px)`;
          const sw = seg(l, 3 + i * 0.35, 3.5 + i * 0.35); const t = $(`${id}-t${i}`); t.textContent = sw > 0.5 ? n[1] : n[0]; t.style.opacity = sw > 0.5 ? E.out((sw - 0.5) * 2) : 1 - sw * 2;
          p.style.boxShadow = sw > 0.5 && sw < 1 ? `0 0 0 ${Math.sin(sw * Math.PI) * 10}px rgba(201,100,66,.35)` : 'none';
        });
      },
    };
  },

  // ---------- generic real-screenshot scene ----------
  shot(id, c) {
    // c: img, vw, vh, H, from(Wd,Hd)->pose, steps:[{a,b,to(Wd,Hd)->pose}], rings:[{name,i,a,b,label,lx,ly}], cap:[title,sub], keys:[{label,a,b}], capAt
    const H = c.H || 800; const ar = c.vw / c.vh; const Wd = Math.round(H * ar);
    const left = c.left != null ? c.left : Math.round((1920 - Wd) / 2);
    const rings = (c.rings || []).map((r, i) => `<div class="ring" id="${id}-r${i}"></div><div class="tag" id="${id}-g${i}">${r.label || ''}</div>`).join('');
    return {
      html: `<div class="shotwin" id="${id}-win" style="left:${left}px;top:${c.top != null ? c.top : 70}px;width:${Wd}px;height:${H}px"><div class="cam" id="${id}-cam" style="width:${Wd}px"><img src="${IMG}${c.img}"><div id="${id}-ov"></div>${rings}</div></div>` +
        (c.keys ? `<div class="keys" id="${id}-k" style="left:0;right:0;justify-content:center;top:${c.keyTop || 860}px;opacity:0"></div>` : '') +
        `<div class="cap" id="${id}-cap"></div>`,
      fn(l) {
        const win = $(id + '-win'), cam = $(id + '-cam');
        win.style.opacity = E.out(seg(l, 0, 0.6)); win.style.transform = `scale(${0.96 + 0.04 * E.out(seg(l, 0, 0.7))})`;
        const full = { s: 1, x: Wd / 2, y: (Wd / ar) / 2 };
        let pose = c.from ? c.from(Wd, Wd / ar) : full;
        let prev = pose;
        for (const st of c.steps || []) {
          const to = st.to(Wd, Wd / ar);
          const k = E.io(seg(l, st.a, st.b));
          prev = { s: lerp(prev.s, to.s, k), x: lerp(prev.x, to.x, k), y: lerp(prev.y, to.y, k) };
        }
        const W = win.offsetWidth, Hh = win.offsetHeight;
        const Hd = Wd / ar, hx = W / (2 * prev.s), hy = Hh / (2 * prev.s);
        const px = clamp(prev.x, hx, Wd - hx), py = clamp(prev.y, hy, Hd - hy);
        cam.style.transform = `translate(${W / 2 - px * prev.s}px,${Hh / 2 - py * prev.s}px) scale(${prev.s})`;
        (c.rings || []).forEach((r, i) => {
          const b = box(r.name, Wd, r.i); const el = $(`${id}-r${i}`), tg = $(`${id}-g${i}`);
          const on = seg(l, r.a, r.a + 0.45) * (1 - seg(l, r.b - 0.3, r.b));
          ring(el, b, r.a, l, 8); el.style.opacity = on;
          tg.style.opacity = on; tg.style.left = b.x + (r.lx != null ? r.lx : 0) + 'px'; tg.style.top = b.y + b.h + 18 + (r.ly || 0) + 'px'; tg.style.transform = `translateY(${(1 - on) * 10}px)`;
          if (!r.label) tg.style.display = 'none';
        });
        if (c.keys) {
          const kb = $(id + '-k'); let cur = null;
          for (const k of c.keys) if (l >= k.a && l < k.b) cur = k;
          kb.innerHTML = cur ? [].concat(cur.label).map((x) => `<div class="key">${x}</div>`).join('') : '';
          kb.style.opacity = cur ? E.out(seg(l, cur.a, cur.a + 0.2)) * (1 - seg(l, cur.b - 0.2, cur.b)) : 0;
        }
        const cap = $(id + '-cap'); const ct = (c.capAt ? c.capAt.filter((x) => l >= x.a).pop() : null) || { t: c.cap };
        const key = ct.t[0]; if (cap.dataset.c !== key) { cap.dataset.c = key; cap.innerHTML = `${ct.t[0]}<small>${ct.t[1] || ''}</small>`; }
        cap.style.opacity = E.out(seg(l, 0.3, 0.9));
        if (c.extra) c.extra(l, { Wd, cam, win });
      },
    };
  },

  // ---------- come back later ----------
  later(id) {
    return {
      html: `<div class="win" id="${id}-w" style="left:300px;top:150px;width:1320px;height:520px"><div class="bar"><i></i><i></i><i></i><span style="margin-left:14px">Any AI chat</span></div>
        <div class="chat"><div class="you">What does the evidence say about sleep and memory?</div>
        <p>The evidence is strongest for a division of labour between sleep stages. <span class="hl" id="${id}-1">Slow-wave sleep supports declarative memory consolidation</span>, while REM sleep matters more for procedural memory. A recent meta-analysis found <span class="hl" id="${id}-2">effect size d = 0.62 across 14 studies</span>, with moderate heterogeneity. Higher <span class="hl" id="${id}-3">sleep spindle density</span> after learning predicts better retention the next day.</p></div></div>
        <div class="badge" id="${id}-bd" style="opacity:0"><svg width="18" height="18" viewBox="0 0 16 16"><path d="M2 3h12v8H7l-3 3v-3H2z" fill="#fff"/></svg></div>
        <div id="${id}-later" style="position:absolute;inset:0;background:var(--bg);display:grid;place-items:center;font-size:104px;font-weight:700;letter-spacing:-.025em"><div>3 days later<span class="acc">.</span></div></div>
        <div class="cap" id="${id}-cap">Come back any time. It is all still there.<small>Highlights and comments are restored whenever the chat loads.</small></div>`,
      fn(l) {
        $(id + '-later').style.opacity = 1 - E.out(seg(l, 1.5, 2.1));
        [['1', 'g', 2.4], ['2', 'y', 2.8], ['3', 'b', 3.2]].forEach(([n, c, at]) => { $(`${id}-${n}`).style.background = bgHl(c, E.out(seg(l, at, at + 0.45))); });
        const r = $(`${id}-3`).getBoundingClientRect(); const bd = $(id + '-bd'); const k = E.back(seg(l, 3.9, 4.4));
        bd.style.opacity = clamp(k, 0, 1); bd.style.left = r.right + 8 + 'px'; bd.style.top = r.top + (r.height - 34) / 2 + 'px'; bd.style.transform = `scale(${clamp(k, 0, 1.2)})`;
      },
    };
  },

  // ---------- who it is for ----------
  who(id) {
    const lines = [['Researchers', 'synthesising papers and arguments'], ['Engineers', 'debugging and designing with AI'], ['Analysts', 'checking numbers and sources'], ['Writers and founders', 'who think in long conversations']];
    return {
      html: `<div class="big" style="top:130px;font-size:64px" id="${id}-a"></div>` + lines.map((x, i) => `<div id="${id}-l${i}" style="position:absolute;left:0;right:0;top:${340 + i * 130}px;text-align:center;font-size:54px;font-weight:650"><span class="acc">${x[0]}</span> <span class="mut" style="font-weight:500">${x[1]}</span></div>`).join(''),
      fn(l) {
        words($(id + '-a'), 'Built for work beyond the surface chat.', l, 0.2, 0.08);
        lines.forEach((x, i) => reveal($(`${id}-l${i}`), l, 1.3 + i * 0.6, 0.7, 26));
      },
    };
  },

  // ---------- end card ----------
  end(id, o = {}) {
    return {
      html: `<div class="big" style="top:300px;font-size:150px;font-weight:800" id="${id}-n"></div>
        <div class="big acc" style="top:520px;font-size:48px;font-weight:650" id="${id}-t"></div>
        <div class="big mut" style="top:640px;font-size:32px;font-weight:500" id="${id}-p"></div>
        <div class="big" style="top:800px;font-size:34px;font-weight:600;color:var(--ink)" id="${id}-g"></div>
        <div class="big" style="top:980px;font-size:21px;font-weight:400;color:#7d786f" id="${id}-d"></div>`,
      fn(l) {
        const n = $(id + '-n'); n.textContent = NAME; const k = E.spring(seg(l, 0.1, 0.9)); n.style.opacity = clamp(k, 0, 1); n.style.transform = `scale(${0.85 + 0.15 * clamp(k, 0, 1.1)})`;
        $(id + '-t').textContent = 'Turn your AI chats into a searchable, annotated knowledge base.'; reveal($(id + '-t'), l, 0.9);
        $(id + '-p').textContent = 'Open source · MIT · Chrome · Edge · Brave · Firefox'; reveal($(id + '-p'), l, 1.4);
        $(id + '-g').textContent = o.cta || 'Free and open source on GitHub'; reveal($(id + '-g'), l, 1.9);
        $(id + '-d').textContent = 'Works with claude.ai and chatgpt.com. Independent project, not affiliated with or endorsed by Anthropic or OpenAI.'; reveal($(id + '-d'), l, 2.3);
      },
    };
  },
};
