// 星環電路 多人版 · hub.js：基地（主畫面）：開著飛船走動的太空站，邏輯（配置、碰撞、移動、靠近哪裡、互動）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   畫面：js/ui/gl/gl_hub.js（場景）、render.js 的 drawHubHud（文字標籤）、js/ui/base.js（面板、上方列、說明卡）
//   這裡不碰畫面：互動結果交給 Screen（面板），靠近的東西換了就發 hubNear 事件
'use strict';

// 基地配置：分區的太空站。中間是發射大廳；左翼機庫（停機位沿大圓排一圈、船頭朝中間的轉盤）；右翼軍械庫（武器架靠上牆排）；
//   上面一排：晶片實驗室、觀景台、戰績室。房間之間隔一道牆，牆上的開口讓飛船過去。
//   房間、開口都是矩形：飛船只能待在這些矩形裡（walk）。
//   點位由 hubLayout 照數量算：加飛船 = 機庫的圓圈變大，加武器 = 軍械庫多一個架（一排 ARMORY_COLS 個），房間自己變大
//   kind 決定按 E 做什麼（Hub.ACT）：pad 停機位、rack 武器架、console 房間裡的全像操作台（打開面板）、launch 發射台、term 終端機
const HUB = {
  WT: 40, MARGIN: 140, TOP: 100,          // 牆厚；基地外圍留白（看得到太空）；畫面上方標題列的高度（螢幕 px）
  SPEED: 320, DASH: 900, DASH_T: 0.16, DASH_CD: 0.6,
  HALL_W: 860, HALL_H: 640,               // 發射大廳（最小）
  BAY_ARC: 200, RING_MIN: 230, RING_GAP: 1.3, PAD_R: 60,  // 機庫：每個停機位佔的弧長、圓圈最小半徑、對著大廳那側的缺口（弧度）
  RACK_GAP: 130, ARMORY_COLS: 5, RACK_ROW: 150, RACK_R: 46,      // 軍械庫：武器架間距、一排幾個、每排高度
  TOP_W: 440, TOP_H: 380,                 // 上面一排三個房間的大小
  DOOR_W: 170,                            // 牆上開口的寬
  CONSOLE_R: 70, TERM_R: 70, LAUNCH_R: 72, LAUNCH_PAD: 62, RUNWAY_W: 84,
};
// 房間：名字（地上的字）、顏色（地板色調、燈）；console = 房間裡的全像操作台打開哪個面板
const HUB_ROOMS = {
  hall: { label: '發射大廳', en: 'LAUNCH HALL', color: '#4cc9f0' },
  hangar: { label: '機庫', en: 'HANGAR', color: '#7fb4ff' },
  armory: { label: '軍械庫', en: 'ARMORY', color: '#ffb347', console: { id: 'armory', label: '⚔ 武器資料', tab: 'armory' } },
  lab: { label: '晶片實驗室', en: 'CHIP LAB', color: '#2ee6a6', console: { id: 'chips', label: '◈ 晶片庫', tab: 'chips' } },
  deck: { label: '觀景台', en: 'OBSERVATION', color: '#9fb4ff' },
  records: { label: '戰績室', en: 'RECORDS', color: '#ffd166', console: { id: 'stats', label: '🏆 戰績', tab: 'stats' } },
};
// 終端機：發射大廳的左右牆，左右輪流、同一邊往下排
const HUB_TERMS = [
  { id: 'coop', label: '👥 多人連線', color: '#ff9dbd' },
  { id: 'range', label: '🎯 靶場', color: '#9dff6b' },
];
// 照數量算配置：回傳 { W, H, rooms, doors（牆上的開口）, walk（飛船能待的矩形）, zones }
function hubLayout(shipIds, weaponIds, terms = HUB_TERMS) {
  const C = HUB, WT = C.WT, M = C.MARGIN;
  const ns = Math.max(1, shipIds.length), ring = Math.max(C.RING_MIN, ns * C.BAY_ARC / (TAU - C.RING_GAP));  // 機庫圓圈的半徑：停機位排得下
  const ac = Math.max(1, Math.min(C.ARMORY_COLS, weaponIds.length)), ar = Math.max(1, Math.ceil(weaponIds.length / C.ARMORY_COLS));
  const hangarW = 2 * (ring + 140), armoryW = Math.max(560, ac * C.RACK_GAP + 140);
  const midH = Math.max(C.HALL_H, hangarW, ar * C.RACK_ROW + 300), midY = M + C.TOP_H + WT;
  const hall = { x: M + hangarW + WT, y: midY, w: C.HALL_W, h: midH }, cx = hall.x + hall.w / 2;
  const rooms = { hall, hangar: { x: M, y: midY, w: hangarW, h: midH }, armory: { x: hall.x + hall.w + WT, y: midY, w: armoryW, h: midH } };
  const tx = cx - (3 * C.TOP_W + 2 * WT) / 2;
  ['lab', 'deck', 'records'].forEach((k, i) => { rooms[k] = { x: tx + i * (C.TOP_W + WT), y: M, w: C.TOP_W, h: C.TOP_H }; });
  for (const [k, r] of Object.entries(rooms)) Object.assign(r, { id: k, ...HUB_ROOMS[k] });
  // 牆上的開口：橫跨兩個房間中間那道牆（各伸進去 30，飛船才過得去）
  const D = C.DOOR_W, my = midY + midH / 2, ty = M + C.TOP_H / 2, R = rooms;
  const doors = [
    { x: R.hangar.x + R.hangar.w - 30, y: my - D / 2, w: WT + 60, h: D },     // 機庫 ↔ 大廳
    { x: hall.x + hall.w - 30, y: my - D / 2, w: WT + 60, h: D },             // 大廳 ↔ 軍械庫
    { x: cx - D / 2, y: R.deck.y + R.deck.h - 30, w: D, h: WT + 60 },          // 觀景台 ↔ 大廳
    { x: R.lab.x + R.lab.w - 30, y: ty - D / 2, w: WT + 60, h: D },            // 晶片實驗室 ↔ 觀景台
    { x: R.deck.x + R.deck.w - 30, y: ty - D / 2, w: WT + 60, h: D },          // 觀景台 ↔ 戰績室
  ];
  // 大廳每間房都進得去：上排左右兩間跟大廳上牆重疊的那一段也開一個口（重疊太短就不開，機制檢查會抓到）
  for (const k of ['lab', 'records']) {
    const r = R[k], x0 = Math.max(r.x, hall.x) + 20, x1 = Math.min(r.x + r.w, hall.x + hall.w) - 20, w = Math.min(D, x1 - x0);
    if (w >= 80) doors.push({ x: (x0 + x1) / 2 - w / 2, y: r.y + r.h - 30, w, h: WT + 60 });
  }
  const zones = [];
  // 機庫：停機位沿大圓排一圈（從缺口下緣順時針），船頭朝中間；對著大廳開口（右邊）留缺口
  const hcx = R.hangar.x + R.hangar.w / 2, hcy = midY + midH / 2, step = (TAU - C.RING_GAP) / ns;
  Object.assign(R.hangar, { cx: hcx, cy: hcy, ring });
  shipIds.forEach((id, i) => { const a = C.RING_GAP / 2 + (i + 0.5) * step;
    zones.push({ id: 'pad:' + id, kind: 'pad', ship: id, x: hcx + Math.cos(a) * ring, y: hcy + Math.sin(a) * ring, face: a + Math.PI, r: C.PAD_R, label: SHIPS[id] ? SHIPS[id].name : id, color: SHIPS[id] ? SHIPS[id].color : '#8fa3d9' }); });
  // 軍械庫：武器架從上牆往下一排一排（每排置中），操作台在下面
  weaponIds.forEach((id, i) => { const c = i % C.ARMORY_COLS, r = Math.floor(i / C.ARMORY_COLS), n = Math.min(C.ARMORY_COLS, weaponIds.length - r * C.ARMORY_COLS);
    zones.push({ id: 'rack:' + id, kind: 'rack', weapon: id, x: R.armory.x + R.armory.w / 2 + (c - (n - 1) / 2) * C.RACK_GAP, y: midY + 110 + r * C.RACK_ROW, r: C.RACK_R, label: WEAPONS[id] ? WEAPONS[id].name : id, color: WEAPONS[id] ? WEAPONS[id].color : '#8fa3d9' }); });
  // 房間裡的操作台：軍械庫在下面、晶片實驗室和戰績室在正中間
  for (const r of Object.values(rooms)) if (r.console) zones.push({ ...r.console, kind: 'console', room: r.id, color: r.color, x: r.x + r.w / 2, y: r.id === 'armory' ? r.y + r.h - 120 : r.y + r.h / 2 + 10, r: C.CONSOLE_R });
  // 發射台：大廳下方正中，跑道穿過下牆到太空
  zones.push({ id: 'launch', kind: 'launch', x: cx, y: hall.y + hall.h - 180, r: C.LAUNCH_R, label: '🚀 發射台', color: '#4cc9f0' });
  // 終端機：大廳左右牆，左右輪流、同一邊往下排
  terms.forEach((t, i) => { const side = i % 2, k = Math.floor(i / 2);
    zones.push({ ...t, kind: 'term', side, x: side ? hall.x + hall.w - 56 : hall.x + 56, y: hall.y + 130 + k * 170, r: C.TERM_R }); });
  return { W: R.armory.x + armoryW + M, H: midY + midH + M, rooms, doors, walk: [...Object.values(rooms), ...doors], zones };
}
Object.assign(HUB, hubLayout(Object.keys(SHIPS), Object.keys(WEAPONS)));
// 配置 L 裡，半徑 r 的飛船放在 (x, y) 可不可以：整個在某個房間或開口裡
function hubFree(L, x, y, r) { return L.walk.some(R => x - r >= R.x && x + r <= R.x + R.w && y - r >= R.y && y + r <= R.y + R.h); }

