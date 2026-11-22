/* Aere website motion. Vanilla JS, no dependencies, no network.
   - A tiny "pen" that turns lines, boxes, loops and squiggles into hand-drawn SVG paths (seeded noise, so the
     wobble is stable between loads, like the app's ScribblePen).
   - The untangle (a port of ScribbleUntangle.points in KeyboardDictation/Scribble/ScribbleAnimations.swift).
   - Scenes that draw themselves when scrolled into view, the dictation demo, the Duo fold, page "redraw".
   Under prefers-reduced-motion everything is put straight into its final state. */
(function () {
  'use strict';
  window.__aere = 1;

  var doc = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';

  function store(op, key, val) {
    try {
      if (op === 'get') return sessionStorage.getItem(key);
      if (op === 'set') sessionStorage.setItem(key, val);
      if (op === 'del') sessionStorage.removeItem(key);
    } catch (e) { /* private mode etc.: behave as a first visit */ }
    return null;
  }

  /* ---------------- Noise & easing ---------------- */

  function hash(n, s) {
    var x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((s + 0x632be5ab) | 0, 0xc2b2ae35);
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967295 * 2 - 1;
  }
  function noise(x, s) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash(i, s) * (1 - u) + hash(i + 1, s) * u;
  }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function easeOut(x) { return 1 - (1 - x) * (1 - x); }
  function seg(t, a, d) { return smooth(clamp((t - a) / d)); }
  function lin(t, a, d) { return clamp((t - a) / d); }

  /* ---------------- Pen: geometry ---------------- */

  function r1(n) { return Math.round(n * 10) / 10; }
  function poly(p) {
    var d = 'M' + r1(p[0][0]) + ' ' + r1(p[0][1]);
    for (var i = 1; i < p.length; i++) d += 'L' + r1(p[i][0]) + ' ' + r1(p[i][1]);
    return d;
  }
  /* Smooth curve through points (Catmull-Rom as cubic Béziers). */
  function curve(p) {
    if (p.length < 3) return poly(p);
    var d = 'M' + r1(p[0][0]) + ' ' + r1(p[0][1]);
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], a = p[i], b = p[i + 1], p3 = p[i + 2] || b;
      d += 'C' + r1(a[0] + (b[0] - p0[0]) / 6) + ' ' + r1(a[1] + (b[1] - p0[1]) / 6) + ' ' +
        r1(b[0] - (p3[0] - a[0]) / 6) + ' ' + r1(b[1] - (p3[1] - a[1]) / 6) + ' ' + r1(b[0]) + ' ' + r1(b[1]);
    }
    return d;
  }
  /* Resample a polyline every `step` units, keeping arc length in [2]. */
  function along(pts, step) {
    var out = [], s = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      var n = Math.max(1, Math.ceil(L / step));
      for (var k = 0; k < n; k++) { var u = k / n; out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, s + L * u]); }
      s += L;
    }
    var z = pts[pts.length - 1];
    out.push([z[0], z[1], s]);
    return out;
  }
  /* Push each point along its normal by two octaves of noise: a slow bend plus a little tremor. */
  function wob(dense, seed, amp, wl) {
    wl = wl || 46;
    return dense.map(function (p, i) {
      var a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
      var nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1;
      var o = amp * (noise(p[2] / wl, seed) * 0.78 + noise(p[2] / wl * 2.7 + 17.3, seed + 101) * 0.22);
      return [p[0] + nx / l * o, p[1] + ny / l * o];
    });
  }
  function rough(pts, seed, amp, step) { return curve(wob(along(pts, step || 9), seed, amp == null ? 0.9 : amp)); }

  var pen = {
    line: function (x1, y1, x2, y2, seed, amp, bow) {
      var pts = [], n = 6;
      for (var i = 0; i <= n; i++) {
        var u = i / n, b = (bow || 0) * Math.sin(u * Math.PI);
        var nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
        pts.push([x1 + (x2 - x1) * u + nx / l * b, y1 + (y2 - y1) * u + ny / l * b]);
      }
      return rough(pts, seed, amp == null ? 0.7 : amp);
    },
    /* Rounded rectangle drawn in one stroke that overshoots its start, like a marker. */
    box: function (x, y, w, h, r, seed, amp) {
      r = Math.min(r, w / 2, h / 2);
      var p = [[x + r + 3, y + 0.6], [x + w - r, y]];
      function arc(cx, cy, a0) { for (var k = 1; k <= 4; k++) { var a = a0 + k / 4 * Math.PI / 2; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } }
      arc(x + w - r, y + r, -Math.PI / 2); p.push([x + w, y + h - r]);
      arc(x + w - r, y + h - r, 0); p.push([x + r, y + h]);
      arc(x + r, y + h - r, Math.PI / 2); p.push([x, y + r]);
      arc(x + r, y + r, Math.PI); p.push([x + r + Math.min(16, w * 0.3), y - 1.4]);
      return rough(p, seed, amp == null ? 0.9 : amp);
    },
    /* Exact rounded rect (fills, shadows). */
    rect: function (x, y, w, h, r) {
      return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
        'V' + (y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) +
        'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) + 'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
    },
    /* A hand-drawn loop (circling something): a little more than one turn, slightly spiralling. */
    loop: function (cx, cy, rx, ry, seed, turns, start) {
      turns = turns || 1.14; start = start == null ? -2.3 : start;
      var p = [], end = start + turns * Math.PI * 2, tilt = -0.06;
      for (var t = start; t <= end; t += 0.07) {
        var k = 1 + 0.05 * noise(t * 0.9, seed) - 0.05 * (t - start) / (Math.PI * 2);
        var ex = rx * k * Math.cos(t), ey = ry * k * Math.sin(t);
        p.push([cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)]);
      }
      return curve(p);
    },
    /* Cursive squiggle standing in for a handwritten word. */
    word: function (x1, x2, y, h, seed) {
      var n = Math.max(2, Math.round((x2 - x1) / (h * 0.95))), T = n * Math.PI * 2, p = [];
      for (var t = 0; t <= T + 1e-6; t += 0.22) {
        var amp = 0.85 + 0.25 * noise(t * 0.4, seed);
        p.push([x1 + (x2 - x1) * t / T - h * 0.24 * Math.sin(t), y - h * 0.5 * (1 - Math.cos(t)) * amp]);
      }
      return curve(p);
    },
    /* Scribble-out zig-zag. */
    zig: function (x, y, w, h, n, seed) {
      var p = [];
      for (var i = 0; i <= n; i++) {
        var j = hash(i, seed);
        p.push([x + w * i / n + j * w / n * 0.25, (i % 2 ? y + h : y) + j * h * 0.12]);
      }
      return poly(p);
    },
    curve: function (pts, seed, amp) { return rough(pts, seed || 1, amp == null ? 0.5 : amp, 7); },
    head: function (x, y, ang, len) {
      var a1 = ang + Math.PI * 0.82, a2 = ang - Math.PI * 0.82;
      return 'M' + r1(x + len * Math.cos(a1)) + ' ' + r1(y + len * Math.sin(a1)) + 'L' + r1(x) + ' ' + r1(y) +
        'L' + r1(x + len * Math.cos(a2)) + ' ' + r1(y + len * Math.sin(a2));
    },
    cloud: function (cx, cy, rx, ry, seed) {
      var p = [], bumps = 6;
      for (var t = -Math.PI; t <= Math.PI + 0.4; t += 0.05) {
        var bottom = Math.sin(t) > 0.35;
        var k = 1 + (bottom ? 0.03 : 0.2 * Math.abs(Math.sin(t * bumps / 2))) + 0.03 * noise(t * 2, seed);
        p.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t) * (bottom ? 0.8 : 1)]);
      }
      return curve(p);
    }
  };

  /* ---------------- Pen: SVG output ---------------- */

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  /* A drawable stroke. o: { c: 'red'|'faint'|'thin', w, d (delay s), t (duration s), cls, parent } */
  function ink(svg, d, o) {
    o = o || {};
    var p = el('path', { d: d, 'class': 'ink ' + (o.c || '') + ' ' + (o.cls == null ? 'draw' : o.cls), pathLength: 1 }, o.parent || svg);
    if (o.d != null) p.style.setProperty('--d', o.d.toFixed(2) + 's');
    if (o.t != null) p.style.setProperty('--t', o.t.toFixed(2) + 's');
    if (o.w) p.style.strokeWidth = o.w;
    return p;
  }
  function shape(svg, d, cls, delay, parent) {
    var p = el('path', { d: d, 'class': cls + ' pop' }, parent || svg);
    if (delay != null) p.style.setProperty('--d', delay.toFixed(2) + 's');
    return p;
  }
  function text(svg, x, y, s, o) {
    o = o || {};
    var t = el('text', { x: x, y: y, 'class': (o.cls || '') + ' pop', 'font-size': o.size || 14, 'text-anchor': o.anchor || 'start' }, o.parent || svg);
    t.textContent = s;
    if (o.d != null) t.style.setProperty('--d', o.d.toFixed(2) + 's');
    return t;
  }
  /* Card on paper: checker shadow + fill fade in, then the outline draws on. */
  function card(svg, x, y, w, h, r, seed, d, o) {
    o = o || {};
    var off = o.off == null ? 5 : o.off;
    shape(svg, pen.rect(x + off, y + off, w, h, r), 'fill-chk', d, o.parent);
    shape(svg, pen.rect(x, y, w, h, r), 'fill-card', d, o.parent);
    return ink(svg, pen.box(x, y, w, h, r, seed), { d: d, t: o.t || 0.7, w: o.w, parent: o.parent });
  }

  /* ---------------- The untangle (port of ScribbleUntangle) ---------------- */

  function untangle(u, mess, seed, spin, boil) {
    var x0 = 236, adv = 21, d0 = 214, tEnd = 5 * Math.PI, mid = 512, pts = [];
    for (var t = 0; t <= tEnd + 1e-4; t += 0.05) {
      var s = t / tEnd;
      var pulled = smooth(clamp(u * 1.8 - (1 - s) * 0.8));
      var m = mess * (1 - pulled);
      var d = d0 * Math.pow(1 - s, 0.55) * (1 - pulled);
      d *= 1 + m * 0.22 * noise(t * 0.55, seed);
      var a = t + spin;
      var x = x0 + adv * t - d * Math.sin(a) * 0.42 + m * 18 * noise(t * 0.8, seed + 7);
      var y = mid - d * Math.cos(a) + m * 12 * noise(t * 0.9, seed + 13);
      if (boil != null) {
        x += 4 * (1 - pulled) * noise(t * 1.9, boil * 31 + 5);
        y += 4 * (1 - pulled) * noise(t * 2.3, boil * 37 + 9);
      }
      pts.push([x, y]);
    }
    pts.push([724, mid]);
    return poly(pts);
  }

  /* ---------------- Drawings ---------------- */

  var ART = {
    divider: function (s) {
      var p = [], T = 6 * Math.PI;
      for (var t = 0; t <= T; t += 0.08) {
        var k = t / T, r = 25 * Math.pow(1 - k, 1.15);
        p.push([40 + 300 * k - r * 1.9 * Math.sin(t) + 3 * noise(t, 4), 30 - r * 0.92 * Math.cos(t) + 2 * noise(t * 0.7, 8)]);
      }
      p.push([600, 30.5]);
      ink(s, curve(p), { d: 0.1, t: 1.5, w: 3.2 });
      shape(s, pen.rect(611, 13, 6, 36, 1), 'fill-red', 1.55);
    },

    'note-arrow': function (s) {
      ink(s, pen.curve([[86, 8], [58, 6], [30, 20], [10, 46]], 3, 0.4), { d: 1.0, t: 0.5, w: 2 });
      ink(s, pen.head(10, 46, Math.atan2(26, -20), 10), { d: 1.45, t: 0.2, w: 2 });
    },

    mic: function (s) {
      ink(s, pen.box(14, 4, 16, 30, 8, 5, 0.4), { d: 0.1, t: 0.5 });
      ink(s, pen.curve([[6, 24], [8, 38], [22, 44], [36, 38], [38, 24]], 6, 0.3), { d: 0.4, t: 0.4 });
      ink(s, pen.line(22, 44, 22, 55, 7, 0.2), { d: 0.7, t: 0.2 });
      ink(s, pen.line(13, 57, 31, 57, 8, 0.3), { d: 0.85, t: 0.2 });
      el('path', { d: 'M42 13 C47 18 47 28 42 33', 'class': 'ink red wave' }, s);
      el('path', { d: 'M2 13 C-3 18 -3 28 2 33', 'class': 'ink red wave' }, s);
    },

    arrow: function (s) {
      ink(s, pen.curve([[14, 3], [10, 20], [20, 38], [38, 50]], 2, 0.4), { cls: 'seq', t: 0.4, w: 2.4 });
      ink(s, pen.head(38, 50, Math.atan2(12, 18), 11), { cls: 'seq', d: 0.35, t: 0.15, w: 2.4 });
    },

    privacy: function (s) {
      card(s, 38, 22, 104, 196, 18, 11, 0, { t: 0.8, w: 2.4 });
      ink(s, pen.line(76, 36, 104, 36, 2, 0.3), { d: 0.5, t: 0.2, w: 3 });
      [10, 18, 26, 14, 8].forEach(function (h, i) {
        ink(s, pen.line(64 + i * 10, 74 - h / 2, 64 + i * 10, 74 + h / 2, 20 + i, 0.2), { d: 0.6 + i * 0.05, t: 0.2, w: 3 });
      });
      ink(s, pen.word(54, 124, 114, 10, 3), { d: 0.85, t: 0.5, w: 1.8 });
      ink(s, pen.word(54, 100, 136, 10, 8), { d: 1.15, t: 0.4, w: 1.8 });
      shape(s, pen.rect(105, 124, 4, 17, 1), 'fill-red', 1.5);
      for (var r = 0; r < 2; r++) for (var c = 0; c < 6; c++) {
        ink(s, pen.box(50 + c * 14.5, 164 + r * 17, 11, 12, 3, 40 + r * 6 + c, 0.3), { c: 'thin', d: 0.7 + (r * 6 + c) * 0.03, t: 0.25 });
      }
      ink(s, pen.cloud(288, 76, 42, 24, 5), { d: 0.9, t: 0.8, w: 2.4 });
      [[156, 108], [170, 103], [184, 98], [198, 94]].forEach(function (pt, i) {
        shape(s, 'M' + pt[0] + ' ' + pt[1] + 'm-2.4 0a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0', 'fill-ink', 1.5 + i * 0.12);
      });
      ink(s, pen.line(212, 82, 216, 104, 9, 0.3), { d: 2.0, t: 0.15, w: 2.6 });
      ink(s, pen.line(258, 52, 320, 104, 12, 0.6), { c: 'red', d: 2.2, t: 0.3, w: 3.6 });
      ink(s, pen.line(320, 50, 258, 106, 13, 0.6), { c: 'red', d: 2.45, t: 0.3, w: 3.6 });
      ink(s, pen.loop(90, 120, 82, 118, 7, 1.12, -2.0), { c: 'red', d: 2.75, t: 0.9, w: 3.2 });
      text(s, 196, 214, 'stays here', { cls: 'hand red', size: 19, d: 3.5 });
      ink(s, pen.curve([[192, 206], [180, 200], [170, 190]], 4, 0.3), { c: 'red', d: 3.55, t: 0.25, w: 2 });
    },

    duo: function (s) {
      var dev = el('g', { 'class': 'device' }, s);
      var left = el('g', {}, dev);
      var leftShape = 'M180 20H46A16 16 0 0 0 30 36V214A16 16 0 0 0 46 230H180Z';
      shape(s, 'M185 25H51A16 16 0 0 0 35 41V219A16 16 0 0 0 51 235H185Z', 'fill-chk', 0, left);
      shape(s, leftShape, 'fill-card', 0, left);
      ink(s, rough([[180, 20], [46, 20], [34, 24], [30, 36], [30, 214], [34, 226], [46, 230], [180, 230]], 31, 0.8), { d: 0, t: 0.8, w: 2.4, parent: left });
      ink(s, pen.word(46, 160, 52, 9, 2), { d: 0.6, t: 0.5, w: 1.7, parent: left });
      ink(s, pen.word(46, 120, 72, 9, 5), { d: 0.9, t: 0.4, w: 1.7, parent: left });
      var kbL = el('g', { 'class': 'split-kb' }, left);
      var r, c;
      for (r = 0; r < 3; r++) for (c = 0; c < 5; c++) ink(s, pen.box(44 + c * 25 + r * 4, 150 + r * 24, 20, 17, 4, 60 + r * 5 + c, 0.35), { c: 'thin', d: 0.5 + (r * 5 + c) * 0.025, t: 0.25, parent: kbL });

      var right = el('g', { 'class': 'half-r' }, dev);
      var front = el('g', { 'class': 'front' }, right);
      shape(s, 'M175 25H319A16 16 0 0 1 335 41V219A16 16 0 0 1 319 235H175Z', 'fill-chk', 0, front);
      shape(s, 'M180 20H314A16 16 0 0 1 330 36V214A16 16 0 0 1 314 230H180Z', 'fill-card', 0, front);
      ink(s, rough([[180, 20], [314, 20], [326, 24], [330, 36], [330, 214], [326, 226], [314, 230], [180, 230]], 37, 0.8), { d: 0.1, t: 0.8, w: 2.4, parent: front });
      ink(s, pen.word(194, 290, 52, 9, 9), { d: 0.75, t: 0.45, w: 1.7, parent: front });
      shape(s, pen.rect(296, 40, 3.5, 15, 1), 'fill-red', 1.2, front);
      for (r = 0; r < 3; r++) for (c = 0; c < 5; c++) ink(s, pen.box(196 + c * 25 - r * 4, 150 + r * 24, 20, 17, 4, 80 + r * 5 + c, 0.35), { c: 'thin', d: 0.6 + (r * 5 + c) * 0.025, t: 0.25, parent: front });

      /* The outer screen: drawn mirrored so it reads right once the half flips over the hinge. */
      var back = el('g', { 'class': 'back' }, right);
      el('path', { d: 'M185 25H319A16 16 0 0 1 335 41V219A16 16 0 0 1 319 235H185Z', 'class': 'fill-chk', transform: 'translate(-10 0)' }, back);
      el('path', { d: 'M180 20H314A16 16 0 0 1 330 36V214A16 16 0 0 1 314 230H180Z', 'class': 'fill-card' }, back);
      el('path', { d: rough([[180, 20], [314, 20], [326, 24], [330, 36], [330, 214], [326, 226], [314, 230], [180, 230]], 41, 0.8), 'class': 'ink', style: 'stroke-width:2.4' }, back);
      el('path', { d: pen.word(214, 312, 52, 9, 12), 'class': 'ink', style: 'stroke-width:1.7' }, back);
      el('path', { d: pen.word(250, 312, 72, 9, 14), 'class': 'ink', style: 'stroke-width:1.7' }, back);
      el('path', { d: pen.rect(240, 62, 3.5, 15, 1), 'class': 'fill-red' }, back);
      for (r = 0; r < 3; r++) for (c = 0; c < 10; c++) {
        var w = 11, x = 322 - (c + 1) * w - c * 2.4 - r * 6;
        if (r === 2 && (c < 1 || c > 8)) continue;
        el('path', { d: pen.box(x, 156 + r * 22, w, 16, 3, 100 + r * 10 + c, 0.25), 'class': 'ink thin' }, back);
      }
      ink(s, pen.line(180, 26, 180, 224, 3, 0.4), { c: 'faint', d: 0.9, t: 0.5, w: 1.6, parent: dev });
    },

    translate: function (s) {
      card(s, 8, 8, 108, 50, 18, 3, 0, { t: 0.6 });
      ink(s, pen.curve([[30, 58], [24, 70], [16, 78], [40, 64]], 2, 0.3), { d: 0.5, t: 0.3 });
      text(s, 62, 41, 'hello!', { cls: 'hand', size: 22, anchor: 'middle', d: 0.6 });
      ink(s, pen.curve([[122, 30], [140, 36], [150, 56], [150, 70]], 4, 0.3), { d: 0.9, t: 0.35 });
      ink(s, pen.head(150, 70, Math.PI / 2, 9), { d: 1.2, t: 0.15 });
      card(s, 92, 80, 120, 42, 12, 6, 1.0, { t: 0.6 });
      text(s, 172, 108, '¡hola!', { size: 19, anchor: 'end', d: 1.5 });
      shape(s, pen.rect(178, 92, 3, 19, 1), 'fill-red', 1.6);
    },

    swipe: function (s) {
      var rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], kw = 19, gap = 2.6, x0 = 3.3, ctr = {};
      rows.forEach(function (row, r) {
        var ox = x0 + r * (kw + gap) / 2 + (r === 2 ? (kw + gap) : 0);
        for (var i = 0; i < row.length; i++) {
          var x = ox + i * (kw + gap), y = 6 + r * 24;
          ink(s, pen.box(x, y, kw, kw, 4, r * 10 + i + 3, 0.3), { c: 'thin', d: (r * 10 + i) * 0.012, t: 0.25 });
          text(s, x + kw / 2, y + 13.5, row[i], { cls: 'dim', size: 10, anchor: 'middle', d: 0.3 });
          ctr[row[i]] = [x + kw / 2, y + kw / 2];
        }
      });
      var h = ctr.h, e = ctr.e, l = ctr.l, o = ctr.o;
      ink(s, curve([h, [h[0] - 10, h[1] - 8], e, [e[0] + 30, e[1] + 14], [l[0] - 6, l[1] + 4], l, [l[0] + 6, l[1] - 4], [o[0] - 4, o[1] + 6], o]), { c: 'red', d: 0.55, t: 1.0, w: 3.4 });
      card(s, 76, 92, 68, 28, 14, 9, 1.4, { t: 0.4, off: 3 });
      text(s, 110, 111, 'hello', { size: 15, anchor: 'middle', d: 1.65 });
    },

    learn: function (s) {
      text(s, 16, 44, 'teh', { size: 26, d: 0 });
      ink(s, pen.line(12, 35, 62, 33, 4, 0.5), { c: 'red', d: 0.35, t: 0.25, w: 3 });
      ink(s, pen.line(74, 34, 102, 34, 2, 0.3), { d: 0.65, t: 0.2 });
      ink(s, pen.head(102, 34, 0, 8), { d: 0.8, t: 0.12 });
      text(s, 114, 44, 'the', { size: 26, d: 0.9 });
      text(s, 22, 104, 'Aere', { size: 26, d: 1.1 });
      ink(s, pen.loop(50, 95, 44, 22, 9), { c: 'red', d: 1.3, t: 0.6, w: 2.6 });
      ink(s, rough([[118, 96], [126, 104], [142, 84]], 5, 0.3), { d: 1.9, t: 0.25, w: 2.4 });
      text(s, 150, 102, 'kept', { cls: 'hand dim', size: 18, d: 2.0 });
    },

    secure: function (s) {
      card(s, 12, 44, 194, 46, 14, 4, 0, { t: 0.7 });
      for (var i = 0; i < 7; i++) {
        shape(s, 'M' + (36 + i * 16) + ' 67m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0', 'fill-ink', 0.5 + i * 0.08);
      }
      shape(s, pen.rect(152, 56, 3, 22, 1), 'fill-red', 1.1);
      ink(s, pen.box(170, 14, 26, 20, 5, 7, 0.3), { d: 0.3, t: 0.35 });
      ink(s, pen.curve([[175, 14], [175, 3], [183, 0], [191, 3], [191, 14]], 3, 0.2), { d: 0.6, t: 0.3 });
      text(s, 110, 118, 'not learning, not listening', { cls: 'hand dim', size: 15, anchor: 'middle', d: 1.2 });
    },

    stamp: function (s) {
      var host = s.parentNode;
      fit(s, function () { return [host.offsetWidth + 8, host.offsetHeight + 8]; }, function (w, h) {
        ink(s, pen.box(3, 3, w - 6, h - 6, 9, 21, 0.9), { d: 0.1, t: 0.9 });
      });
    }
  };

  /* Drawings sized to an HTML box (chips, struck words, the stamp) are drawn in that box's own pixels, so
     strokes never stretch. Sizes are read in one pass, then everything is rebuilt. */
  var fitted = [];
  function fit(svg, size, draw) { fitted.push([svg, size, draw]); }
  function refit() {
    var sizes = fitted.map(function (f) { return f[1](); });
    fitted.forEach(function (f, i) {
      var w = Math.max(1, Math.round(sizes[i][0])), h = Math.max(1, Math.round(sizes[i][1]));
      if (f[3] === w + 'x' + h) return;
      f[3] = w + 'x' + h;
      f[0].setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      while (f[0].firstChild) f[0].removeChild(f[0].firstChild);
      f[2](w, h);
    });
  }
  var refitTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(refitTimer); refitTimer = setTimeout(refit, 150); });
  /* The privacy page reuses the same sketch. */
  ART['privacy-mini'] = ART.privacy;

  function buildArt() {
    var nodes = document.querySelectorAll('[data-art]');
    for (var i = 0; i < nodes.length; i++) {
      var fn = ART[nodes[i].getAttribute('data-art')];
      if (fn) fn(nodes[i]);
    }
  }

  /* ---------------- Scenes: draw when scrolled into view ---------------- */

  var enterHooks = [];
  function onEnter(node, fn) { enterHooks.push([node, fn]); }

  function scenes() {
    var list = document.querySelectorAll('.scene:not(.hero)');
    if (reduce || !('IntersectionObserver' in window)) {
      for (var i = 0; i < list.length; i++) list[i].classList.add('on');
      enterHooks.forEach(function (h) { h[1](); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('on');
        io.unobserve(e.target);
        enterHooks.forEach(function (h) { if (h[0] === e.target) h[1](); });
      });
    }, { rootMargin: '0px 0px -14% 0px', threshold: 0 });
    for (var j = 0; j < list.length; j++) io.observe(list[j]);
  }

  function visibility(node, cb) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { cb(es[es.length - 1].isIntersecting); }, { threshold: 0.15 }).observe(node);
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------------- Hero: headline typed by the cursor ---------------- */

  function prepHeadline(h1) {
    var lines = h1.querySelectorAll('.l');
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = h1.textContent.replace(/\s+/g, ' ').trim();
    var vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    var chars = [];
    Array.prototype.forEach.call(lines, function (l, li) {
      var line = document.createElement('span');
      line.className = 'l';
      var words = l.textContent.trim().split(/\s+/);
      words.forEach(function (word, wi) {
        var wd = document.createElement('span');
        wd.className = 'wd';
        Array.from(word).forEach(function (c) {
          var ch = document.createElement('span');
          ch.className = 'ch';
          ch.textContent = c;
          wd.appendChild(ch);
          chars.push(ch);
        });
        line.appendChild(wd);
        if (wi < words.length - 1) line.appendChild(document.createTextNode(' '));
      });
      vis.appendChild(line);
      if (li < lines.length - 1) vis.appendChild(document.createTextNode(' '));
    });
    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    h1.textContent = '';
    h1.appendChild(sr); h1.appendChild(vis); h1.appendChild(caret);
    return { h1: h1, chars: chars, caret: caret, pos: [], at: -1 };
  }

  /* One batched read of every character box; afterwards the caret only moves by transform. */
  function measure(H) {
    var hr = H.h1.getBoundingClientRect(), ch = H.caret.offsetHeight;
    H.pos = H.chars.map(function (c) {
      var r = c.getBoundingClientRect();
      return [r.right - hr.left, r.top - hr.top + (r.height - ch) / 2 + ch * 0.04, r.left - hr.left];
    });
    placeCaret(H, H.at);
  }
  function placeCaret(H, i) {
    H.at = i;
    var p = H.pos[Math.max(0, i)];
    if (!p) return;
    var x = i < 0 ? p[2] - 2 : p[0] + 2;
    H.caret.style.transform = 'translate(' + x.toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
  }
  function caretTarget(H) {
    var hr = H.h1.getBoundingClientRect(), p = H.pos[0];
    return { x: hr.left + p[2] - 2, y: hr.top + p[1], w: H.caret.offsetWidth, h: H.caret.offsetHeight };
  }

  function typeHeadline(H, speed) {
    H.caret.classList.add('shown', 'typing');
    var i = 0;
    return new Promise(function (resolve) {
      (function step() {
        if (H.skip) { finishHeadline(H); resolve(); return; }
        if (i >= H.chars.length) { H.caret.classList.remove('typing'); resolve(); return; }
        H.chars[i].classList.add('v');
        placeCaret(H, i);
        var c = H.chars[i].textContent;
        i++;
        var ms = speed * (0.7 + 0.6 * Math.abs(hash(i, 77)));
        if (c === '.') ms += 220;
        setTimeout(step, ms);
      })();
    });
  }
  function finishHeadline(H) {
    H.h1.classList.add('typed');
    H.caret.classList.add('shown');
    H.caret.classList.remove('typing');
    placeCaret(H, H.chars.length - 1);
  }

  function hero() {
    var h1 = document.querySelector('.headline');
    var section = document.querySelector('.hero');
    if (!h1 || !section) return;
    var H = prepHeadline(h1);
    measure(H);
    var raf = 0;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { measure(H); });
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(H); });

    function reveal() { section.classList.add('on'); }

    if (reduce) { finishHeadline(H); reveal(); return; }

    var first = !store('get', 'aere-intro') && !location.hash && window.scrollY < 40 && !doc.classList.contains('wipe-in');
    store('set', 'aere-intro', '1');
    if (!first) {
      doc.classList.remove('intro-pending');
      setTimeout(function () { typeHeadline(H, 34).then(reveal); }, 250);
      return;
    }
    intro(H, reveal);
  }

  /* ---------------- Intro: the logo scribble draws, boils, untangles; its cursor becomes the caret ---------------- */

  function intro(H, reveal) {
    var ov = document.createElement('div');
    ov.className = 'intro';
    ov.innerHTML = '<svg viewBox="100 215 750 590" aria-hidden="true" focusable="false">' +
      '<path class="u-sh" pathLength="1" transform="translate(28 28)"/><path class="u-line" pathLength="1"/>' +
      '<rect class="u-csh" x="772" y="370" width="56" height="340"/><rect class="u-cur" x="744" y="342" width="56" height="340"/></svg>' +
      '<button type="button">Skip intro</button>';
    document.body.appendChild(ov);
    doc.classList.remove('intro-pending');
    var line = ov.querySelector('.u-line'), sh = ov.querySelector('.u-sh'), cur = ov.querySelector('.u-cur');
    var t0 = 0, done = false, L = 488;

    function frame(now) {
      if (done) return;
      if (!t0) t0 = now;
      var t = (now - t0) / 1000;
      var drawn = easeOut(lin(t, 0.1, 0.9));
      var boil = t > 1.0 && t < 1.38 ? Math.floor(t * 8) % 3 : null;
      var u = seg(t, 1.38, 0.8);
      var words = easeOut(lin(t, 2.18, 0.26));
      var d = untangle(u, 1, 3, -0.5 * u, boil);
      line.setAttribute('d', d); sh.setAttribute('d', d);
      var dash;
      if (words > 0) {
        var g = (50 + 34 * words) / L;
        dash = [96 / L, g, 150 / L, g, 4].map(function (v) { return v.toFixed(4); }).join(' ');
      } else {
        dash = drawn.toFixed(4) + ' 2';
      }
      line.style.strokeDasharray = sh.style.strokeDasharray = dash;
      line.style.opacity = sh.style.opacity = drawn > 0.002 ? 1 : 0;
      if (t < 2.5) requestAnimationFrame(frame);
      else fly();
    }

    function fly() {
      if (done) return;
      done = true;
      cleanupInput();
      var a = cur.getBoundingClientRect(), b = caretTarget(H);
      var f = document.createElement('div');
      f.className = 'fly';
      f.style.cssText = 'left:' + a.left + 'px;top:' + a.top + 'px;width:' + a.width + 'px;height:' + a.height + 'px';
      document.body.appendChild(f);
      cur.style.opacity = 0;
      ov.querySelector('.u-csh').style.opacity = 0;
      ov.classList.add('lift');
      var to = 'translate(' + (b.x - a.left) + 'px,' + (b.y - a.top) + 'px) scale(' + (b.w / a.width) + ',' + (b.h / a.height) + ')';
      var anim = f.animate ? f.animate([{ transform: 'none' }, { transform: to }], { duration: 560, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' }) : null;
      setTimeout(function () {
        f.remove(); ov.remove();
        placeCaret(H, -1);
        typeHeadline(H, 30).then(reveal);
      }, anim ? 580 : 0);
    }

    function skip() {
      if (done) return;
      done = true;
      cleanupInput();
      ov.remove();
      H.skip = true;
      finishHeadline(H);
      reveal();
    }
    var evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    function cleanupInput() { evs.forEach(function (e) { window.removeEventListener(e, skip, true); }); }
    evs.forEach(function (e) { window.addEventListener(e, skip, { capture: true, passive: true }); });
    requestAnimationFrame(frame);
  }

  /* ---------------- Demo: ramble in, clean text out ---------------- */

  var STYLES = {
    casual: 'Meet at six? Maybe grab dinner after?',
    polished: 'I was thinking we could meet at six, and maybe have dinner afterwards.',
    concise: 'Six, then dinner?',
    bullets: '• Meet at six\n• Maybe dinner after'
  };
  var NAMES = { casual: 'Casual', polished: 'Polished', concise: 'Concise', bullets: 'Bullet List' };

  function demo() {
    var stage = document.querySelector('[data-demo]');
    if (!stage) return;
    var words = stage.querySelectorAll('.w');
    var out = stage.querySelector('.out'), caret = stage.querySelector('.field .caret');
    var chips = Array.prototype.slice.call(stage.querySelectorAll('.chip'));
    var live = stage.querySelector('[data-live]');
    var k = 0;
    Array.prototype.forEach.call(words, function (w, i) {
      w.style.setProperty('--i', i);
      w.style.setProperty('--r', (noise(i * 1.7 + 0.3, 9) * 5).toFixed(1) + 'deg');
      w.style.setProperty('--y', (noise(i * 2.3 + 0.5, 4) * 5).toFixed(1) + 'px');
      if (w.classList.contains('f')) {
        var s = el('svg', { 'aria-hidden': 'true' }, w), delay = k * 0.16;
        fit(s, function () { return [w.offsetWidth * 1.12, w.offsetHeight * 0.84]; }, function (W, H) {
          ink(s, pen.zig(W * 0.03, H * 0.22, W * 0.94, H * 0.56, Math.max(4, Math.round(W / 8)), 30 + i), { c: 'red', cls: 'seq', d: delay, t: 0.3 });
        });
        k++;
      }
    });
    chips.forEach(function (c, i) {
      var s = el('svg', { 'aria-hidden': 'true' }, c);
      fit(s, function () { return [c.offsetWidth + 18, c.offsetHeight + 16]; }, function (W, H) {
        el('path', { d: pen.loop(W / 2, H / 2, W / 2 - 3, H / 2 - 3, 50 + i, 1.1, -2.6), 'class': 'ink red', pathLength: 1 }, s);
      });
    });

    var current = 'casual', user = false, visible = false, busy = false, timer = 0, token = 0, started = false;

    function setChecked(style) {
      current = style;
      chips.forEach(function (c) {
        var on = c.getAttribute('data-style') === style;
        c.setAttribute('aria-checked', on ? 'true' : 'false');
        c.tabIndex = on ? 0 : -1;
      });
    }

    function retype(text) {
      var my = ++token;
      if (reduce) { out.textContent = text; return Promise.resolve(); }
      busy = true;
      caret.classList.add('typing');
      return (async function () {
        while (out.textContent.length) {
          if (my !== token) return;
          out.textContent = out.textContent.slice(0, -2);
          await wait(14);
        }
        await wait(120);
        for (var i = 1; i <= text.length; i++) {
          if (my !== token) return;
          out.textContent = text.slice(0, i);
          var ch = text[i - 1];
          await wait(ch === ' ' ? 40 : ch === '\n' ? 160 : 24 + 14 * Math.abs(hash(i, 5)));
        }
        if (my === token) { busy = false; caret.classList.remove('typing'); }
      })();
    }

    function schedule() {
      clearTimeout(timer);
      if (user || reduce || !visible) return;
      timer = setTimeout(function () {
        if (user || !visible) return;
        var order = Object.keys(STYLES);
        var next = order[(order.indexOf(current) + 1) % order.length];
        setChecked(next);
        retype(STYLES[next]).then(schedule);
      }, 2600);
    }

    function pick(style, focus) {
      user = true;
      clearTimeout(timer);
      setChecked(style);
      if (focus) chips.filter(function (c) { return c.getAttribute('data-style') === style; })[0].focus();
      live.textContent = NAMES[style] + ': ' + STYLES[style].replace(/•/g, '').replace(/\n/g, '. ');
      if (!started) { finish(); return; }
      retype(STYLES[style]);
    }

    chips.forEach(function (c, i) {
      c.addEventListener('click', function () { pick(c.getAttribute('data-style')); });
      c.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        pick(chips[(i + d + chips.length) % chips.length].getAttribute('data-style'), true);
      });
    });

    function finish() {
      started = true;
      stage.classList.add('speaking', 'scratched', 'straight', 'arrowed');
      token++;
      out.textContent = STYLES[current];
      busy = false;
      caret.classList.remove('typing');
    }

    async function play() {
      if (started) return;
      started = true;
      if (reduce) { finish(); return; }
      stage.classList.add('speaking', 'listening');
      await wait(words.length * 75 + 450);
      stage.classList.remove('listening');
      stage.classList.add('scratched');
      await wait(900);
      stage.classList.add('straight');
      await wait(500);
      stage.classList.add('arrowed');
      await wait(450);
      await retype(STYLES[current]);
      schedule();
    }

    visibility(stage, function (v) {
      visible = v;
      if (v && started && !busy) schedule();
      if (!v) clearTimeout(timer);
    });
    onEnter(stage, play);
  }

  /* ---------------- Duo: fold / unfold ---------------- */

  function duo() {
    var box = document.querySelector('[data-duo]'), btn = document.querySelector('[data-fold]');
    if (!box || !btn) return;
    var folded = false, user = false, visible = false, timer = 0;
    function set(f) {
      folded = f;
      box.classList.toggle('folded', f);
      btn.textContent = f ? 'Unfold it' : 'Fold it';
    }
    function tick() {
      clearTimeout(timer);
      if (user || reduce || !visible) return;
      timer = setTimeout(function () { set(!folded); tick(); }, 3000);
    }
    btn.addEventListener('click', function () { user = true; clearTimeout(timer); set(!folded); });
    visibility(box, function (v) { visible = v; if (v && box.classList.contains('on')) tick(); else clearTimeout(timer); });
    onEnter(box, function () { setTimeout(tick, 900); });
  }

  /* ---------------- Terms: the red caret marks the section you're reading ---------------- */

  function toc() {
    var links = document.querySelectorAll('.toc a[href^="#"]');
    if (!links.length) return;
    var items = Array.prototype.map.call(links, function (a) { return [a, document.getElementById(a.getAttribute('href').slice(1))]; })
      .filter(function (x) { return x[1]; });
    var cur = null, ticking = false;
    function update() {
      ticking = false;
      var pick = null;
      for (var i = 0; i < items.length; i++) if (items[i][1].getBoundingClientRect().top < innerHeight * 0.35) pick = items[i][0];
      if (pick === cur) return;
      if (cur) cur.removeAttribute('aria-current');
      if (pick) pick.setAttribute('aria-current', 'true');
      cur = pick;
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------------- Page "redraw": marker strokes paint over the page, then off the next one ---------------- */

  var WIPE = 'M-12 -6L112 8L-12 22L112 36L-12 50L112 64L-12 78L112 92L-12 106';
  function wipeLayer(offset) {
    var w = document.createElement('div');
    w.className = 'wipe';
    w.setAttribute('aria-hidden', 'true');
    w.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path pathLength="1" d="' + WIPE + '" style="stroke-dasharray:1 1.02;stroke-dashoffset:' + offset + '"/></svg>';
    document.body.appendChild(w);
    return w;
  }

  function pageWipes() {
    if (doc.classList.contains('wipe-in')) {
      store('del', 'aere-wipe');
      var w = wipeLayer(0);
      doc.classList.remove('wipe-in');
      var p = w.querySelector('path');
      if (reduce || !p.animate) { w.remove(); }
      else {
        p.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }], { duration: 460, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' })
          .onfinish = function () { w.remove(); };
      }
    }
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      doc.classList.remove('wipe-in');
      Array.prototype.forEach.call(document.querySelectorAll('.wipe'), function (n) { n.remove(); });
    });
    if (reduce) return;
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      var url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname)) return;
      if (url.pathname === location.pathname) return;
      var layer = wipeLayer(1), path = layer.querySelector('path');
      if (!path.animate) { layer.remove(); return; }
      e.preventDefault();
      store('set', 'aere-wipe', '1');
      path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 380, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' })
        .onfinish = function () { location.href = a.href; };
    });
  }

  /* ---------------- Go ---------------- */

  function start() {
    buildArt();
    pageWipes();
    hero();
    demo();
    refit();
    duo();
    toc();
    scenes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
