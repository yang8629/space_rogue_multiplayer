// 星環電路 多人版 · gl/gl_actors.js：WebGL 繪圖層：敵人（動畫格照牠在遊戲裡的狀態挑）、預警線、狀態圈、飛船（船身、噴焰、零件、護盾）、殘影、倒下的隊友
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 武器模型（從上往下看、槍口朝 +x、長約 85、寬不超過 ±17：放得進武器架的展示框）：每把武器幾塊零件 [點, 材質, 什麼時候畫]
//   材質 metal 金屬、dark 深色金屬、accent 武器色的能量部件、light 白色核心、core 黑色奇點、heat 散熱鰭（照熱度從金屬色燒到橘紅）
//   什麼時候畫：照武器狀態 st（WEAPON_STATE）決定，看外觀就知道武器現在的狀態（飛輪架上剩幾個、鉤爪在不在、無人機停了幾架…）
//   畫法：零件填色＋上半塊亮、下半塊暗（光從上來）＋深色描邊；glow 是加法發光的位置 [x, y, r, 強度(st), 'hot' = 燒紅的橘色（不給 = 武器色）]；基地（武器架、船頭）和戰鬥（船頭）共用
const R4 = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const wRing = (cx, cy, r, n = 16) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * TAU) * r, cy + Math.sin(i / n * TAU) * r]);  // 圓（多邊形近似）
const wGear = (cx, cy, r) => Array.from({ length: 16 }, (_, i) => { const q = i % 2 ? r * 0.72 : r, u = i / 16 * TAU + 0.2; return [cx + Math.cos(u) * q, cy + Math.sin(u) * q]; });  // 鋸齒圓輪
const W_DISC = [[22, 0], [5, 0], [-12, 0]];       // 飛輪架上三個飛輪的位置（最前面的先丟出去）
const W_DOCK = [[-10, -11], [4, -11], [-10, 11], [4, 11]];  // 無人機的四個停靠位
const WEAPON_MODEL = {
  laser: { parts: [  // 熱能光束：長砲管、兩側一排散熱鰭片（越熱越紅）
    [[[-40, -7], [-28, -9], [-28, 9], [-40, 7]], 'dark'], [[[-28, -8], [14, -8], [18, -5], [18, 5], [14, 8], [-28, 8]], 'metal'],
    ...[-22, -13, -4, 5].flatMap(x => [[[[x, -8], [x + 6, -8], [x + 4, -15], [x - 1, -15]], 'heat'], [[[x, 8], [x + 6, 8], [x + 4, 15], [x - 1, 15]], 'heat']]),
    [R4(18, -3.5, 44, 3.5), 'dark'], [R4(36, -5.5, 40, 5.5), 'metal'], [R4(-24, -2, 12, 2), 'accent']],
    glow: [[44, 0, 4, () => 1], ...[-19, -10, -1, 8].flatMap(x => [[x, -12, 4, st => st.heat, 'hot'], [x, 12, 4, st => st.heat, 'hot']])] },
  scatter: { parts: [  // 迴旋飛輪：托架上掛著三個鋸齒圓輪，丟出去幾個架上就少幾個
    [[[-40, -6], [-24, -8], [-24, 8], [-40, 6]], 'dark'], [R4(-24, -5, 30, 5), 'metal'], [R4(-22, -14, 30, -10), 'dark'], [R4(-22, 10, 30, 14), 'dark'],
    ...W_DISC.flatMap(([x, y], i) => [[wGear(x, y, 9.5), 'accent', st => st.n > i], [wRing(x, y, 3.5, 8), 'dark', st => st.n > i]])],
    glow: W_DISC.map(([x, y], i) => [x, y, 4, st => st.n > i ? 0.7 : 0]) },
  plasma: { parts: [  // 重力井：環形發生器包著黑色奇點（發射出去的井越多越暗，冷卻好了再亮）、前面兩根導引爪
    [[[-38, -7], [-14, -12], [14, -12], [18, -8], [18, 8], [14, 12], [-14, 12], [-38, 7]], 'metal'],
    [[[18, -10], [36, -8], [36, -4], [18, -3]], 'metal'], [[[18, 3], [36, 4], [36, 8], [18, 10]], 'metal'], [R4(32, -8, 36, -4), 'accent'], [R4(32, 4, 36, 8), 'accent'],
    [wRing(0, 0, 11.5), 'dark'], [wRing(0, 0, 8), 'accent'], [wRing(0, 0, 5.5), 'core']],
    glow: [[0, 0, 7, st => 0.3 + 0.7 * st.charge], [34, -6, 2.5, () => 0.6], [34, 6, 2.5, () => 0.6]] },
  railgun: { parts: [  // 牽引鉤：後面一個絞盤、纜繩、前面的鉤爪頭（鉤出去時發射座空著）
    [wRing(-28, 0, 10), 'metal'], [wRing(-28, 0, 6), 'dark'], [R4(-20, -6, 22, 6), 'metal'], [R4(-12, -10, 6, -6), 'dark'], [R4(-12, 6, 6, 10), 'dark'],
    [R4(-28, -1.2, 24, 1.2), 'accent'],
    [[[22, -5], [30, -5], [33, 0], [30, 5], [22, 5]], 'dark', st => !st.out],
    [[[28, -4], [40, -12], [44, -8], [34, -1]], 'metal', st => !st.out], [[[28, 4], [40, 12], [44, 8], [34, 1]], 'metal', st => !st.out],
    [R4(22, -3, 26, 3), 'core', st => st.out]],
    glow: [[32, 0, 3, st => st.out ? 0 : 0.8], [-28, 0, 3, () => 0.4]] },
  blade: { parts: [  // 能量刃：刀柄、護手、發射口，刃身是能量光（彈反成功後的加傷時間裡刃身更亮更寬）
    [R4(-38, -4, -16, 4), 'dark'], ...[-33, -27, -21].map(x => [R4(x, -4.5, x + 2, 4.5), 'metal']),
    [[[-16, -13], [-9, -13], [-6, -5], [-6, 5], [-9, 13], [-16, 13]], 'metal'], [R4(-6, -5, 0, 5), 'metal'],
    [[[0, -6], [34, -4], [47, 0], [34, 4], [0, 6]], 'accent'], [[[2, -2], [38, 0], [2, 2]], 'light'],
    [[[0, -9], [34, -6], [50, 0], [34, 6], [0, 9]], 'accent', st => st.edge], [[[2, -4], [40, 0], [2, 4]], 'light', st => st.edge]],
    glow: [[22, 0, 8, st => st.edge ? 1.6 : 0.8]] },
  drone: { parts: [  // 無人機蜂群：小型機庫架，四個停靠位（無人機飛出去時停靠位空著）
    [R4(-34, -5, 14, 5), 'metal'], [[[14, -5], [24, 0], [14, 5]], 'metal'], [R4(-18, -17, 12, -6), 'dark'], [R4(-18, 6, 12, 17), 'dark'],
    ...W_DOCK.map(([x, y]) => [R4(x - 5, y - 4, x + 5, y + 4), 'core']),
    ...W_DOCK.flatMap(([x, y], i) => [[[[x + 6, y], [x + 1, y - 3], [x - 5, y - 2.5], [x - 5, y + 2.5], [x + 1, y + 3]], 'metal', st => st.n > i], [R4(x + 1, y - 1, x + 3, y + 1), 'accent', st => st.n > i]])],  // 停著的無人機（跟飛出去的同一個外形：gl_fx.js droneBody）
    glow: W_DOCK.map(([x, y], i) => [x, y, 3, st => st.n > i ? 0.6 : 0]) },
};
// 武器的狀態（外觀跟著變）。只算自己的船：停在場上的飛輪、井、鉤爪要查子彈；隊友的資料是同步來的，不呼叫方法
//   其他人、武器架 = 待命（WEAPON_IDLE）
const WEAPON_IDLE = { heat: 0, n: 4, charge: 1, out: false, edge: false };
const WEAPON_STATE = {
  laser: p => ({ heat: p.hHeat || 0 }),
  scatter: p => ({ n: WEAPON_PLAY.scatter.max() - WEAPON_PLAY.scatter.count(p) }),
  plasma: p => ({ charge: 1 - WEAPON_PLAY.plasma.count(p) / WEAPON_PLAY.plasma.max() }),
  railgun: p => ({ out: !!p.hookE || Game.bullets.some(b => !b.dead && b.hook && b.ownerP === p) }),
  blade: p => ({ edge: p.edgeT > 0 }),
  drone: p => ({ n: (p.drones || []).filter(d => d.down > 0 || Math.hypot(d.x - p.x, d.y - p.y) < 24).length }),  // 壞掉的回機庫重建
};
const weaponState = (id, p) => ({ ...WEAPON_IDLE, ...(p && WEAPON_STATE[id] ? WEAPON_STATE[id](p) : {}) });
const W_METAL = 0x6a7699, W_HOT = 0xff6a2a;
const wMix = (c0, c1, k) => { const ch = s => Math.round(((c0 >> s) & 255) * (1 - k) + ((c1 >> s) & 255) * k); return (ch(16) << 16) | (ch(8) << 8) | ch(0); };
// 畫一把武器：(x, y) 中心、rot 朝向、k 大小、col 武器色；mode：'' 正常、'ghost' 很淡的輪廓（裝走了）、'dark' 暗色剪影（沒解鎖）；a = 透明度（無敵時間閃爍）
//   st：武器狀態（weaponState；不給 = 待命）
function glWeapon(g, id, x, y, rot, k, col, mode = '', glowFn = null, a = 1, st = WEAPON_IDLE) {
  const M = WEAPON_MODEL[id];
  if (!M) return;
  const c = Math.cos(rot), s = Math.sin(rot), T = ([lx, ly]) => [x + (lx * c - ly * s) * k, y + (lx * s + ly * c) * k];
  const fillOf = { metal: W_METAL, dark: 0x3a4566, accent: col, light: 0xffffff, core: 0x07040f, heat: wMix(W_METAL, W_HOT, Math.min(1, st.heat)) };
  for (const [pts, mat, show] of M.parts) {
    if (show && !show(st)) continue;
    const flat = pts.map(T).flat();
    if (mode === 'ghost') { g.poly(flat).stroke({ width: 1.5, color: col, alpha: 0.25 }); continue; }
    if (mode === 'dark') { g.poly(flat).fill({ color: 0x0a0d18, alpha: 0.9 }).stroke({ width: 1.5, color: 0x5a6a9e, alpha: 0.5 }); continue; }
    g.poly(flat).fill({ color: fillOf[mat], alpha: a });
    if (mat !== 'light' && mat !== 'core') {  // 上半塊亮、下半塊暗（光從上來）
      g.poly(pts.map(([lx, ly]) => T([lx, Math.min(ly, 0)])).flat()).fill({ color: 0xffffff, alpha: (mat === 'accent' ? 0.25 : 0.2) * a });
      g.poly(pts.map(([lx, ly]) => T([lx, Math.max(ly, 0)])).flat()).fill({ color: 0x000000, alpha: 0.2 * a });
    }
    g.poly(flat).stroke({ width: 1.8, color: 0x03050c, alpha: a });
  }
  if (glowFn && !mode) for (const [gx, gy, r, f, hot] of M.glow) {
    const w = f(st); if (!(w > 0)) continue;
    const [px, py] = T([gx, gy]); glowFn(px, py, r * 4 * k, hot ? W_HOT : col, 0.45 * a * Math.min(1.6, w));
  }
}

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

  // 敵人本體和狀態圈（戰鬥、基地的標靶機共用）
  enemies() {
    const G = Game, g = this.gE; g.clear();
    const viewer = G.viewShip();
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
  },
  draw() {
    const G = Game, g = this.gE;
    this.enemies();
    for (const e of G.enemies) this.telegraph(e);
    this.bossBeams();
    const tg = G.player.target;
    if (Input.touch && tg && !tg.dead) {  // 自動攻擊的鎖定框
      const r = tg.r + 10, s = G.time * 3;
      for (let i = 0; i < 4; i++) { glArc(g, tg.x, tg.y, r, s + i * TAU / 4, s + i * TAU / 4 + 0.6); g.stroke({ width: 2, color: 0x9dff6b, alpha: 0.85 }); }
    }
    this.gS.clear(); this.ships();
  },

  // 列隊蟲：每節要知道自己是不是頭（前面沒有活著的節）、是不是尾（後面沒有節）
  wormInfo() {
    const W = Game.enemies.filter(e => e.type === 'worm' && !e.dead), behind = new Set(), now = Game.time;
    this.wormHead = new Set(); this.wormTail = new Set();
    for (const e of W) {  // ahead：房主是真的連結；隊友那邊由同步的 id 接回（net.js applySnap）
      let a = e.ahead; while (a && a.dead) a = a.ahead;
      if (a) behind.add(a); else this.wormHead.add(e);
    }
    for (const e of W) {
      if (!behind.has(e)) this.wormTail.add(e);
      const m = this.worm.get(e.id);
      if (this.wormHead.has(e)) { if (!m) this.worm.set(e.id, { t: e.spawnT > 0 || W.length === 1 ? -9 : now }); }  // 一出生就是頭：不播長出來的動畫
      else if (m) this.worm.delete(e.id);
    }
    if (this.worm.size > 200) for (const k of this.worm.keys()) if (!W.some(e => e.id === k)) this.worm.delete(k);
  },

  enemy(e) {
    const G = Game, t = G.time, ty = e.type, T = ENEMY_TYPES[ty] || e.t, sp = e.spawnT > 0 ? 1 - e.spawnT / e.spawnMax : 1;
    const alpha = (0.3 + 0.7 * sp) * (1 - 0.9 * (e.cloak || 0)), k = (e.r / T.radius) * sp;
    let rot = ['swarmer', 'worm', 'splitling', 'lurker', 'spitter', 'treasure'].includes(ty) ? Math.atan2(e.vy, e.vx) : e.rot || 0;
    if (ty === 'spitter') rot = spitterFace(e);
    if (T.face) rot = enemyFace(e);  // 船頭朝目標（不自己一直轉）
    const base = (name, n, period, scaleRes = 2) => this.spr(this.frame(name, Math.floor(t / period * n) % n), e.x, e.y, k / scaleRes, rot);
    let main;
    switch (ty) {
      case 'swarmer': main = base('swarmer', 6, TAU / 40); break;
      case 'brute': { const curled = e.mode === 'windup' || e.mode === 'charge'; main = this.spr(this.frame(curled ? 'brute_ball' : 'brute', 0), e.x, e.y, k * (curled ? 0.9 : 1) / 2, rot); if (e.mode === 'stun' && Math.floor(t * 10) % 2) main.alpha = 0.5; break; }
      case 'spitter': { const cd = T.ranged ? T.ranged.cd : 1.8, p = e.cd != null ? 1 - clamp(e.cd / cd, 0, 1) : 0, f = p < 0.75 ? 0 : Math.min(7, 1 + Math.floor((p - 0.75) / 0.25 * 7)); main = this.spr(this.frame('spitter', f), e.x, e.y, k / 2, rot); break; }
      case 'elite': main = base('elite', 16, TAU / 1.1); break;
      case 'artillery': { const ch = e.mode === 'windup' ? 1 - clamp(e.modeT / CFG.ARTILLERY.windup, 0, 1) : 0; main = this.spr(this.frame('artillery', Math.round(ch * 4)), e.x, e.y, k / 2, rot); break; }  // 蓄力時砲管越來越亮
      case 'tractor': { const on = e.mode === 'pull' ? 2 : e.mode === 'aim' ? 1 : 0; main = this.spr(this.frame('tractor', on * 4 + Math.floor(t * 8) % 4), e.x, e.y, k / 2, rot); break; }  // 鎖定、牽引時發射器亮起來
      case 'wing': main = base('wing', 6, TAU / 3); break;
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
      case 'treasure': {  // 金色光暈（遠遠就看得到）；快逃走了（剩 CFG.TREASURE.blink 秒）光暈和船身快閃
        const end = e.modeT != null && e.modeT < CFG.TREASURE.blink, fl = end ? 0.5 + 0.5 * Math.sin(t * 30) : 1;
        this.glowAt(this.pE, e.x, e.y, e.r * 2.6, end ? 0xbfefff : 0xffd166, (end ? 0.25 + 0.45 * fl : 0.35 + 0.2 * Math.sin(t * 8)) * alpha);
        main = base('treasure', 8, 0.8); if (end) main.alpha = 0.45 + 0.55 * fl;
        break;
      }
      case 'alarm': {  // 警報艇：燈光慢慢轉；被打到開始響（modeT = 還剩幾秒）燈轉很快、紅光大閃
        const ring = e.modeT > 0;
        this.glowAt(this.pE, e.x, e.y, e.r * (ring ? 5 : 2.2), 0xff3b3b, (ring ? 0.35 + 0.35 * Math.abs(Math.sin(t * 18)) : 0.18) * alpha);
        main = this.spr(this.frame('alarm', Math.floor(t * (ring ? 24 : 6)) % 8), e.x, e.y, k / 2, 0);
        break;
      }
      case 'dummy': main = this.spr(this.frame('dummy', 0), e.x, e.y, k / 2, 0); break;
      case 'boss': {
        const ring = this.spr(this.frame('boss_ring', 0), e.x, e.y, k / 2, t * 0.6); ring.alpha = alpha;
        if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.2, 0xffd166, 0.35 + 0.25 * Math.sin(t * 12));
        main = this.spr(this.frame('boss', Math.floor(t / 2 * 16) % 16), e.x, e.y, k / 2, 0);
        break;
      }
      case 'boss2': main = base('boss2', 4, TAU / 7); main.tint = 0xdcd6ec; if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.2, 0xffd166, 0.3); break;
      case 'boss4': main = base('boss4', 6, TAU / 5); if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.3, 0xffd166, 0.3); break;
      case 'boss5': {  // 核心跟著光束轉（rot = 第一條光束的方向）
        if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 1.4, 0xffd166, 0.35 + 0.25 * Math.sin(t * 12));
        main = this.spr(this.frame('boss5', Math.floor(t / 1.6 * 8) % 8), e.x, e.y, k / 2, e.rot || 0);
        break;
      }
      case 'wt_aim': case 'wt_ring': case 'wt_bomb': case 'wt_call': main = this.spr(this.frame(ty, 0), e.x, e.y, k / 2, e.rot || 0); break;  // 守門者的砲塔：砲口朝外
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
    // 狀態圈：跟著隱形一起淡掉（潛伏者隱形時不能被狀態圈暴露位置）
    const g = this.gE, cv = 1 - (e.cloak || 0);
    if (cv > 0.05) {
      if (e.slowT > 0) g.circle(e.x, e.y, e.r + 5).stroke({ width: 1.5, color: 0x7fd4ff, alpha: 0.8 * cv });
      if (e.markT > 0 || e.shredT > 0) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + t; glArc(g, e.x, e.y, e.r + 8, a, a + 0.5); g.stroke({ width: 1.5, color: 0xff5a5a, alpha: 0.8 * cv }); }
      if (e.burnT > 0) g.circle(e.x, e.y, e.r + 2).stroke({ width: 2, color: 0xff9f1c, alpha: (0.4 + 0.4 * Math.sin(t * 20)) * cv });
      const stuck = e.stuckN != null ? e.stuckN : e.stuck ? e.stuck.length : 0;
      if (stuck) { const n = Math.min(stuck, 16); for (let i = 0; i < n; i++) { const a = i / n * TAU + t * 2; g.circle(e.x + Math.cos(a) * (e.r + 3), e.y + Math.sin(a) * (e.r + 3), 2.5).fill({ color: 0xf78cff, alpha: cv }); } }
    }
    if (e.ledT > 0 && cv > 0.05) g.circle(e.x, e.y, e.r + 4).stroke({ width: 2, color: 0xffd400, alpha: 0.7 * cv });  // 被精英「統帥」加成的小兵
    if (e.alertT > 0 && cv > 0.5) {  // 剛發現玩家（CFG.ALERT.mark 秒）：頭上「!」，先跳出來再淡掉
      const u = e.alertT / CFG.ALERT.mark, a = Math.min(1, u * 2), x = e.x, y = e.y - e.r - 26 - (1 - Math.min(1, (1 - u) * 6)) * 6;
      g.roundRect(x - 3.5, y - 9, 7, 13, 2).fill({ color: 0xff3b3b, alpha: a }).stroke({ width: 1.5, color: 0x03050c, alpha: a });
      g.circle(x, y + 9, 3.2).fill({ color: 0xff3b3b, alpha: a }).stroke({ width: 1.5, color: 0x03050c, alpha: a });
    }
    if (e.affixes && sp >= 1) this.affixFx(e, cv);
    if (e.spawnT > 0) g.circle(e.x, e.y, e.r * (2.2 - sp)).stroke({ width: 1, color: glColor(T.color), alpha: 0.8 });
    if ((e.hp < e.maxHp || T.elite) && !['swarmer', 'worm', 'splitling'].includes(ty) && !T.boss && !T.dummy && !(e.cloak > 0.5)) {  // 標靶打不死（扣到 0 就回滿）：不畫血條，看標靶上面的每秒傷害  // 精英一直顯示（同一隻有好幾艘時，靠這個找出殘血的那艘）
      const w = T.elite ? e.r * 3 : e.r * 2;
      g.rect(e.x - w / 2, e.y - e.r - 12, w, 4).fill({ color: 0x330000 });
      g.rect(e.x - w / 2, e.y - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4).fill({ color: glColor(T.color) });
    }
  },

  // 精英詞綴的樣子（cv：隱形時跟著淡掉）：護盾 = 正面 120° 的盾弧；統帥 = 300 的金色光環；磁場 = 140 的波紋；狂暴 = 紅光
  affixFx(e, cv) {
    const g = this.gE, t = Game.time;
    if (e.affixes.includes('command')) {  // 隊友那邊的敵人是普通物件（沒有 has），一律看 affixes
      g.circle(e.x, e.y, AFFIX.command.r).fill({ color: 0xffd400, alpha: 0.035 * cv });
      g.circle(e.x, e.y, AFFIX.command.r).stroke({ width: 2, color: 0xffd400, alpha: 0.25 * cv });
    }
    if (e.affixes.includes('field')) {
      const R = AFFIX.field.r;
      g.circle(e.x, e.y, R).stroke({ width: 2, color: 0x9fe8ff, alpha: 0.3 * cv });
      for (let i = 0; i < 2; i++) { const f = (t * 0.7 + i / 2) % 1; g.circle(e.x, e.y, R * (1 - f * 0.7)).stroke({ width: 2, color: 0x9fe8ff, alpha: 0.35 * f * cv }); }
    }
    if (e.enraged) this.glowAt(this.pE, e.x, e.y, e.r * 2.4, 0xff2a3a, (0.6 + 0.3 * Math.sin(t * 12)) * cv);
    if (e.shieldA != null && e.affixes.includes('shield')) {  // 盾弧：深色描邊＋盾衛的藍色
      const a0 = e.shieldA - Math.PI / 3, a1 = e.shieldA + Math.PI / 3, R = e.r + 9.5;
      glArc(g, e.x, e.y, R, a0, a1); g.stroke({ width: 9, color: 0x03050c, alpha: 0.9 * cv });
      glArc(g, e.x, e.y, R, a0, a1); g.stroke({ width: 6, color: 0x5ec8ff, alpha: 0.95 * cv });
      glArc(g, e.x, e.y, R - 2, a0 + 0.1, a1 - 0.1); g.stroke({ width: 1.5, color: 0xdff6ff, alpha: 0.8 * cv });  // 左上受光的亮邊
    }
  },

  // 衝鋒／滾球預警線：一律紅色；拖曳艦的鎖定線、牽引光束（連到被鎖定的那艘船）
  telegraph(e) {
    if (e.mode === 'aim' || e.mode === 'pull') { this.beam(e); return; }
    if (e.mode !== 'windup') return;
    const g = this.gE, t = Game.time;
    let len, alpha, w = e.r * 1.6;
    if (e.type === 'elite') { len = telegraphLen(e); alpha = 0.3 + 0.5 * Math.sin(t * 30) ** 2; w = e.r * 1.4; }
    else if (e.type === 'wing') { len = 520; alpha = 0.2 + 0.4 * Math.sin(t * 30) ** 2; w = 3; }  // 交叉齊射的彈道
    else if (e.type === 'artillery') { g.circle(e.x, e.y, e.r + 6 + 34 * Math.max(0, e.modeT) / CFG.ARTILLERY.windup).stroke({ width: 3, color: 0xff2a2a, alpha: 0.35 + 0.4 * Math.sin(t * 30) ** 2 }); return; }
    else if (e.type === 'brute') { len = telegraphLen(e); alpha = e.modeT <= CFG.BRUTE.lock ? 0.55 : 0.2; }
    else if (e.t.boss && CFG.CHARGE[e.type]) { len = telegraphLen(e); alpha = 0.25 + 0.45 * Math.sin(t * 30) ** 2; }  // 裂界獵艦、雙子獵艦的衝鋒
    else if (e.type === 'lurker') { len = telegraphLen(e); alpha = 0.3 + 0.5 * Math.sin(t * 30) ** 2; }
    else if (e.type === 'gunboat') { g.circle(e.x, e.y, e.r + 6 + 40 * Math.max(0, e.modeT) / 0.6).stroke({ width: 3, color: 0xff2a2a, alpha: 0.35 + 0.4 * Math.sin(t * 30) ** 2 }); return; }
    else return;
    g.moveTo(e.x, e.y).lineTo(e.x + Math.cos(e.chargeA) * len, e.y + Math.sin(e.chargeA) * len).stroke({ width: w, color: 0xff2a2a, alpha });
  },
  // 旗艦的光束（Game.bossBeams）：預警 = 細的紅線閃；開著 = 外層淡紅＋紅芯＋白芯，兩端發光
  bossBeams() {
    const g = this.gE, t = Game.time;
    for (const B of Game.bossBeams()) {
      if (B.warn) { g.moveTo(B.x1, B.y1).lineTo(B.x2, B.y2).stroke({ width: 2, color: 0xff2a2a, alpha: 0.3 + 0.5 * Math.sin(t * 30) ** 2 }); continue; }
      const f = 0.85 + 0.15 * Math.sin(t * 40);
      g.moveTo(B.x1, B.y1).lineTo(B.x2, B.y2).stroke({ width: B.w * 2.2, color: 0xff3b5c, alpha: 0.18 * f });
      g.moveTo(B.x1, B.y1).lineTo(B.x2, B.y2).stroke({ width: B.w, color: 0xff3b5c, alpha: 0.75 * f });
      g.moveTo(B.x1, B.y1).lineTo(B.x2, B.y2).stroke({ width: B.w * 0.3, color: 0xffffff, alpha: 0.9 });
      this.glowAt(this.pE, B.x1, B.y1, B.w * 2.2, 0xff3b5c, 0.6); this.glowAt(this.pE, B.x2, B.y2, B.w * 2.6, 0xff3b5c, 0.6);
    }
  },
  // 拖曳艦：aim = 細的紅色鎖定線（閃）；pull = 粗的青色光束（加法發光、往船這邊流的光點）
  beam(e) {
    const s = Game.shipBySlot(e.tgt);
    if (!s || s.dead) return;
    const g = this.gE, t = Game.time, sx = e.x + Math.cos(e.chargeA) * e.r, sy = e.y + Math.sin(e.chargeA) * e.r;
    if (e.mode === 'aim') { g.moveTo(sx, sy).lineTo(s.x, s.y).stroke({ width: 2, color: 0xff2a2a, alpha: 0.35 + 0.5 * Math.sin(t * 30) ** 2 }); return; }
    const col = glColor(e.t.color);
    g.moveTo(sx, sy).lineTo(s.x, s.y).stroke({ width: 12, color: col, alpha: 0.18 });
    g.moveTo(sx, sy).lineTo(s.x, s.y).stroke({ width: 4, color: col, alpha: 0.7 });
    g.moveTo(sx, sy).lineTo(s.x, s.y).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    for (let i = 0; i < 6; i++) {  // 光點從船流向拖曳艦
      const f = 1 - ((t * 1.6 + i / 6) % 1), x = sx + (s.x - sx) * f, y = sy + (s.y - sy) * f;
      this.glowAt(this.pE, x, y, 10, col, 0.7);
    }
    this.glowAt(this.pE, s.x, s.y, 30 + 4 * Math.sin(t * 20), col, 0.45);
  },

  // ---------- 飛船 ----------
  ships() {  // gS 由呼叫的人先清（基地：停機位的船也畫在 gS）
    const G = Game, g = this.gS;
    const tagOf = p => G.mates.length && G.inArena ? G.tagOf(p) : '';  // 基地的號碼牌畫在 HUD（drawHubHud）
    if (G.mates.length && G.state === 'play') {
      for (const m of G.mates) if (m.dead && !m.gone) this.downed(m, tagOf(m), !G.player.dead);
      if (G.player.dead) this.downed(G.player, tagOf(G.player), false);
    }
    if (G.decoys.length && (G.state === 'play' || Hub.shown())) this.decoys();
    if (G.turrets.length && (G.state === 'play' || Hub.shown())) this.turrets();
    for (const m of G.mates) if (!m.dead && !m.gone) this.ship(m, tagOf(m));
    if (G.state !== 'dead' && !G.player.dead) this.ship(G.player, tagOf(G.player));
    if (CFG.DEBUG_HIT) this.debugHit();
  },
  // 除錯畫面（CFG.DEBUG_HIT）：敵人身體 = 紅圈、玩家身體 = 青圈、旗艦命中點 = 黃點
  debugHit() {
    const G = Game, g = this.gS;
    for (const e of G.enemies) {
      if (e.dead) continue;
      g.circle(e.x, e.y, e.r).stroke({ width: 1.5, color: 0xff3b3b, alpha: 0.9 });
      for (const q of hitPts(e) || []) g.circle(q.x, q.y, 4).fill({ color: 0xffe14d }).stroke({ width: 1, color: 0x03050c });
    }
    for (const p of G.allShips()) if (p && !p.dead && !p.gone) g.circle(p.x, p.y, p.r).stroke({ width: 1.5, color: 0x3bf0ff, alpha: 0.9 });
  },
  // 哨兵號的砲台：底座＋跟著瞄準轉的砲管、中心玩家色的光（多人用號碼色，單人用船色）；外圈弧線 = 剩下的時間；出現時從小長大、最後 0.5 秒變淡
  turrets() {
    const G = Game, g = this.gS, P = this.pS;
    for (const q of G.turrets) {
      const col = glColor(G.mates.length ? G.slotColor(q.slot || 1) : SHIPS.sentry.color), k = Math.min(1, q.t / 0.5), grow = Math.min(1, (CFG.TURRET.t - q.t) / 0.15);
      const sc = (0.6 + 0.4 * grow) * 1.3 / 4;  // 畫大一點（實際大小跟飛船差不多，看起來太小）
      const b = GLR.sprite(P, GLR.T('s/turret_base')); b.position.set(q.x, q.y); b.scale.set(sc); b.rotation = 0; b.alpha = k; b.tint = 0xffffff; b.blendMode = 'normal';
      const s = GLR.sprite(P, GLR.T('s/turret_gun')); s.position.set(q.x, q.y); s.scale.set(sc); s.rotation = q.aim || 0; s.alpha = k; s.tint = 0xffffff; s.blendMode = 'normal';
      this.glowAt(P, q.x, q.y, 26, col, 0.35 * k); this.glowAt(P, q.x, q.y, 10, col, 0.95 * k);
      glArc(g, q.x, q.y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, q.t) / CFG.TURRET.t); g.stroke({ width: 2, color: col, alpha: 0.7 * k });
    }
  },
  // 幻影號的殘影：半透明的船身一閃一閃＋淡紫光，快消失時變淡；朝向衝刺當下的準星
  decoys() {
    const G = Game, A = SHIP_ART.get(SHIPS.wraith), P = this.pS, t = G.time;
    for (const d of G.decoys) {
      const k = Math.min(1, d.t / 0.4), col = glColor(G.mates.length ? G.slotColor(d.slot || 1) : SHIPS.wraith.color);
      this.glowAt(P, d.x, d.y, 34, col, 0.35 * k);
      const s = GLR.sprite(P, GLR.T(`s/${A.id}/0`)); s.position.set(d.x, d.y); s.scale.set(1 / 4); s.rotation = d.aim || 0;
      s.tint = col; s.alpha = (0.65 + 0.2 * Math.sin(t * 24)) * k;
      const s2 = GLR.sprite(P, GLR.T(`s/${A.id}/0`)); s2.position.set(d.x, d.y); s2.scale.set(1 / 4); s2.rotation = d.aim || 0; s2.tint = col; s2.blendMode = 'add'; s2.alpha = 0.35 * k;  // 加一層發光
    }
  },
  ship(p, tag) {
    const own = p === Game.player;
    if (!own && (p.ex || p.ey)) { const [x, y] = Net.drawPos(p); p = Object.assign(Object.create(p), { x, y }); }  // 別人的船畫在畫面位置（收到同步時不跳，見 net.js netMove）；其他欄位照讀原本的
    const G = Game, g = this.gS, t = G.time, S = p.ship, A = SHIP_ART.get(S), P = this.pS;
    const parts = own ? G.parts : p.L ? p.L.parts : p.parts || {};
    const n = id => (parts && parts[id]) || 0, a = p.aim, ca = Math.cos(a), sa = Math.sin(a);
    const L = (lx, ly) => [p.x + lx * ca - ly * sa, p.y + lx * sa + ly * ca];  // 船的座標 → 世界座標
    const fade = p.iframe > 0 && Math.floor(t * 20) % 2 ? 0.35 : 1, col = glColor(S.color);
    const sprL = (tex, lx, ly, sc, rot = 0) => { const [x, y] = L(lx, ly), s = GLR.sprite(P, tex); s.position.set(x, y); s.scale.set(sc); s.rotation = a + rot; s.alpha = fade; return s; };
    if (tag) {  // 雙人：號碼標籤＋船底光暈都用玩家色（每個人一個顏色，選同一艘船也分得出來）
      const pc = glColor(G.colorOf(p)), q = GLR.take(this.pSt);
      if (q.text !== tag) q.text = tag; q.anchor.set(0.5, 1); q.position.set(p.x, p.y - p.r - 8); q.tint = pc; q.alpha = 1;
      this.glowAt(P, p.x, p.y, 30, pc, 0.4 * fade);
    }
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
    // 裝上的武器：船頭底下（槍管從船頭伸出去）；自己的看 Game.weapon、有配裝的看配裝（房主那邊的隊友、基地裡其他人），其他（停機位、隊友那邊的其他人）看飛船物件的 weaponId
    const wid = own ? G.weapon.id : p.L ? p.L.weapon.id : p.weaponId, W = WEAPONS[wid];
    if (W) glWeapon(g, wid, p.x + ca * 14, p.y + sa * 14, a, 0.62, glColor(W.color), '', (x, y, r, c, al) => this.glowAt(P, x, y, r, c, al), fade, own ? weaponState(wid, p) : WEAPON_IDLE);
    // 船身（重裝甲層數決定哪一張）
    sprL(GLR.T(`s/${A.id}/${Math.min(4, n('armor'))}`), 0, 0, 1 / 4);
    if (p.frostT > 0) {  // 被彗星凍住：船身蓋一層淡藍的霜＋冷光
      const fr = sprL(GLR.T(`s/${A.id}/${Math.min(4, n('armor'))}`), 0, 0, 1 / 4); fr.tint = 0xbfe9ff; fr.blendMode = 'add'; fr.alpha = fade * 0.5;
      this.glowAt(P, p.x, p.y, 30, 0x9fdcff, 0.35 * fade);
    }
    // 外圈：輕裝甲薄殼、護盾
    for (let i = 0; i < Math.min(3, n('larmor')); i++) g.circle(p.x, p.y, 22 + i * 4).stroke({ width: 1, color: 0x9fe8ff, alpha: 0.45 * fade });
    for (let i = 0; i < (p.shield || 0); i++) g.circle(p.x, p.y, 26 + i * 5).stroke({ width: 2.5, color: 0x4cc9f0, alpha: 0.85 * fade });
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