const Hub = {
  shots: [], sparks: [], fireCd: 0,  // 基地裡射出去的子彈、打到牆的火花（只是好玩：沒有傷害，多人時不同步）
  ready: false, shipId: null, weaponId: null, ship: null, near: null, cam: { x: 0, y: 0 }, k: 1, t: 0, dashT: 0, dashCd: 0, dashA: 0,  // k：基地的縮放（螢幕 px / 基地座標）

  // 進基地：飛船停在發射台左邊（不壓到停機坪的名字）；機庫選的飛船沒解鎖（例如存檔重來）就換成第一艘解鎖的
  enter() {
    const ids = Object.keys(SHIPS), want = this.shipId || Game.shipId;
    this.shipId = SHIPS[want] && isUnlocked('ship', want) ? want : ids.find(id => isUnlocked('ship', id)) || ids[0];
    const ws = Object.keys(WEAPONS), ww = this.weaponId || (Game.weapon && Game.weapon.id);  // 武器：上次裝的（沒解鎖就換成第一把解鎖的）
    this.weaponId = WEAPONS[ww] && isUnlocked('weapon', ww) ? ww : ws.find(id => isUnlocked('weapon', id)) || ws[0];
    const L = this.zone('launch');
    if (!this.ship) this.ship = { x: L.x - 170, y: L.y, vx: 0, vy: 0, aim: -Math.PI / 2, r: 12, moving: false, iframe: 0, dashT: 0, overdrive: 0 };
    this.setShip(this.shipId);
    this.ready = true;
    this.near = null;
    this.follow();
  },
  zone(id) { return HUB.zones.find(z => z.id === id) || null; },
  // 基地畫在畫面上：主畫面（title）、多人連線畫面（lobby，從基地的終端機打開，基地留在後面）、多人房間（pick）
  shown() { return this.ready && !Game.inArena && ['title', 'lobby', 'pick'].includes(Game.state); },
  coop() { return Game.state === 'pick'; },  // 多人選配裝中：發射台 = 準備，終端機不能用
  setShip(id) { const S = SHIPS[id]; Object.assign(this.ship, { ship: S, parts: S.parts }); this.shipId = id; },
  // 換船：沒解鎖的不能換；回傳有沒有換
  pick(id) {
    if (!SHIPS[id] || !isUnlocked('ship', id) || id === this.shipId || (this.coop() && Net.meReady)) return false;  // 多人：準備好了就不能換
    const pad = this.zone('pad:' + id), s = this.ship;
    this.setShip(id);
    if (pad) { s.x = pad.x; s.y = pad.y; s.vx = s.vy = 0; }
    Events.emit('hubSwap', id);
    return true;
  },
  // 裝武器：沒解鎖的不能裝；多人準備好了不能換
  equip(id) {
    if (!WEAPONS[id] || !isUnlocked('weapon', id) || id === this.weaponId || (this.coop() && Net.meReady)) return false;
    this.weaponId = id;
    Events.emit('hubSwap', id);
    return true;
  },
  // 選的章：沒解鎖就用第一章
  chapter() { return chapterUnlocked(Game.chapterId) ? Game.chapterId : CHAPTERS[0].id; },

  // 每幀（只在基地畫面、沒開面板時）：WASD 移動、Space 衝刺、船頭朝滑鼠（沒動滑鼠就朝移動方向）、找最近的互動點
  update(dt) {
    const s = this.ship, K = Input.keys;
    this.t += dt;
    let mx = 0, my = 0;
    if (K.has('w') || K.has('arrowup')) my -= 1;
    if (K.has('s') || K.has('arrowdown')) my += 1;
    if (K.has('a') || K.has('arrowleft')) mx -= 1;
    if (K.has('d') || K.has('arrowright')) mx += 1;
    const len = Math.hypot(mx, my);
    s.moving = len > 0;
    this.dashCd -= dt;
    if (Input.dash) { Input.dash = false; if (this.dashCd <= 0) { this.dashT = HUB.DASH_T; this.dashCd = HUB.DASH_CD; this.dashA = len ? Math.atan2(my, mx) : s.aim; } }
    if (this.dashT > 0) { this.dashT -= dt; s.vx = Math.cos(this.dashA) * HUB.DASH; s.vy = Math.sin(this.dashA) * HUB.DASH; }
    else { const k = Math.min(1, dt * 12), l = Math.max(1, len); s.vx += (mx / l * HUB.SPEED - s.vx) * k; s.vy += (my / l * HUB.SPEED - s.vy) * k; }
    s.dashT = Math.max(0, this.dashT);
    // 撞牆、撞柱子：x、y 分開試，擋住的那個方向停下（可以貼著牆滑）
    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
    if (this.free(nx, s.y, s.r)) s.x = nx; else s.vx = 0;
    if (this.free(s.x, ny, s.r)) s.y = ny; else s.vy = 0;
    const wx = Input.mx / this.k + this.cam.x, wy = Input.my / this.k + this.cam.y;
    if (Input.mouseMoved) s.aim = Math.atan2(wy - s.y, wx - s.x);
    else if (s.moving) s.aim = Math.atan2(my, mx);
    this.follow();
    this.updateShots(dt);
    // 最近的互動點（自己現在開的那艘的停機坪不算）
    let best = null, bd = Infinity;
    for (const z of HUB.zones) {
      if ((z.kind === 'pad' && z.ship === this.shipId) || (z.kind === 'rack' && z.weapon === this.weaponId)) continue;
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < z.r && d < bd) { best = z; bd = d; }
    }
    if (best !== this.near) { this.near = best; Events.emit('hubNear', best); }
  },
  // 飛船（半徑 r）放在 (x, y) 可不可以：整個在某個房間或開口裡
  free(x, y, r) {
    return hubFree(HUB, x, y, r);
  },
  // 射擊：按住左鍵，照裝備武器的基本數值（射速 interval、一次 count 發、散開 spread、彈速 speed、射程 life）從船頭射出；
  //   子彈撞牆（出了房間和開口）就在那裡爆火花；最多 MAX_SHOTS 顆
  updateShots(dt) {
    const s = this.ship, P = weaponParams({ id: this.weaponId, path: null, final: null });
    this.fireCd -= dt;
    if (Input.down && this.fireCd <= 0) {
      this.fireCd = P.interval;
      const n = P.count, mx = s.x + Math.cos(s.aim) * 24, my = s.y + Math.sin(s.aim) * 24;
      for (let i = 0; i < n && this.shots.length < Hub.MAX_SHOTS; i++) {
        const a = s.aim + (n > 1 ? (i / (n - 1) - 0.5) * P.spread : 0);
        this.shots.push({ x: mx, y: my, vx: Math.cos(a) * P.speed, vy: Math.sin(a) * P.speed, t: P.life, life: P.life, r: P.radius, col: P.color, w: this.weaponId });
      }
      Events.emit('shoot', { weapon: this.weaponId });
    }
    for (const b of this.shots) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.t -= dt;
      if (!hubFree(HUB, b.x, b.y, 1)) { b.t = 0; this.sparks.push({ x: b.x - b.vx * dt, y: b.y - b.vy * dt, t: 0.3, col: b.col }); }
    }
    this.shots = this.shots.filter(b => b.t > 0);
    for (const k of this.sparks) k.t -= dt;
    this.sparks = this.sparks.filter(k => k.t > 0);
  },
  MAX_SHOTS: 200,
  // 鏡頭跟著飛船（飛船在標題列以下那塊的正中間），不超出基地外圍太多；縮放照畫面大小（1280×800 = 1）
  follow() {
    const room = VH - HUB.TOP, k = this.k = clamp(Math.min(VW / 1280, VH / 800), 0.7, 1.3), s = this.ship;
    const vw = VW / k, vh = room / k, top = HUB.TOP / k;
    this.cam.x = vw >= HUB.W ? HUB.W / 2 - vw / 2 : clamp(s.x - vw / 2, 0, HUB.W - vw);
    this.cam.y = (vh >= HUB.H ? HUB.H / 2 - vh / 2 : clamp(s.y - vh / 2, 0, HUB.H - vh)) - top;
  },
  // 按 E（或 Enter）：對靠近的東西做事
  interact() {
    const z = this.near;
    if (!z) return false;
    this.ACT[z.kind](z);
    return true;
  },
  ACT: {
    pad: z => Hub.pick(z.ship),
    rack: z => Hub.equip(z.weapon),
    console: z => Screen.basePanel(z.tab),
    launch: () => Screen.basePanel('launch'),
    term: z => { if (!Hub.coop()) { if (z.id === 'coop') Net.lobby(); else Game.newRun('range', Hub.shipId, Hub.weaponId); } },  // 靶場：用目前開的船、裝的武器
  },
};
