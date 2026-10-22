// 星環電路 多人版 · gl/gl_fx.js：WebGL 繪圖層：我方子彈、敵彈、粒子、電弧、光圈、浮動數字
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   我方子彈、粒子、電弧、光圈用加法混色（跟舊畫面的 lighter 一樣）；子彈的貼圖是白色，照子彈顏色染色
'use strict';

// 子彈尾巴的長度：最長 max，但不超過從發射點飛過的距離
const tail = (b, max) => Math.min(max, Math.hypot(b.x - b.sx, b.y - b.sy));
// 能量刃的刃片外觀：圖案是判定半徑的 size 倍、後面拖 trail 張殘影（間隔 gap）
const BLADE_FX = { size: 2.4, trail: 3, gap: 8 };

const GLFx = {
  init() {
    const L = GLR.L, S = () => new PIXI.Sprite();
    this.pB = new GLParticles(L.bullets, 'add');   // 我方子彈（加法混色）
    this.pP = new GLParticles(L.fx, 'add');        // 粒子
    this.pEB = new GLParticles(L.eBullets, 'normal');  // 敵彈（畫在敵人底下：看起來從砲管／機身邊緣射出）
    this.g = new PIXI.Graphics(); L.fx.addChild(this.g);           // 電弧、光圈（每幀重畫）
    this.g.blendMode = 'add';
    this.styles = {
      small: new PIXI.TextStyle({ fontFamily: 'Segoe UI, Microsoft JhengHei, sans-serif', fontSize: 15, fontWeight: 'bold', fill: '#ffffff', stroke: { color: '#03050c', width: 3.5, join: 'round' } }),
      big: new PIXI.TextStyle({ fontFamily: 'Microsoft JhengHei, Segoe UI, sans-serif', fontSize: 21, fontWeight: 'bold', fill: '#ffffff', stroke: { color: '#03050c', width: 4, join: 'round' } }),
    };
    const tS = new PIXI.Container(), tB = new PIXI.Container(); L.texts.addChild(tS, tB);  // 大數字的圖層在上面
    this.pTs = GLR.pool('txtS', tS, () => new PIXI.BitmapText({ text: '', style: this.styles.small }));
    this.pTb = GLR.pool('txtB', tB, () => new PIXI.BitmapText({ text: '', style: this.styles.big }));
    this.tx = { dot: GLR.T('b/dot'), halo: GLR.T('b/halo'), line: GLR.T('b/line'), dart: GLR.T('b/dart'), blade: GLR.T('b/blade'), ring: GLR.T('b/ring'), eb: GLR.T('eb'), sq: GLR.T('p/sq'), ebRim: GLR.T('eb_rim'), ebFill: GLR.T('eb_fill'), ebw: GLR.T('b/ebw'), ice: GLR.T('b/ice') };
    this.res = { dot: GLR.res('b/dot'), line: GLR.res('b/line'), dart: GLR.res('b/dart'), blade: GLR.res('b/blade'), ring: GLR.res('b/ring'), eb: GLR.res('eb'), sq: GLR.res('p/sq'), ebFill: GLR.res('eb_fill'), ebw: GLR.res('b/ebw'), ice: GLR.res('b/ice') };
  },
  spr(P, tex, x, y) { return P.get(tex, x, y); },

  draw() {
    const G = Game, tx = this.tx, R = this.res, P = this.pB;
    this.pB.begin(); this.pP.begin(); this.pEB.begin();
    // 我方子彈：飛船 50 內變淡（最淡 20%），相刃不變淡
    const ships = G.players(), FADE = 50;
    for (const b of G.bullets) {
      let fa = 1;
      if (b.shape !== 'blade') for (const p of ships) fa = Math.min(fa, 0.2 + 0.8 * Math.min(1, Math.hypot(b.x - p.x, b.y - p.y) / FADE));
      const col = glColor(b.color);
      if (b.shape === 'rail') {
        const t1 = tail(b, 60), t2 = tail(b, 34);
        let s = this.spr(P, tx.line, b.x, b.y); s.rotation = b.angle; s.scaleX = t1 / R.line; s.scaleY = (b.r + 2) / R.line; s.tint = col; s.alpha = 0.35 * fa;
        s = this.spr(P, tx.line, b.x, b.y); s.rotation = b.angle; s.scaleX = t2 / R.line; s.scaleY = b.r * 0.6 / R.line; s.tint = 0xfff6d8; s.alpha = fa;
      } else if (b.shape === 'line') {
        const t = tail(b, 18);
        const s = this.spr(P, tx.line, b.x, b.y); s.rotation = b.angle; s.scaleX = Math.max(t, 0.5) / R.line; s.scaleY = b.r / R.line; s.tint = col; s.alpha = fa;
        const d = this.spr(P, tx.dot, b.x, b.y); d.scaleX = d.scaleY = b.r * 0.5 / R.dot; d.tint = col; d.alpha = fa;  // 圓頭
      } else if (b.shape === 'ice') {  // 彗星的冰晶碎片：邊飛邊轉
        const s = this.spr(P, tx.ice, b.x, b.y); s.rotation = b.angle + b.life * 14; s.scaleX = s.scaleY = b.r * 1.7 / R.ice; s.tint = col; s.alpha = fa;
      } else if (b.shape === 'reflect') {  // 反射鏡反彈：敵彈的圓球外形、我方的顏色
        const s = this.spr(P, tx.ebw, b.x, b.y); s.scaleX = s.scaleY = b.r / R.ebw; s.tint = col; s.alpha = fa;
      } else if (b.shape === 'dart') {
        const s = this.spr(P, tx.dart, b.x, b.y); s.rotation = b.angle; s.scaleX = s.scaleY = b.r / R.dart; s.tint = col; s.alpha = fa;
      } else if (b.park && b.park.kind === 'disc') {  // 迴旋飛輪：外環＋三片轉動的刃（停住時轉得快）
        const spin = G.time * (b.mode === 'park' ? 22 : 12), w = b.r * 1.5;
        const o = this.spr(P, tx.ring, b.x, b.y); o.scaleX = o.scaleY = b.r / R.ring; o.tint = col; o.alpha = fa;
        for (let k = 0; k < 3; k++) {
          const a = spin + k * TAU / 3, s = this.spr(P, tx.blade, b.x + Math.cos(a) * b.r * 0.55, b.y + Math.sin(a) * b.r * 0.55);
          s.rotation = a + Math.PI / 2; s.scaleX = s.scaleY = w / R.blade; s.tint = col; s.alpha = fa;
        }
        continue;
      } else if (b.shape === 'blade') {
        const w = b.r * BLADE_FX.size, a0 = Math.min(1, b.life * 6), cos = Math.cos(b.angle), sin = Math.sin(b.angle);
        for (let k = BLADE_FX.trail; k >= 1; k--) {  // 殘影：往飛回來的方向排幾張淡的，看得出刃片揮過的軌跡
          const s = this.spr(P, tx.blade, b.x - cos * k * BLADE_FX.gap, b.y - sin * k * BLADE_FX.gap); s.rotation = b.angle; s.scaleX = s.scaleY = w * (1 - k * 0.1) / R.blade; s.tint = col; s.alpha = a0 * 0.4 / k;
        }
        const s = this.spr(P, tx.blade, b.x, b.y); s.rotation = b.angle; s.scaleX = s.scaleY = w / R.blade; s.tint = col; s.alpha = a0;
        continue;
      } else {
        if (b.shape === 'orb') { const h = this.spr(P, tx.halo, b.x, b.y); h.scaleX = h.scaleY = b.r * 1.8 / R.dot; h.tint = col; h.alpha = fa; }
        const s = this.spr(P, tx.dot, b.x, b.y); s.scaleX = s.scaleY = b.r / R.dot; s.tint = col; s.alpha = fa;
      }
    }
    // 能量刃彈反的格擋時間：飛船外圍一圈亮的護盾（最後幾幀淡掉）
    for (const p of ships) {
      if (!(p.parryWinT > 0)) continue;
      const al = Math.min(1, p.parryWinT / 0.08);
      const h = this.spr(P, tx.halo, p.x, p.y); h.scaleX = h.scaleY = PARRY.r * 1.1 / R.dot; h.tint = 0xff8fd8; h.alpha = 0.35 * al;
      const r = this.spr(P, tx.ring, p.x, p.y); r.scaleX = r.scaleY = PARRY.r / R.ring; r.tint = 0xffd6f3; r.alpha = al;
    }
    // 彗星爆炸的閃光：淡藍白的光暈很快擴大變淡＋中心亮點
    for (const f of FX.flashes) {
      const k = f.life / f.max;
      const h = this.spr(this.pP, tx.halo, f.x, f.y); h.scaleX = h.scaleY = f.r * (0.7 + 0.5 * (1 - k)) / R.dot; h.tint = 0xd8f4ff; h.alpha = k * 0.9;
      const d = this.spr(this.pP, tx.dot, f.x, f.y); d.scaleX = d.scaleY = f.r * 0.3 * k / R.dot; d.alpha = k;
    }
    // 粒子
    for (const q of FX.particles) { const s = this.spr(this.pP, tx.sq, q.x, q.y); s.scaleX = s.scaleY = q.size / R.sq; s.tint = glColor(q.color); s.alpha = q.life / q.max; }
    // 電弧、光圈
    const g = this.g; g.clear();
    // 武器原型：重力井的吸引範圍、鉤爪拉著的線、無人機
    for (const b of G.bullets) if (b.mode === 'park' && b.park.kind === 'well') g.circle(b.x, b.y, wellR(b)).stroke({ width: 1.5, color: 0xc77dff, alpha: 0.18 + 0.12 * Math.sin(G.time * 6) ** 2 });
    for (const b of G.bullets) if (b.vortex > 0) for (let k = 0; k < 3; k++) {  // 漩渦晶片：吸引範圍，三圈往中心收
      const q = (G.time * 1.5 + k / 3) % 1;
      g.circle(b.x, b.y, b.vortex * (1 - q)).stroke({ width: 2, color: 0xb388ff, alpha: 0.5 * q });
    }
    for (const p of ships) {
      if (p.hookE && !p.hookE.dead) { g.moveTo(p.x, p.y); g.lineTo(p.hookE.x, p.hookE.y); g.stroke({ width: 2.5, color: 0xffd166, alpha: 0.85 }); }
      for (const d of ((Net.role === 'client' || loadoutOf(p).weapon.id === 'drone') && p.drones) || []) {  // 隊友那邊：房主同步來的（換武器就是空的）
        if (d.down > 0) continue;  // 壞掉、等重生
        const h = this.spr(this.pP, tx.halo, d.x, d.y); h.scaleX = h.scaleY = 16 / R.dot; h.tint = p.guardT > 0 ? 0xffffff : 0x7cf5c8; h.alpha = 0.45;
        const c = this.spr(this.pP, tx.dart, d.x, d.y); c.rotation = d.a || 0; c.scaleX = c.scaleY = 9 / R.dart; c.tint = 0xe8fff6;  // 機身朝移動方向（DroneSwarm.tick 的 d.a）
      }
    }
    for (const z of FX.zaps) {
      const dx = z.x2 - z.x1, dy = z.y2 - z.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      g.moveTo(z.x1, z.y1);
      for (let k = 1; k < 6; k++) { const j = rand(-10, 10); g.lineTo(z.x1 + dx * k / 6 + nx * j, z.y1 + dy * k / 6 + ny * j); }
      g.lineTo(z.x2, z.y2); g.stroke({ width: 2, color: glColor(z.c || '#9fe8ff'), alpha: z.life / z.max });
    }
    for (const r of FX.rings) { const t = 1 - r.life / r.max; g.circle(r.x, r.y, r.r * (r.shrink ? 1 - 0.75 * t : 0.4 + 0.6 * t)).stroke({ width: 3, color: glColor(r.color), alpha: r.shrink ? 0.4 + 0.6 * t : r.life / r.max }); }  // shrink：往內收、越收越亮（壓縮的吸入）
    // 敵彈（不用加法混色：紅色實心＋深色外框，才不會被我方彈幕蓋掉）
    for (const b of G.eBullets) {
      if (b.mine) {  // 精英「佈雷」的地雷：紅框＋黃芯，一閃一閃（最後 2 秒閃得快）；外面一圈淡淡的爆炸範圍
        const s = this.spr(this.pEB, tx.ebRim, b.x, b.y); s.scaleX = s.scaleY = b.r / R.eb;
        const f = this.spr(this.pEB, tx.ebFill, b.x, b.y); f.scaleX = f.scaleY = b.r / R.ebFill; f.tint = 0xffd400;
        f.alpha = 0.55 + 0.45 * Math.sin(G.time * (b.life < 2 ? 30 : 8)) ** 2;
        g.circle(b.x, b.y, AFFIX.mine.r).stroke({ width: 1.5, color: 0xffd400, alpha: 0.18 });
        continue;
      }
      const s = this.spr(this.pEB, b.col ? tx.ebRim : tx.eb, b.x, b.y); s.scaleX = s.scaleY = b.r / R.eb;
      if (b.col) { const f = this.spr(this.pEB, tx.ebFill, b.x, b.y); f.scaleX = f.scaleY = b.r / R.ebFill; f.tint = glColor(b.col); }  // 盾衛反彈：紅框＋原本子彈顏色的芯
    }
    this.pB.end(); this.pP.end(); this.pEB.end();
  },
  // 浮動數字：深色外框（字型本身帶外框）＋染色；大數字畫在最上層
  drawTexts() {
    for (const big of [false, true]) {
      const P = big ? this.pTb : this.pTs;
      for (const t of FX.texts) {
        if (!t.big !== !big) continue;
        const s = GLR.take(P);
        const txt = String(t.text); if (s.text !== txt) s.text = txt;
        s.anchor.set(0.5, 0.8); s.position.set(t.x, t.y); s.tint = glColor(t.color); s.alpha = Math.min(1, t.life * 2);
      }
    }
  },
};
