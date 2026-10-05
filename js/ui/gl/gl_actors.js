// 星環電路 雙人版 · gl/gl_actors.js：WebGL 繪圖層：敵人（動畫格照牠在遊戲裡的狀態挑）、預警線、狀態圈、飛船（船身、噴焰、零件、背包模組效果）、倒下的隊友
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

const GLActors = {
  init() {
    const L = GLR.L, S = () => new PIXI.Sprite();
    this.pE = GLR.pool('enemy', L.enemies, S);
    this.gE = new PIXI.Graphics(); L.eFx.addChild(this.gE);     // 狀態圈、血條、預警線、鎖定框
    this.pEt = GLR.pool('eTxt', L.eFx, () => new PIXI.BitmapText({ text: '?', style: { fontFamily: 'Segoe UI, sans-serif', fontSize: 14, fontWeight: 'bold', fill: '#ff8f8f' } }));
    this.pS = GLR.pool('ship', L.ships, S);
    this.gS = new PIXI.Graphics(); L.ships.addChild(this.gS);   // 零件、護盾圈、蓄力環
    this.pSt = GLR.pool('sTxt', L.ships, () => new PIXI.BitmapText({ text: '', style: { fontFamily: 'Segoe UI, Microsoft JhengHei, sans-serif', fontSize: 12, fontWeight: 'bold', fill: '#ffffff' } }));
    this.glow = GLR.T('glow'); this.glowRes = GLR.res('glow');
    this.worm = new Map();  // 列隊蟲：哪一節什麼時候變成頭（大顎長出來的動畫）
  },
  frame(name, k) { return GLR.T(`e/${name}/${k}`); },
  spr(tex, x, y, scale, rot = 0) { const s = GLR.sprite(this.pE, tex); s.position.set(x, y); s.scale.set(scale); s.rotation = rot; return s; },
  glowAt(P, x, y, r, col, a) { const s = GLR.sprite(P, this.glow); s.position.set(x, y); s.scale.set(r / this.glowRes); s.tint = col; s.alpha = a; s.blendMode = 'add'; return s; },

  draw() {
    const G = Game, g = this.gE; g.clear();
    const viewer = G.player.dead && G.mate && !G.mate.dead ? G.mate : G.player;
    this.wormInfo();
    for (const e of G.enemies) {
      const rock = e.t.boss ? null : Objects.blocker(viewer, e);
      if (rock) {  // 被小行星擋住：只在小行星邊緣畫一個淡淡的「？」
        const a = Math.atan2(e.y - rock.y, e.x - rock.x), q = GLR.take(this.pEt);
        q.anchor.set(0.5); q.position.set(rock.x + Math.cos(a) * (rock.r + 10), rock.y + Math.sin(a) * (rock.r + 10)); q.alpha = 0.35;
        continue;
      }
      this.enemy(e);
    }
    for (const e of G.enemies) this.telegraph(e);
    const tg = G.player.target;
    if (Input.touch && tg && !tg.dead) {  // 自動攻擊的鎖定框
      const r = tg.r + 10, s = G.time * 3;
      for (let i = 0; i < 4; i++) { glArc(g, tg.x, tg.y, r, s + i * TAU / 4, s + i * TAU / 4 + 0.6); g.stroke({ width: 2, color: 0x9dff6b, alpha: 0.85 }); }
    }
    this.ships();
  },

  // 列隊蟲：每節要知道自己是不是頭（前面沒有活著的節）、是不是尾（後面沒有節）
  wormInfo() {
    const W = Game.enemies.filter(e => e.type === 'worm' && !e.dead), behind = new Set(), now = Game.time;
    this.wormHead = new Set(); this.wormTail = new Set();
    const host = W.length && W[0].ahead !== undefined;
    for (const e of W) {
      let a = e.ahead; while (a && a.dead) a = a.ahead;
      if (host) { if (a) behind.add(a); else this.wormHead.add(e); }
      else {  // 隊友那邊沒有 ahead：前方 30 內沒有別節 → 頭
        const sp = Math.hypot(e.vx, e.vy) || 1, ux = e.vx / sp, uy = e.vy / sp;
        if (!W.some(o => o !== e && Math.abs((o.x - e.x) - ux * 22) < 12 && Math.abs((o.y - e.y) - uy * 22) < 12)) this.wormHead.add(e);
        const nb = W.find(o => o !== e && Math.abs((o.x - e.x) + ux * 22) < 12 && Math.abs((o.y - e.y) + uy * 22) < 12); if (nb) behind.add(e);
      }
    }
    for (const e of W) {
      if (!behind.has(e)) this.wormTail.add(e);
      const m = this.worm.get(e.id);
      if (this.wormHead.has(e)) { if (!m) this.worm.set(e.id, { t: e.spawnT > 0 || W.length === 1 || !host ? -9 : now }); }  // 一出生就是頭：不播長出來的動畫
      else if (m) this.worm.delete(e.id);
    }
    if (this.worm.size > 200) for (const k of this.worm.keys()) if (!W.some(e => e.id === k)) this.worm.delete(k);
  },

  enemy(e) {
    const G = Game, t = G.time, ty = e.type, T = ENEMY_TYPES[ty] || e.t, sp = e.spawnT > 0 ? 1 - e.spawnT / e.spawnMax : 1;
    const alpha = (0.3 + 0.7 * sp) * (1 - 0.9 * (e.cloak || 0)), k = (e.r / T.radius) * sp;
    let rot = ['swarmer', 'worm', 'splitling', 'lurker', 'spitter'].includes(ty) ? Math.atan2(e.vy, e.vx) : e.rot || 0;
    if (ty === 'spitter') rot = Math.atan2(G.player.y - e.y, G.player.x - e.x);
    if (ty === 'boss2' && e.mode !== 'chase') rot = e.chargeA;
    const base = (name, n, period, scaleRes = 2) => this.spr(this.frame(name, Math.floor(t / period * n) % n), e.x, e.y, k / scaleRes, rot);
    let main;
    switch (ty) {
      case 'swarmer': main = base('swarmer', 6, TAU / 40); break;
      case 'brute': { const curled = e.mode === 'windup' || e.mode === 'charge'; main = this.spr(this.frame(curled ? 'brute_ball' : 'brute', 0), e.x, e.y, k * (curled ? 0.9 : 1) / 2, rot); if (e.mode === 'stun' && Math.floor(t * 10) % 2) main.alpha = 0.5; break; }
      case 'spitter': { const cd = T.ranged ? T.ranged.cd : 1.8, p = e.cd != null ? 1 - clamp(e.cd / cd, 0, 1) : 0, f = p < 0.75 ? 0 : Math.min(7, 1 + Math.floor((p - 0.75) / 0.25 * 7)); main = this.spr(this.frame('spitter', f), e.x, e.y, k / 2, rot); break; }
      case 'elite': main = base('elite', 16, TAU / 1.1); break;
      case 'gunboat': { const ch = e.mode === 'windup' ? 1 - Math.max(0, e.modeT) / 0.6 : 0; main = this.spr(this.frame('gunboat', Math.round(clamp(ch, 0, 1) * 4)), e.x, e.y, k / 2, rot); break; }
      case 'worm': {
        const head = this.wormHead.has(e), tailSeg = !head && this.wormTail.has(e), leg = Math.floor((t * 12 / TAU + (e.id % 4) * 0.25) * 4) % 4;
        if (head) { const m = this.worm.get(e.id), grow = m && m.t > 0 ? clamp((t - m.t) / 0.3, 0, 1) : 1; main = this.spr(GLR.T(`e/worm_head/${Math.round(grow * 3) * 4 + leg}`), e.x, e.y, k / 3, rot); }
        else main = this.spr(GLR.T(`e/worm_${tailSeg ? 'tail' : 'body'}/${leg}`), e.x, e.y, k / 3, rot);
        break;
      }
      case 'shield': main = this.spr(this.frame('shield', Math.floor(t / (TAU / 1.6) * 12) % 12), e.x, e.y, k / 2, e.shieldA != null ? e.shieldA : rot); break;
      case 'splitter': main = base('splitter', 8, TAU / 3); break;
      case 'splitling': main = this.spr(this.frame('splitling', 0), e.x, e.y, k / 3, rot); break;
      case 'lurker': main = base('lurker', 4, TAU / 9); break;
      case 'hive': { const ph = e.cd != null ? clamp(4 - e.cd, 0, 3.999) : t % 4; main = this.spr(this.frame('hive', Math.floor(ph / 4 * 16)), e.x, e.y, k / 2, 0); break; }
      case 'dummy': main = this.spr(this.frame('dummy', 0), e.x, e.y, k / 2, 0); break;
      case 'boss': {
        const ring = this.spr(this.frame('boss_ring', 0), e.x, e.y, k / 2, t * 0.6); ring.alpha = alpha;
        if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.2, 0xffd166, 0.35 + 0.25 * Math.sin(t * 12));
        main = this.spr(this.frame('boss', Math.floor(t / 2 * 16) % 16), e.x, e.y, k / 2, 0);
        break;
      }
      case 'boss2': main = base('boss2', 4, TAU / 7); if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.2, 0xffd166, 0.3); break;
      case 'boss3': {
        const o = this.spr(this.frame('boss3_ring_out', 0), e.x, e.y, k / 2, t * 0.35); o.alpha = alpha;
        const i = this.spr(this.frame('boss3_ring_in', 0), e.x, e.y, k / 2, -t * 0.6); i.alpha = alpha;
        if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r, 0xffd166, 0.4 + 0.3 * Math.sin(t * 12));
        main = this.spr(this.frame('boss3_core', Math.floor(t / (TAU / 3) * 8) % 8), e.x, e.y, k / 2, 0);
        break;
      }
      default: main = this.glowAt(this.pE, e.x, e.y, e.r, glColor(T.color || '#ffffff'), 1);
    }
    main.alpha = (main.alpha < 1 ? main.alpha : 1) * alpha;
    if (e.flash > 0) { const f = GLR.sprite(this.pE, main.texture); f.position.copyFrom(main.position); f.scale.copyFrom(main.scale); f.rotation = main.rotation; f.blendMode = 'add'; f.alpha = 0.85; }  // 受傷閃白
    // 狀態圈
    const g = this.gE;
    if (e.slowT > 0) g.circle(e.x, e.y, e.r + 5).stroke({ width: 1.5, color: 0x7fd4ff, alpha: 0.8 });
    if (e.markT > 0 || e.shredT > 0) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + t; glArc(g, e.x, e.y, e.r + 8, a, a + 0.5); g.stroke({ width: 1.5, color: 0xff5a5a, alpha: 0.8 }); }
    if (e.burnT > 0) g.circle(e.x, e.y, e.r + 2).stroke({ width: 2, color: 0xff9f1c, alpha: 0.4 + 0.4 * Math.sin(t * 20) });
    const stuck = e.stuckN != null ? e.stuckN : e.stuck ? e.stuck.length : 0;
    if (stuck) { const n = Math.min(stuck, 16); for (let i = 0; i < n; i++) { const a = i / n * TAU + t * 2; g.circle(e.x + Math.cos(a) * (e.r + 3), e.y + Math.sin(a) * (e.r + 3), 2.5).fill({ color: 0xf78cff }); } }
    if (e.spawnT > 0) g.circle(e.x, e.y, e.r * (2.2 - sp)).stroke({ width: 1, color: glColor(T.color), alpha: 0.8 });
    if (e.hp < e.maxHp && !['swarmer', 'worm', 'splitling'].includes(ty) && !T.boss && !(e.cloak > 0.5)) {
      const w = ty === 'elite' ? e.r * 3 : e.r * 2;
      g.rect(e.x - w / 2, e.y - e.r - 12, w, 4).fill({ color: 0x330000 });
      g.rect(e.x - w / 2, e.y - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4).fill({ color: glColor(T.color) });
    }
  },

  // 衝鋒／滾球預警線：一律紅色
  telegraph(e) {
    if (e.mode !== 'windup') return;
    const g = this.gE, t = Game.time;
    let len, alpha, w = e.r * 1.6;
    if (e.type === 'elite') { len = 320; alpha = 0.3 + 0.5 * Math.sin(t * 30) ** 2; w = e.r * 1.4; }
    else if (e.type === 'brute') { len = CFG.BRUTE.rollSpeed * CFG.BRUTE.rollT; alpha = e.modeT <= CFG.BRUTE.lock ? 0.55 : 0.2; }
    else if (e.type === 'boss2') { len = 520; alpha = 0.25 + 0.45 * Math.sin(t * 30) ** 2; }
    else if (e.type === 'lurker') { len = 520 * 0.4; alpha = 0.3 + 0.5 * Math.sin(t * 30) ** 2; }
    else if (e.type === 'gunboat') { g.circle(e.x, e.y, e.r + 6 + 40 * Math.max(0, e.modeT) / 0.6).stroke({ width: 3, color: 0xff2a2a, alpha: 0.35 + 0.4 * Math.sin(t * 30) ** 2 }); return; }
    else return;
    g.moveTo(e.x, e.y).lineTo(e.x + Math.cos(e.chargeA) * len, e.y + Math.sin(e.chargeA) * len).stroke({ width: w, color: 0xff2a2a, alpha });
  },

  // ---------- 飛船 ----------
  ships() {
    const G = Game, g = this.gS; g.clear();
    const tagOf = me => G.mate ? (Net.role === 'host' ? (me ? '1P' : '2P') : (me ? '2P' : '1P')) : '';
    if (G.mate && G.state === 'play') {
      if (G.mate.dead && !G.mate.gone) this.downed(G.mate, tagOf(false), !G.player.dead);
      if (G.player.dead) this.downed(G.player, tagOf(true), false);
    }
    if (G.mate && !G.mate.dead && !G.mate.gone) this.ship(G.mate, tagOf(false));
    if (G.state !== 'dead' && !G.player.dead) this.ship(G.player, tagOf(true));
  },
  ship(p, tag) {
    const G = Game, g = this.gS, t = G.time, S = p.ship, A = SHIP_ART.get(S), own = p === G.player, P = this.pS;
    const parts = own ? G.parts : p.L ? p.L.parts : p.parts || {}, mod = own ? G.module : p.L ? p.L.module : p.module;
    const n = id => (parts && parts[id]) || 0, a = p.aim, ca = Math.cos(a), sa = Math.sin(a);
    const L = (lx, ly) => [p.x + lx * ca - ly * sa, p.y + lx * sa + ly * ca];  // 船的座標 → 世界座標
    const fade = p.iframe > 0 && Math.floor(t * 20) % 2 ? 0.35 : 1, col = glColor(S.color);
    const sprL = (tex, lx, ly, sc, rot = 0) => { const [x, y] = L(lx, ly), s = GLR.sprite(P, tex); s.position.set(x, y); s.scale.set(sc); s.rotation = a + rot; s.alpha = fade; return s; };
    if (tag) { const q = GLR.take(this.pSt); if (q.text !== tag) q.text = tag; q.anchor.set(0.5, 1); q.position.set(p.x, p.y - p.r - 8); q.tint = col; q.alpha = 1; }
    // 背包模組（船後面那層）
    if (mod === 'gravity') sprL(GLR.T('m/gravity'), 0, 0, 1 / 3, t);
    if (mod === 'thruster') sprL(GLR.T('m/thruster'), 0, 0, 1 / 3);
    if (mod === 'blink') for (let k = 3; k >= 1; k--) { const s = sprL(GLR.T(`s/${A.id}/0`), -k * 7, 0, 1 / 4); s.alpha = fade * 0.32 * (4 - k) / 3; s.tint = col; }
    // 零件：散熱鰭、感測器天線（船底下）
    if (n('sink')) for (let i = 0; i < Math.min(4, n('sink')); i++) for (const sg of [-1, 1]) { const [x0, y0] = L(-2 - i * 4, sg * 9), [x1, y1] = L(-5 - i * 4, sg * 16); g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2, color: 0x8f9bb8, alpha: fade }); }
    if (n('sensor')) { const [x0, y0] = L(16, 0), [x1, y1] = L(22 + n('sensor') * 2, 0); g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.5, color: 0x8f9bb8, alpha: fade }); g.circle(x1, y1, 2).fill({ color: 0x9dff6b, alpha: fade }); }
    // 衝刺／超頻：外框發船色光暈；移動：船尾火光＋噴焰
    if (p.dashT > 0 || p.overdrive > 0) this.glowAt(P, p.x, p.y, 34, col, 0.75 * fade);
    if (p.moving) {
      const [gx, gy] = L(A.nx - 5, 0); this.glowAt(P, gx, gy, 7 + Math.sin(t * 30) * 0.8, 0x9ad7ff, 0.6 * fade);
      const len = 9 + n('booster') * 4 + Math.sin(t * 40) * 2 + rand(0, 3), fr = GLR.res('s/flame');
      const f = sprL(GLR.T('s/flame'), A.nx - 2.8, 0, 1); f.anchor.set(0.75, 0.5); f.scale.set(len / fr, 6.4 / fr); f.alpha = fade * rand(0.75, 1); f.blendMode = 'add'; if (n('booster')) f.tint = 0xcfeeff;
    }
    if (A.id === 'gate') sprL(GLR.T('s/gate_ring'), -9, 0, 1 / 4, t * 2);  // 星門號：船尾旋轉的傳送環
    // 船身（重裝甲層數決定哪一張）
    sprL(GLR.T(`s/${A.id}/${Math.min(4, n('armor'))}`), 0, 0, 1 / 4);
    // 背包模組（船上面那層）
    if (mod === 'shield') sprL(GLR.T('m/shield'), 0, 0, 1 / 3, t * 0.3);
    if (mod === 'reactive') sprL(GLR.T('m/reactive'), 0, 0, 1 / 3);
    if (mod === 'endshell') sprL(GLR.T('m/endshell'), 0, 0, 1 / 3, -t * 0.4);
    if (mod === 'swarmcore') sprL(GLR.T(`m/swarmcore/${Math.floor(t / (TAU / 4) * 8) % 8}`), 0, 0, 1 / 3);
    if (mod === 'drone') { const da = t * 1.8, s = GLR.sprite(P, GLR.T('m/drone')); s.position.set(p.x + Math.cos(da) * 22, p.y + Math.sin(da) * 22); s.scale.set(1 / 4); s.rotation = da + Math.PI / 2; s.alpha = fade; }
    // 外圈：輕裝甲薄殼、護盾、重力井範圍、蓄力環
    for (let i = 0; i < Math.min(3, n('larmor')); i++) g.circle(p.x, p.y, 22 + i * 4).stroke({ width: 1, color: 0x9fe8ff, alpha: 0.45 * fade });
    for (let i = 0; i < (p.shield || 0); i++) g.circle(p.x, p.y, 26 + i * 5).stroke({ width: 2.5, color: 0x4cc9f0, alpha: 0.85 * fade });
    if (p.gravField) this.dashed(g, p.x, p.y, p.gravField.R, 4, 8, { width: 1.5, color: 0xb388ff, alpha: 0.35 });
    if (own && G.stats && G.stats.charge && (p.chargeC || 0) > 0.02) {
      const k = Math.min(1, p.chargeC), full = k >= 1;
      g.circle(p.x, p.y, 34).stroke({ width: 4, color: 0xffb347, alpha: 0.18 });
      glArc(g, p.x, p.y, 34, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke({ width: full ? 5 : 4, color: full ? 0xffffff : 0xffb347 });
      if (full) this.glowAt(P, p.x, p.y, 44, 0xffffff, 0.25 + 0.15 * Math.sin(t * 10));
    }
  },
  dashed(g, x, y, r, on, off, st) {  // 虛線圓
    const step = (on + off) / r, seg = on / r;
    for (let a = 0; a < TAU; a += step) { glArc(g, x, y, r, a, Math.min(TAU, a + seg)); g.stroke(st); }
  },
  // 雙人：倒下的飛船（灰色殘骸）＋救援範圍虛線圈＋綠色進度弧
  downed(p, tag, mine) {
    const g = this.gS, R = CFG.REVIVE, k = Math.min(1, (p.reviveT || 0) / R.time), pulse = 0.5 + 0.5 * Math.sin(Game.time * 4);
    this.dashed(g, p.x, p.y, R.range, 6, 6, { width: 2, color: 0x9dff6b, alpha: 0.35 + 0.35 * pulse });
    if (k > 0) { glArc(g, p.x, p.y, R.range, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke({ width: 5, color: 0x9dff6b }); }
    const s = GLR.sprite(this.pS, GLR.T(`s/${SHIP_ART.get(p.ship).id}/0`)); s.position.set(p.x, p.y); s.scale.set(1 / 4); s.rotation = p.aim; s.tint = 0x777777; s.alpha = 0.5;
    const q = GLR.take(this.pSt), txt = k > 0 ? `${tag} 救援中 ${Math.round(k * 100)}%` : `${tag} 倒下${mine ? ' · 靠近救援' : ' · 等隊友救援'}`;
    if (q.text !== txt) q.text = txt; q.anchor.set(0.5, 1); q.position.set(p.x, p.y - R.range - 8); q.tint = 0x9dff6b; q.alpha = 1;
  },
};
