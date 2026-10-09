// 星環電路 雙人版 · gl/gl_world.js：WebGL 繪圖層：背景星空、網格、大地圖的牆（6 種風格：牆面貼磚＋邊緣裝飾＋發光的邊）、閘門、
//   地圖物件（行星、黑洞、小行星、彗星、星門、視野陰影）、出口、王的落點轟炸、晶體
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

const GLWorld = {
  init() {
    const L = GLR.L, S = () => new PIXI.Sprite();
    this.pStar = GLR.pool('star', L.bg, S);
    this.gGrid = new PIXI.Graphics(); L.grid.addChild(this.gGrid);
    this.wall = new PIXI.Container(); L.map.addChild(this.wall);     // 牆（換地圖時重建）
    this.gShadow = new PIXI.Graphics(); L.map.addChild(this.gShadow);
    if (PIXI.BlurFilter) this.gShadow.filters = [new PIXI.BlurFilter({ strength: 10, quality: 2 })];
    this.objs = new PIXI.Container(); L.map.addChild(this.objs);
    this.pObj = GLR.pool('obj', this.objs, S);
    this.gObj = new PIXI.Graphics(); L.map.addChild(this.gObj);       // 物件的血條、彗星預警、星門、出口、轟炸紅圈、引力範圍
    this.gAdd = new PIXI.Graphics(); this.gAdd.blendMode = 'add'; L.mapFx.addChild(this.gAdd);  // 閘門屏障、牆的發光邊（加法）
    this.pGate = GLR.pool('gate', L.mapFx, S);
    this.pPick = GLR.pool('pick', L.pickups, S);
    this.pTxt = GLR.pool('wTxt', L.mapFx, () => new PIXI.BitmapText({ text: '', style: { fontFamily: 'Microsoft JhengHei, Segoe UI, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#c9fff3' } }));
    this.holes = new Map();  // 黑洞：每個一組（後半盤、核心、前半盤＋遮罩）
    this.builtLoops = null;
  },

  // ---------- 背景星空（畫面座標，視差） ----------
  drawBg() {
    const c = Game.cam, tex = GLR.T('p/sq'), r = GLR.res('p/sq');
    for (const s of Game.stars) {
      const q = GLR.sprite(this.pStar, tex);
      q.position.set(mod(s.u * VW - c.x * s.z, VW), mod(s.v * VH - c.y * s.z, VH)); q.scale.set(s.s / r); q.tint = 0x9fb4ff; q.alpha = s.a; q.anchor.set(0);
    }
  },

  draw() {
    const G = Game, c = G.cam, W = Arena.W, H = Arena.H, g = this.gGrid; g.clear();
    const gs = 80;
    for (let x = Math.max(0, Math.floor(c.x / gs) * gs); x <= Math.min(W, c.x + ZW); x += gs) g.moveTo(x, Math.max(0, c.y)).lineTo(x, Math.min(H, c.y + ZH));
    for (let y = Math.max(0, Math.floor(c.y / gs) * gs); y <= Math.min(H, c.y + ZH); y += gs) g.moveTo(Math.max(0, c.x), y).lineTo(Math.min(W, c.x + ZW), y);
    g.stroke({ width: 1, color: 0x3c5ab4, alpha: 0.12 });
    this.gAdd.clear(); this.gObj.clear();
    const viewer = G.player.dead && G.mate && !G.mate.dead ? G.mate : G.player;
    if (Arena.rect) { this.wall.visible = false; g.rect(0, 0, W, H).stroke({ width: 3, color: 0x4cc9f0, alpha: 0.6 }); }
    else { this.buildWalls(); this.wall.visible = true; this.wallAnim(); this.gates(viewer); }
    this.objects(viewer);
    this.exit();
    for (const z of G.zones) {  // 王的落點轟炸：紅圈，裡面的實心圓越長越大
      const k = 1 - Math.max(0, z.t) / z.max;
      this.gObj.circle(z.x, z.y, z.r).stroke({ width: 3, color: 0xff2a2a, alpha: 0.5 + 0.4 * Math.sin(G.time * 20) ** 2 });
      this.gObj.circle(z.x, z.y, z.r * k).fill({ color: 0xff2a2a, alpha: 0.18 + 0.2 * k });
    }
    for (const z of G.flames) {  // 火毯（散彈升級）：地上的火，外圈橘、中心黃，快燒完時變淡（加法發光）
      const k = Math.min(1, Math.max(0, z.t) / z.max * 2), fl = 0.85 + 0.15 * Math.sin(G.time * 18 + z.x * 0.07);
      this.gAdd.circle(z.x, z.y, z.r * fl).fill({ color: 0xff6a1c, alpha: 0.22 * k });
      this.gAdd.circle(z.x, z.y, z.r * 0.5 * fl).fill({ color: 0xffd166, alpha: 0.28 * k });
    }
    const pt = GLR.T('pickup'), pr = GLR.res('pickup');
    for (const p of G.pickups) {
      if (p.gone || (p.life < 3 && Math.floor(p.life * 8) % 2)) continue;
      const s = GLR.sprite(this.pPick, pt); s.position.set(p.x, p.y); s.scale.set(1 / pr); s.rotation = G.time * 3;
    }
  },

  // ---------- 牆 ----------
  // 風格照星區抽（同一張地圖固定）：第 1 星區 金屬艙壁／岩石洞壁、第 2 冰晶／廢棄站體、第 3 熔岩玄武岩／生物巢壁，之後全部隨機
  styleOf() {
    const s = Game.sector || 1, seed = Arena.seed != null ? Arena.seed : Arena.n || 0;
    const opts = s === 1 ? ['metal', 'rock'] : s === 2 ? ['ice', 'ruins'] : s === 3 ? ['lava', 'organic'] : ['metal', 'rock', 'ice', 'ruins', 'lava', 'organic'];
    return opts[Math.abs(seed) % opts.length];
  },
  buildWalls() {
    if (this.builtLoops === Arena.loops) return;
    this.builtLoops = Arena.loops;
    const C = this.wall; for (const ch of C.removeChildren()) ch.destroy();
    if (!Arena.loops || !Arena.loops.length) return;
    const sty = this.style = this.styleOf(), ST = WALL_LOOK[sty];
    // 牆面：大矩形鋪貼磚，挖掉每一圈空地
    const fill = new PIXI.Graphics(), tile = GLR.tiles[sty];
    fill.rect(-4000, -4000, Arena.W + 8000, Arena.H + 8000);
    if (tile) fill.fill(new PIXI.FillPattern(tile, 'repeat')); else fill.fill({ color: 0x131a33 });
    for (const l of Arena.loops) fill.poly(l.flat()).cut();
    C.addChild(fill);
    this.flow = null;
    const fl = GLR.flows[sty];
    if (fl && fl.length) {  // 流動的亮光：跟貼磚一樣從世界原點開始鋪（tilePosition 補回位移）
      const mask = new PIXI.Graphics(); mask.rect(-4000, -4000, Arena.W + 8000, Arena.H + 8000).fill({ color: 0xffffff });
      for (const l of Arena.loops) mask.poly(l.flat()).cut();
      const ts = new PIXI.TilingSprite({ texture: fl[0], width: Arena.W + 8000, height: Arena.H + 8000 });
      ts.position.set(-4000, -4000); ts.tilePosition.set(4000, 4000); ts.blendMode = 'add'; ts.mask = mask;
      C.addChild(mask, ts); this.flow = { ts, frames: fl };
    }
    // 邊：深色底線＋材質色的細線
    const edge = new PIXI.Graphics();
    for (const l of Arena.loops) edge.poly(l.flat(), true);
    edge.stroke({ width: ST.edgeW + 3, color: 0x03050c });
    for (const l of Arena.loops) edge.poly(l.flat(), true);
    edge.stroke({ width: ST.edgeW, color: ST.edge });
    C.addChild(edge);
    // 發光的邊（加法）
    this.glowEdge = null;
    if (ST.glow != null) {
      const ge = new PIXI.Graphics(); ge.blendMode = 'add';
      for (const l of Arena.loops) ge.poly(l.flat(), true);
      ge.stroke({ width: ST.glowW, color: ST.glow, alpha: ST.glowA });
      this.glowEdge = ge;
    }
    // 邊緣裝飾：沿著每一圈每隔 step 放一個（+y 朝空地）
    const decos = new PIXI.Container(); C.addChild(decos);
    this.lights = [];
    const n = ST.decoN, res = 2;
    for (const l of Arena.loops) {
      let acc = ST.step * 0.5, k = 0;
      for (let i = 0; i < l.length; i++) {
        const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length], len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.01) continue;
        const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        let nx = uy, ny = -ux;
        while (acc <= len) {
          const px = x0 + ux * acc, py = y0 + uy * acc;
          if (Arena.f(px + nx * 6, py + ny * 6) < Arena.f(px - nx * 6, py - ny * 6)) { nx = -nx; ny = -ny; }  // 法線朝空地（場地值大的那邊）
          const idx = Math.floor(seeded(k * 7.13 + px * 0.017 + py * 0.031) * 997) % n;
          const s = new PIXI.Sprite(GLR.T(`w/${sty}/deco/${idx}`)); s.position.set(px, py); s.rotation = Math.atan2(ny, nx) - Math.PI / 2; s.scale.set(1 / res);
          decos.addChild(s);
          if (sty === 'metal' && k % 2 === 0) this.lights.push({ x: px, y: py, k: k / 2 });
          if (sty === 'ruins' && k % 4 === 1) this.lights.push({ x: px - nx * 16, y: py - ny * 16, k });
          acc += ST.step; k++;
        }
        acc -= len;
      }
    }
    if (this.glowEdge) C.addChild(this.glowEdge);
    if (sty === 'ruins') C.addChildAt(this.tornEdge(), C.getChildIndex(decos));  // 撕裂的金屬板邊緣（在裝飾底下）
    // 會閃的燈（金屬：航行燈依序亮；廢棄站體：殘燈忽明忽滅）
    this.lightC = new PIXI.Container(); C.addChild(this.lightC);
    for (const L of this.lights) { const s = new PIXI.Sprite(GLR.T('glow')); s.anchor.set(0.5); s.position.set(L.x, L.y); s.scale.set(9 / GLR.res('glow')); s.tint = sty === 'metal' ? 0x6e96ff : 0xffcf8a; s.blendMode = 'add'; s.alpha = 0; this.lightC.addChild(s); L.s = s; }
  },
  tornEdge() {
    const g = new PIXI.Graphics();
    for (const l of Arena.loops) {
      const out = [], inn = [];
      let acc = 0, k = 0;
      for (let i = 0; i < l.length; i++) {
        const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length], len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.01) continue;
        const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        while (acc <= len) {
          const px = x0 + ux * acc, py = y0 + uy * acc;
          let nx = uy, ny = -ux; if (Arena.f(px + nx * 6, py + ny * 6) < Arena.f(px - nx * 6, py - ny * 6)) { nx = -nx; ny = -ny; }
          const j = (seeded(k * 3.7 + px * 0.01) - 0.35) * 12 + (seeded(k * 1.3 + py * 0.01) < 0.12 ? 10 : 0);
          out.push(px + nx * j, py + ny * j); inn.push([px - nx * 8, py - ny * 8]);
          acc += 9; k++;
        }
        acc -= len;
      }
      if (out.length < 6) continue;
      const pts = out.slice(); for (let i = inn.length - 1; i >= 0; i--) pts.push(inn[i][0], inn[i][1]);
      g.poly(pts).fill({ color: 0x4a4f5c }).stroke({ width: 2, color: 0x03050c });
      g.poly(out, true).stroke({ width: 1, color: 0x8a8f9c });
    }
    return g;
  },
  wallAnim() {
    const t = Game.time, sty = this.style;
    if (this.flow) { const F = this.flow.frames, k = Math.floor(t / (sty === 'lava' ? 2.4 : 1.6) * F.length) % F.length; if (this.flow.ts.texture !== F[k]) this.flow.ts.texture = F[k]; }
    if (this.glowEdge && (sty === 'lava' || sty === 'organic')) this.glowEdge.alpha = 0.75 + 0.25 * Math.sin(t * (sty === 'lava' ? 2 : 3));
    if (!this.lights) return;
    if (sty === 'metal') { const on = Math.floor(t * 4) % 6; for (const L of this.lights) L.s.alpha = (L.k % 6) === on ? 0.9 : 0; }
    else for (const L of this.lights) L.s.alpha = seeded(Math.floor(t * 8) + L.k * 13) > 0.35 ? 0.5 : 0.08;
  },
  // 閘門：兩座面對面的發射器＋中間的能量屏障（關著＝紅、掃描線往下流；能過＝淡綠、飄過的光點）
  gates(viewer) {
    const t = Game.time, g = this.gAdd, tex = GLR.T(`w/${this.style || 'metal'}/gate`), er = GLR.res(`w/${this.style || 'metal'}/gate`);
    for (const G of Arena.gates) {
      const pass = viewer && viewer.zone === G.i && G.open, behind = viewer && viewer.zone > G.i, col = pass ? 0x2ee6a6 : 0xff4d6d;
      const ex = -G.ny * G.L, ey = G.nx * G.L, ax = G.x - ex, ay = G.y - ey, bx = G.x + ex, by = G.y + ey, ux = ex / G.L, uy = ey / G.L, fw = 16;
      const k = behind ? 0.35 : 1;
      // 屏障：沿閘門線的帶子（中間亮、兩側淡）
      const band = (w, a) => { g.poly([ax - G.nx * w, ay - G.ny * w, bx - G.nx * w, by - G.ny * w, bx + G.nx * w, by + G.ny * w, ax + G.nx * w, ay + G.ny * w]).fill({ color: col, alpha: a * k }); };
      if (!pass) {
        band(fw, 0.12); band(fw * 0.5, 0.18);
        for (let d = (t * 30) % 8; d < G.L * 2; d += 8) { const px = ax + ux * d, py = ay + uy * d; g.moveTo(px - G.nx * fw * 0.55, py - G.ny * fw * 0.55).lineTo(px + G.nx * fw * 0.55, py + G.ny * fw * 0.55); }
        g.stroke({ width: 1, color: col, alpha: 0.5 * k });
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1.2, color: 0xffd0d8, alpha: 0.6 * k });
      } else {
        band(fw, 0.05 + 0.03 * Math.sin(t * 3));
        for (let i = 0; i < 6; i++) { const ph = (t * 0.6 + i / 6) % 1, d = seeded(i + 30) * G.L * 2, px = ax + ux * d + G.nx * (ph - 0.5) * 40, py = ay + uy * d + G.ny * (ph - 0.5) * 40; g.circle(px, py, 2.5).fill({ color: col, alpha: Math.sin(ph * Math.PI) * 0.8 }); }
      }
      for (const [x, y, dir] of [[ax, ay, 1], [bx, by, -1]]) {
        const s = GLR.sprite(this.pGate, tex); s.position.set(x, y); s.scale.set(1 / er); s.rotation = Math.atan2(uy * dir, ux * dir) - Math.PI / 2; s.alpha = behind ? 0.5 : 1;
        g.circle(x + ux * dir * 8, y + uy * dir * 8, pass ? 5 : 7).fill({ color: col, alpha: (pass ? 0.4 : 0.7) * k });
      }
    }
  },

  // ---------- 地圖物件 ----------
  objects(viewer) {
    const G = Game, P = this.pObj, gO = this.gObj, t = G.time;
    this.shadows(viewer);
    const seen = new Set();
    for (const o of G.objs) {
      if (o.type === 'planet') {
        const s = GLR.sprite(P, GLR.T('o/planet')); s.position.set(o.x, o.y); s.scale.set(o.r / 100 / GLR.res('o/planet'));
        GLActors.dashed(gO, o.x, o.y, o.r * 3.2, 4, 10, { width: 1.5, color: 0x8caaff, alpha: 0.1 });
      } else if (o.type === 'hole') { seen.add(o); this.hole(o); }
      else if (o.type === 'rock') {
        const k = Math.abs(Math.round(o.x * 7 + o.y * 13)) % 6, s = GLR.sprite(P, GLR.T(`o/rock/${k}`)); s.position.set(o.x, o.y); s.scale.set(o.r / 32 / GLR.res('o/rock/0')); s.rotation = o.x * 0.01;
        if (o.hp < o.maxHp) { gO.rect(o.x - o.r, o.y - o.r - 8, o.r * 2, 3).fill({ color: 0x330000 }); gO.rect(o.x - o.r, o.y - o.r - 8, o.r * 2 * Math.max(0, o.hp / o.maxHp), 3).fill({ color: 0xc9b79c }); }
      } else if (o.type === 'comet') this.comet(o);
    }
    for (const [o, H] of this.holes) if (!seen.has(o)) { H.c.destroy({ children: true }); this.holes.delete(o); }
    for (const q of G.portals) {  // 星門
      const a = Math.min(1, q.t * 2), col = glColor(q.color);
      for (const [x, y] of [[q.ax, q.ay], [q.bx, q.by]]) { gO.circle(x, y, 22).stroke({ width: 3, color: col, alpha: a }); glArc(gO, x, y, 14, t * 4, t * 4 + 4); gO.stroke({ width: 1.5, color: col, alpha: a }); }
      gO.moveTo(q.ax, q.ay).lineTo(q.bx, q.by).stroke({ width: 1.5, color: col, alpha: 0.12 * a });
    }
  },
  hole(o) {
    let H = this.holes.get(o);
    if (!H) {  // 吸引範圍的旋臂 → 外光暈 → 後半盤（壓扁、旋轉、只露上半）→ 核心 → 前半盤（只露下半）
      const c = new PIXI.Container(), gl = new PIXI.Sprite(GLR.T('glow')); gl.anchor.set(0.5); gl.tint = 0x7a3dff; gl.blendMode = 'add'; gl.alpha = 0.45;
      const sw = new PIXI.Sprite(GLR.T('o/hole_swirl')); sw.anchor.set(0.5); sw.blendMode = 'add'; c.addChild(sw);
      const half = top => { const box = new PIXI.Container(); box.scale.set(1, 0.42); const spin = new PIXI.Container(); box.addChild(spin); const d = new PIXI.Sprite(GLR.T('o/hole_disk')); d.anchor.set(0.5); d.blendMode = 'add'; spin.addChild(d); const m = new PIXI.Graphics().rect(-400, top ? -400 : 0, 800, 400).fill({ color: 0xffffff }); box.addChild(m); box.mask = m; return { box, spin, d }; };
      const back = half(true), front = half(false), core = new PIXI.Sprite(GLR.T('o/hole_core')); core.anchor.set(0.5);
      c.addChild(gl, back.box, core, front.box); this.objs.addChild(c);
      H = { c, gl, sw, back, front, core, t: Game.time, motes: Array.from({ length: 16 }, () => ({ a: rand(0, TAU), r: rand(0.3, 1) })) }; this.holes.set(o, H);
    }
    const t = Game.time, s = o.r / 40 / GLR.res('o/hole_core');
    H.c.position.set(o.x, o.y);
    H.gl.scale.set((o.R || o.r * 3) / GLR.res('glow'));
    H.core.scale.set(s);
    for (const h of [H.back, H.front]) { h.d.scale.set(s); h.spin.rotation = t * 0.6; }
    // 吸引範圍：旋臂往中心捲（圖案反方向轉，看起來是往內流）；光點從外緣螺旋吸進去（速度跟吸力一樣，外慢內快）
    const R = o.R || OBJ.HOLE_R, dt = clamp(t - H.t, 0, 0.1); H.t = t;
    H.sw.scale.set(R / 280 / GLR.res('o/hole_swirl')); H.sw.rotation = -t * 0.5;
    for (const m of H.motes) {
      const u = m.r;  // 1 = 外緣
      m.r -= (40 + 150 * (1 - u)) / R * dt; m.a += (0.5 + 2.5 * (1 - u)) * dt;
      if (m.r < (o.r * 1.3) / R) { m.r = rand(0.92, 1); m.a = rand(0, TAU); }
      const x = o.x + Math.cos(m.a) * m.r * R, y = o.y + Math.sin(m.a) * m.r * R;
      GLActors.glowAt(this.pObj, x, y, 5 + 4 * (1 - m.r), 0xc9a8ff, Math.min(1, (1 - m.r) * 8) * 0.7);
    }
  },
  comet(o) {
    const G = Game, gO = this.gObj, s = Math.hypot(o.vx, o.vy) || 1, ux = o.vx / s, uy = o.vy / s;
    if (o.warn > 0) {  // 預警：沿之後的路線跑動的箭頭（藍白色）
      const pts = Objects.cometPath(o), gap = 70, off = (G.time * s * 0.8) % gap, a = 0.25 + 0.4 * Math.sin(G.time * 25) ** 2;
      let acc = 0, next = off;
      for (let i = 1; i < pts.length && next < 2400; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], seg = Math.hypot(x1 - x0, y1 - y0);
        while (next <= acc + seg) {
          const tt = (next - acc) / (seg || 1), px = x0 + (x1 - x0) * tt, py = y0 + (y1 - y0) * tt, dx = (x1 - x0) / (seg || 1), dy = (y1 - y0) / (seg || 1), w = o.r;
          gO.moveTo(px - dx * w * 0.7 - dy * w, py - dy * w * 0.7 + dx * w).lineTo(px, py).lineTo(px - dx * w * 0.7 + dy * w, py - dy * w * 0.7 - dx * w);
          next += gap;
        }
        acc += seg;
      }
      gO.stroke({ width: Math.max(2, o.r * 0.25), color: 0xbfe9ff, alpha: a, join: 'round', cap: 'round' });
      return;
    }
    for (let i = 0; i < 12; i++) { const k = i / 12; GLActors.glowAt(this.pObj, o.x - ux * k * 120, o.y - uy * k * 120, o.r * (1.7 - k * 0.9), 0x9fe0ff, (1 - k) * 0.35); }  // 尾巴
    GLActors.glowAt(this.pObj, o.x, o.y, o.r * 2.6, 0xcfefff, 0.7);
    const h = GLR.sprite(this.pObj, GLR.T('o/comet')); h.position.set(o.x, o.y); h.scale.set(o.r / 24 / GLR.res('o/comet')); h.rotation = Math.atan2(uy, ux);
  },
  // 視野陰影：每顆小行星後面拖出一塊模糊的灰霧（死角）；感測器 4 層看得穿，只留很淡的霧
  shadows(viewer) {
    const g = this.gShadow; g.clear();
    if (!viewer) return;
    const seeAll = Game.mech.traits.mark, FAR = 3000;
    let any = false;
    for (const o of Game.objs) {
      if (o.type !== 'rock') continue;
      const dx = o.x - viewer.x, dy = o.y - viewer.y, d = Math.hypot(dx, dy);
      if (d <= o.r + 1) continue;
      const a = Math.atan2(dy, dx), w = Math.acos(o.r * 0.9 / d);
      const [p1, p2] = [a + Math.PI + w, a + Math.PI - w].map(q => [o.x + Math.cos(q) * o.r * 0.9, o.y + Math.sin(q) * o.r * 0.9]);
      const far = ([x, y]) => { const ux = x - viewer.x, uy = y - viewer.y, l = Math.hypot(ux, uy) || 1; return [x + ux / l * FAR, y + uy / l * FAR]; };
      const q1 = far(p1), q2 = far(p2);
      g.poly([p1[0], p1[1], q1[0], q1[1], q2[0], q2[1], p2[0], p2[1]]); any = true;
    }
    if (any) g.fill({ color: 0x96a0be, alpha: seeAll ? 0.05 : 0.17 });
  },
  // 區域出口：旋轉的綠色光環；出口不在畫面裡時，飛船旁邊畫一個箭頭指過去
  exit() {
    const X = Game.exit, g = this.gObj;
    if (!X) return;
    const t = Game.time, pulse = 1 + 0.08 * Math.sin(t * 5);
    const label = (txt, x, y) => { const q = GLR.take(this.pTxt); if (q.text !== txt) q.text = txt; q.anchor.set(0.5, 1); q.position.set(x, y); q.alpha = 1; };
    if (X.gate) {
      const me = Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player, G = Arena.gates[me.zone];
      if (!G || !G.open) return;
      label('閘門', G.x - G.nx * 30, G.y - G.ny * 30 - 4);
    } else {
      g.circle(X.x, X.y, X.r * pulse).fill({ color: 0x2ee6a6, alpha: 0.15 }).stroke({ width: 4, color: 0x2ee6a6, alpha: 0.9 });
      for (let i = 0; i < 3; i++) { const a = t * 2 + i * TAU / 3; glArc(g, X.x, X.y, X.r * 0.6, a, a + 1.2); g.stroke({ width: 2, color: 0x2ee6a6, alpha: 0.9 }); }
      label('出口', X.x, X.y - X.r - 4);
    }
    const p = Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player, c = Game.cam;
    if (X.x > c.x && X.x < c.x + ZW && X.y > c.y && X.y < c.y + ZH) return;
    const dir = X.gate ? Arena.exitDir(p.x, p.y, p.zone, p.r) : null;
    const a0 = dir ? Math.atan2(dir[1], dir[0]) : Math.atan2(X.y - p.y, X.x - p.x), key = X.x + ',' + X.y;
    const a = this.exA = this.exA == null || this.exKey !== key ? a0 : this.exA + angleDiff(this.exA, a0) * 0.15;
    this.exKey = key;
    // 新畫面風格：切面上色的綠色 V 形箭頭＋光暈，兩層（»）由後往前輪流亮，表示「往這邊走」
    const P = this.pObj, tex = GLR.T('ui/exit_arrow'), res = GLR.res('ui/exit_arrow');
    GLActors.glowAt(P, p.x + Math.cos(a) * 62, p.y + Math.sin(a) * 62, 22, 0x2ee6a6, 0.35);
    for (let i = 0; i < 2; i++) {
      const d = 52 + i * 14, ph = (t * 2.2 - i * 0.35) % 1, s = GLR.sprite(P, tex);
      s.position.set(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); s.rotation = a; s.scale.set((i ? 1 : 0.8) / res);
      s.alpha = 0.45 + 0.55 * Math.max(0, Math.sin(ph * Math.PI));
    }
  },
};

// 各種牆的邊線顏色、粗細、發光、裝飾間距與數量
const WALL_LOOK = {
  metal:   { edge: 0x9aa6c4, edgeW: 2, glow: 0x6e96ff, glowW: 16, glowA: 0.1, step: 30, decoN: 1 },
  rock:    { edge: 0x5e554a, edgeW: 2, glow: null, step: 22, decoN: 8 },
  ice:     { edge: 0x6aa8cc, edgeW: 2.5, glow: 0x8fdcff, glowW: 12, glowA: 0.16, step: 26, decoN: 6 },
  organic: { edge: 0xa8484a, edgeW: 2.5, glow: 0xff5d73, glowW: 12, glowA: 0.16, step: 18, decoN: 6 },
  lava:    { edge: 0x4a4450, edgeW: 3, glow: 0xff7a2e, glowW: 10, glowA: 0.4, step: 24, decoN: 6 },
  ruins:   { edge: 0x8a8f9c, edgeW: 2, glow: null, step: 30, decoN: 6 },
};
function seeded(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
