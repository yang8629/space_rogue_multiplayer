// 星環電路 多人版 · hub.js：基地（主畫面）：開著飛船走動的太空站，邏輯（配置、碰撞、移動、靠近哪裡、互動）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   畫面：js/ui/gl/gl_hub.js（場景）、render.js 的 drawHubHud（文字標籤）、js/ui/base.js（面板、上方列、說明卡）
//   這裡不碰畫面：互動結果交給 Screen（面板），靠近的東西換了就發 hubNear 事件
'use strict';

// 基地配置：分區的太空站。中間是中央大廳（出生點在正中），下面延伸出去發射甲板（發射台、跑道）；左翼機庫（停機位沿大圓排一圈、船頭朝中間的轉盤）；右翼軍械庫（武器架靠上牆排）；
//   上面一排：晶片實驗室、觀景台、戰績室。房間之間隔一道牆，牆上的開口讓飛船過去。
//   房間、開口都是矩形：飛船只能待在這些矩形裡（walk）。
//   點位由 hubLayout 照數量算：加飛船 = 機庫的圓圈變大，加武器 = 軍械庫多一個架（一排 ARMORY_COLS 個），房間自己變大
//   kind 決定按 E 做什麼（Hub.ACT）：pad 停機位、rack 武器架、console 房間裡的操作台（打開面板）、launch 發射台、term 終端機
const HUB = {
  WT: 40, MARGIN: 140, TOP: 100,          // 牆厚；基地外圍留白（看得到太空）；畫面上方標題列的高度（螢幕 px）
  SPEED: 320, DASH: 900, DASH_T: 0.16, DASH_CD: 0.6,
  HALL_W: 860, HALL_H: 640,               // 中央大廳（最小）
  BAY_W: 320, BAY_H: 400, BAY_DOOR: 230,   // 發射甲板（大廳下面延伸出去）：寬、高、跟大廳之間的開口寬
  BAY_ARC: 200, RING_MIN: 230, RING_GAP: 1.3, PAD_R: 60,  // 機庫：每個停機位佔的弧長、圓圈最小半徑、對著大廳那側的缺口（弧度）
  RACK_GAP: 130, ARMORY_COLS: 5, RACK_ROW: 150, RACK_R: 46,      // 軍械庫：武器架間距、一排幾個、每排高度
  TOP_W: 440, TOP_H: 380,                 // 上面一排三個房間的大小
  DOOR_W: 170,                            // 牆上開口的寬
  CONSOLE_R: 70, TERM_R: 70, LAUNCH_R: 72, LAUNCH_PAD: 62, RUNWAY_W: 84,
  TARGET_R: 24, DPS_WIN: 3, KNOCK: 520,   // 軍械庫標靶機的半徑、每秒傷害算最近幾秒；被別人的子彈打中往後推的速度
};
// 房間：名字（地上的字）、顏色（地板色調、燈）；console = 房間裡的操作台打開哪個面板
const HUB_ROOMS = {
  hall: { label: '中央大廳', en: 'CENTRAL HALL', color: '#4cc9f0' },
  bay: { label: '發射甲板', en: 'LAUNCH DECK', color: '#4cc9f0' },
  hangar: { label: '機庫', en: 'HANGAR', color: '#7fb4ff' },
  armory: { label: '軍械庫', en: 'ARMORY', color: '#ffb347', console: { id: 'armory', label: '⚔ 武器資料', tab: 'armory' } },
  lab: { label: '晶片實驗室', en: 'CHIP LAB', color: '#2ee6a6', console: { id: 'chips', label: '◈ 晶片庫', tab: 'chips' } },
  deck: { label: '觀景台', en: 'OBSERVATION', color: '#9fb4ff' },
  records: { label: '戰績室', en: 'RECORDS', color: '#ffd166', console: { id: 'stats', label: '🏆 戰績', tab: 'stats' } },
};
// 終端機：中央大廳的左右牆，左右輪流、同一邊往下排
const HUB_TERMS = [
  { id: 'coop', label: '👥 多人連線', color: '#ff9dbd' },
  { id: 'range', label: '🎯 靶場', color: '#9dff6b' },
];
// 照數量算配置：回傳 { W, H, rooms, doors（牆上的開口）, walk（飛船能待的矩形）, zones, spawn（進基地的位置 = 大廳正中）, targets（軍械庫的標靶機） }
function hubLayout(shipIds, weaponIds, terms = HUB_TERMS) {
  const C = HUB, WT = C.WT, M = C.MARGIN;
  const ns = Math.max(1, shipIds.length), ring = Math.max(C.RING_MIN, ns * C.BAY_ARC / (TAU - C.RING_GAP));  // 機庫圓圈的半徑：停機位排得下
  const ac = Math.max(1, Math.min(C.ARMORY_COLS, weaponIds.length)), ar = Math.max(1, Math.ceil(weaponIds.length / C.ARMORY_COLS));
  const hangarW = 2 * (ring + 140), armoryW = Math.max(560, ac * C.RACK_GAP + 140);
  const midH = Math.max(C.HALL_H, hangarW, ar * C.RACK_ROW + 300), midY = M + C.TOP_H + WT;
  const hall = { x: M + hangarW + WT, y: midY, w: C.HALL_W, h: midH }, cx = hall.x + hall.w / 2;
  const rooms = { hall, hangar: { x: M, y: midY, w: hangarW, h: midH }, armory: { x: hall.x + hall.w + WT, y: midY, w: armoryW, h: midH },
    bay: { x: cx - C.BAY_W / 2, y: midY + midH + WT, w: C.BAY_W, h: C.BAY_H } };
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
    { x: cx - C.BAY_DOOR / 2, y: hall.y + hall.h - 30, w: C.BAY_DOOR, h: WT + 60 },  // 大廳 ↔ 發射甲板
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
  // 軍械庫靶場：武器架和操作台之間、偏右邊立 3 個標靶機（前後錯開，從左邊射）
  const A = R.armory, tym = (midY + 110 + (ar - 1) * C.RACK_ROW + A.y + A.h - 120) / 2;
  const targets = [[0.62, -50], [0.76, 40], [0.9, -15]].map(([fx, dy]) => ({ x: A.x + A.w * fx, y: tym + dy, r: C.TARGET_R }));
  // 房間裡的操作台：軍械庫在下面、晶片實驗室和戰績室在正中間
  for (const r of Object.values(rooms)) if (r.console) zones.push({ ...r.console, kind: 'console', room: r.id, color: r.color, x: r.x + r.w / 2, y: r.id === 'armory' ? r.y + r.h - 120 : r.y + r.h / 2 + 10, r: C.CONSOLE_R });
  // 發射台：發射甲板上，跑道穿過甲板的下牆到太空
  zones.push({ id: 'launch', kind: 'launch', x: cx, y: R.bay.y + 140, r: C.LAUNCH_R, label: '🚀 發射台', color: '#4cc9f0' });
  // 終端機：大廳左右牆，左右輪流、同一邊往下排
  terms.forEach((t, i) => { const side = i % 2, k = Math.floor(i / 2);
    zones.push({ ...t, kind: 'term', side, x: side ? hall.x + hall.w - 56 : hall.x + 56, y: hall.y + 130 + k * 170, r: C.TERM_R }); });
  return { W: R.armory.x + armoryW + M, H: R.bay.y + R.bay.h + M, rooms, doors, walk: [...Object.values(rooms), ...doors], zones, spawn: { x: cx, y: hall.y + hall.h / 2 }, targets };
}
Object.assign(HUB, hubLayout(Object.keys(SHIPS), Object.keys(WEAPONS)));
// 配置 L 裡，半徑 r 的飛船放在 (x, y) 可不可以：整個在某個房間或開口裡
function hubFree(L, x, y, r) { return L.walk.some(R => x - r >= R.x && x + r <= R.x + R.w && y - r >= R.y && y + r <= R.y + R.h); }

const HUB_LAST_KEY = 'v2_lastPick';  // 上次選的飛船、武器存在瀏覽器的名稱：{ ship, weapon }
const Hub = {
  dfx: [], puffs: [],  // 衝刺的效果（飛船能力：瞬移的電光、殘影、砲台、星門；sl = 誰的，自己 0）、衝刺噴的粒子
  shots: [], sparks: [], fireCd: 0,  // 基地裡射出去的子彈（多人時別人的也在：sl = 誰射的，自己的 0）、打到東西的火花（只是好玩：沒有血量）
  nums: [], hits: [], kick: { x: 0, y: 0 }, hitT: 0, hitN: 0, mateHit: {},  // 跳出的傷害數字；標靶機每一發 { i, t, dmg }；被打中往後推的速度、閃白剩幾秒、被打中幾次；其他人的閃白
  ready: false, shipId: null, weaponId: null, ship: null, near: null, seq: null, cam: { x: 0, y: 0 }, k: 1, t: 0, dashT: 0, dashCd: 0, dashA: 0, dashSX: 0, dashSY: 0,  // k：基地的縮放（螢幕 px / 基地座標）；seq：出發動畫播到哪（null = 沒在播）

  // 上次選的飛船、武器（存在瀏覽器 HUB_LAST_KEY：重新整理、下次打開遊戲還記得）；壞掉的存檔當成沒有
  last() { try { const o = JSON.parse(localStorage.getItem(HUB_LAST_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } },
  saveLast() { try { localStorage.setItem(HUB_LAST_KEY, JSON.stringify({ ship: this.shipId, weapon: this.weaponId })); } catch (e) {} },
  // 進基地：飛船在大廳正中（spawn）；選的飛船（這次開著的 → 上次存的）沒解鎖（例如存檔重來）就換成第一艘解鎖的
  //   存的排在 Game.weapon 前面：遊戲一打開 Game.weapon 就是預設的雷射（真的 Chrome 測到存的武器被它蓋掉）；存的每次換都會更新，一定是最新的
  enter() {
    const L = this.last(), ids = Object.keys(SHIPS), want = this.shipId || L.ship || Game.shipId;
    this.shipId = SHIPS[want] && isUnlocked('ship', want) ? want : ids.find(id => isUnlocked('ship', id)) || ids[0];
    const ws = Object.keys(WEAPONS), ww = this.weaponId || L.weapon || (Game.weapon && Game.weapon.id);  // 武器：上次裝的（沒解鎖就換成第一把解鎖的）
    this.weaponId = WEAPONS[ww] && isUnlocked('weapon', ww) ? ww : ws.find(id => isUnlocked('weapon', id)) || ws[0];
    const P = HUB.spawn;
    if (!this.ship || this.seq) this.ship = { x: P.x, y: P.y, vx: 0, vy: 0, aim: -Math.PI / 2, r: 12, moving: false, iframe: 0, dashT: 0, overdrive: 0 };  // 出發過（飛出去了）：回來從大廳正中開始
    this.seq = null;
    this.setShip(this.shipId);
    this.ship.weaponId = this.weaponId;  // 飛船物件帶著裝的武器（GLActors.ship 畫在船頭，跟戰鬥中同一段）
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
    this.setShip(id); this.saveLast();  // 換完留在原地（不跳到新船的停機位）
    Events.emit('hubSwap', id);
    return true;
  },
  // 裝武器：沒解鎖的不能裝；多人準備好了不能換
  equip(id) {
    if (!WEAPONS[id] || !isUnlocked('weapon', id) || id === this.weaponId || (this.coop() && Net.meReady)) return false;
    this.weaponId = this.ship.weaponId = id; this.saveLast();
    Events.emit('hubSwap', id);
    return true;
  },
  // 選的章：沒解鎖就用第一章
  chapter() { return chapterUnlocked(Game.chapterId) ? Game.chapterId : CHAPTERS[0].id; },

  // 每幀（只在基地畫面、沒開面板時）：WASD 移動、Space 衝刺、船頭朝滑鼠（沒動滑鼠就朝移動方向）、找最近的互動點
  update(dt) {
    const s = this.ship, K = Input.keys;
    this.t += dt;
    if (this.seq) { this.updateLaunch(dt); return; }  // 出發動畫中：不能操作
    let mx = 0, my = 0;
    if (K.has('w') || K.has('arrowup')) my -= 1;
    if (K.has('s') || K.has('arrowdown')) my += 1;
    if (K.has('a') || K.has('arrowleft')) mx -= 1;
    if (K.has('d') || K.has('arrowright')) mx += 1;
    const len = Math.hypot(mx, my);
    s.moving = len > 0;
    this.dashCd -= dt;
    const wasDash = this.dashT > 0, x0 = s.x, y0 = s.y;
    if (Input.dash) { Input.dash = false; if (this.dashCd <= 0) { this.dashT = HUB.DASH_T; this.dashCd = HUB.DASH_CD; this.dashA = len ? Math.atan2(my, mx) : s.aim; this.startDash(); } }
    if (this.dashT > 0) { this.dashT -= dt; const sp = s.ship.ability === 'phase' ? 0 : HUB.DASH; s.vx = Math.cos(this.dashA) * sp; s.vy = Math.sin(this.dashA) * sp; }  // 相位跳躍：已經瞬移過去，剩下的衝刺時間停在落點
    else { const k = Math.min(1, dt * 12), l = Math.max(1, len); s.vx += (mx / l * HUB.SPEED - s.vx) * k; s.vy += (my / l * HUB.SPEED - s.vy) * k; }
    s.dashT = Math.max(0, this.dashT);
    // 撞牆、撞柱子：x、y 分開試，擋住的那個方向停下（可以貼著牆滑）
    const kd = Math.exp(-6 * dt), nx = s.x + (s.vx + this.kick.x) * dt, ny = s.y + (s.vy + this.kick.y) * dt;  // kick：被別人打中的推力（慢慢消失）
    this.kick.x *= kd; this.kick.y *= kd; this.hitT = Math.max(0, this.hitT - dt);
    if (this.free(nx, s.y, s.r)) s.x = nx; else { s.vx = 0; this.kick.x = 0; }
    if (this.free(s.x, ny, s.r)) s.y = ny; else { s.vy = 0; this.kick.y = 0; }
    const hop = this.hop(s, s.r, x0, y0);
    if (hop && !this.free(s.x, s.y, s.r)) [s.x, s.y] = hop;  // 從門出來的地方卡牆：停在門上
    if (wasDash && this.dashT <= 0 && s.ship.ability === 'portal' && Math.hypot(s.x - this.dashSX, s.y - this.dashSY) >= 40) this.dash('portal', this.dashSX, this.dashSY, s.x, s.y, s.aim);  // 星門號：衝刺結束在起點、落點開門
    const wx = Input.mx / this.k + this.cam.x, wy = Input.my / this.k + this.cam.y;
    if (Input.mouseMoved) s.aim = Math.atan2(wy - s.y, wx - s.x);
    else if (s.moving) s.aim = Math.atan2(my, mx);
    this.follow();
    this.updateDash(dt);
    this.updateShots(dt);
    // 最近的互動點（自己開的那艘的停機坪、裝著的武器的架子也算：看數據，按 E 不會換）
    let best = null, bd = Infinity;
    for (const z of HUB.zones) {
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
  //   子彈撞牆（出了房間和開口）就在那裡爆火花；打到軍械庫的標靶機跳傷害數字、算每秒傷害；
  //   多人房間：開火時發 hubFire 事件（net.js 轉給其他人，addFire 在對方那邊生出同樣的子彈）；別人的子彈打到自己 = 被往子彈方向推、閃白；
  //   打到別人的船只畫火花和數字（推他的是他那邊自己算）；最多 MAX_SHOTS 顆
  updateShots(dt) {
    const s = this.ship;
    this.fireCd -= dt;
    if (Input.down && this.fireCd <= 0) {
      this.fireCd = weaponParams({ id: this.weaponId, path: null, final: null }).interval;
      const mx = s.x + Math.cos(s.aim) * 24, my = s.y + Math.sin(s.aim) * 24;
      this.addFire(0, mx, my, s.aim, this.weaponId);
      Events.emit('shoot', { weapon: this.weaponId });
      Events.emit('hubFire', { x: mx, y: my, a: s.aim, w: this.weaponId });
    }
    const others = this.coop() ? Net.roomShips() : [], spark = (b, x, y) => { b.t = 0; this.sparks.push({ x, y, t: 0.3, col: b.col }); };
    for (const b of this.shots) {
      const bx0 = b.x, by0 = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.t -= dt;
      this.hop(b, b.r, bx0, by0);  // 子彈也穿星門
      if (!hubFree(HUB, b.x, b.y, 1)) { spark(b, b.x - b.vx * dt, b.y - b.vy * dt); continue; }
      // 打中標靶：照武器的穿透值穿過去（穿透 N = 最多打中 N+1 個，跟戰鬥一樣），同一顆不重複打同一個靶
      const ti = HUB.targets.findIndex((T, i) => !b.done.has(i) && Math.hypot(T.x - b.x, T.y - b.y) < T.r + b.r);
      if (ti >= 0) {
        b.done.add(ti); this.hits.push({ i: ti, t: this.t, dmg: b.dmg }); this.num(b.x, b.y - 10, b.dmg);
        if (b.pierce > 0) { b.pierce--; this.sparks.push({ x: b.x, y: b.y, t: 0.2, col: b.col }); } else spark(b, b.x, b.y);
        continue;
      }
      if (b.sl && Math.hypot(s.x - b.x, s.y - b.y) < s.r + b.r + 4) {  // 別人的子彈打到自己
        const sp = Math.hypot(b.vx, b.vy) || 1;
        this.kick.x += b.vx / sp * HUB.KNOCK; this.kick.y += b.vy / sp * HUB.KNOCK; this.hitT = 0.25; this.hitN++;
        spark(b, b.x, b.y); this.num(s.x, s.y - 22, b.dmg); continue;
      }
      const o = others.find(o => o.slot !== b.sl && Math.hypot(o.x - b.x, o.y - b.y) < 16 + b.r);
      if (o) { spark(b, b.x, b.y); this.num(o.x, o.y - 22, b.dmg); this.mateHit[o.slot] = 0.25; }
    }
    this.shots = this.shots.filter(b => b.t > 0);
    for (const k of this.sparks) k.t -= dt;
    this.sparks = this.sparks.filter(k => k.t > 0);
    for (const n of this.nums) n.t -= dt;
    this.nums = this.nums.filter(n => n.t > 0);
    this.hits = this.hits.filter(h => this.t - h.t < HUB.DPS_WIN);
    for (const k in this.mateHit) this.mateHit[k] = Math.max(0, this.mateHit[k] - dt);
  },
  // 一次開火：照武器的基本數值（一次 count 發、散開 spread、彈速 speed、射程 life、傷害 damage）；sl = 誰射的（自己 0）
  addFire(sl, x, y, aim, w, mul = 1) {  // mul：傷害倍率（哨兵號的砲台 CFG.TURRET.dmg）
    const P = weaponParams({ id: w, path: null, final: null }), n = P.count;
    for (let i = 0; i < n && this.shots.length < Hub.MAX_SHOTS; i++) {
      const a = aim + (n > 1 ? (i / (n - 1) - 0.5) * P.spread : 0);
      this.shots.push({ x, y, vx: Math.cos(a) * P.speed, vy: Math.sin(a) * P.speed, t: P.life, life: P.life, r: P.radius, col: P.color, w, sl, dmg: Math.round(P.damage * mul), pierce: P.pierce || 0, done: new Set() });  // done：打過的標靶
    }
  },
  // ---------- 衝刺：跟戰鬥一樣噴粒子、播音效，飛船能力做出樣子（基地沒有敵人：殘影不吸引火力；砲台打標靶機） ----------
  //   多人房間：hubDash 事件（net.js 轉給其他人），對方用 dashFx 畫出同樣的效果；砲台的子彈走 hubFire
  startDash() {
    const s = this.ship, ab = s.ship.ability;
    this.dashSX = s.x; this.dashSY = s.y;
    if (ab === 'phase') { this.phaseJump(); this.dashT = CFG.PHASE.t; }  // 先鋒號：朝衝刺方向瞬移（可以穿牆，落點要在房間或開口裡）
    this.dash(['phase', 'decoy', 'turret'].includes(ab) ? ab : 'dash', this.dashSX, this.dashSY, s.x, s.y, s.aim);
  },
  phaseJump() {
    const s = this.ship, c = Math.cos(this.dashA), n = Math.sin(this.dashA);
    for (let d = CFG.PHASE.dist; d > 0; d -= 4) if (this.free(s.x + c * d, s.y + n * d, s.r)) { s.x += c * d; s.y += n * d; return; }
  },
  dash(k, x0, y0, x1, y1, a) {
    this.dashFx(0, k, x0, y0, x1, y1, a, this.shipId);
    Events.emit('hubDash', { k, x0, y0, x1, y1, a, s: this.shipId });
  },
  // 畫衝刺效果（自己的、別人傳來的）：k = dash（只有粒子）／phase（起點、落點的圈＋電光）／decoy（殘影）／turret（砲台）／portal（一對門）
  //   殘影、砲台、星門每個人同時只有一個（跟戰鬥一樣）；顏色：多人用號碼色，單人用船色（星門一律船色）
  dashFx(sl, k, x0, y0, x1, y1, a, shipId) {
    const S = SHIPS[shipId] || SHIPS.vanguard, col = this.coop() ? Game.slotColor(sl || Net.mySlot()) : S.color;
    if (k !== 'portal') this.puff(x0, y0, S.color);
    if (k === 'phase') { this.puff(x1, y1, S.color); this.dfx.push({ k, sl, x: x0, y: y0, x1, y1, t: 0.3, max: 0.3, col: S.color }); }
    if (k === 'decoy' || k === 'turret' || k === 'portal') {
      const T = k === 'decoy' ? CFG.DECOY.t : k === 'turret' ? CFG.TURRET.t : 3;
      this.dfx = this.dfx.filter(f => !(f.k === k && f.sl === sl));
      this.dfx.push({ k, sl, x: x0, y: y0, x1, y1, aim: a, t: T, max: T, col: k === 'portal' ? S.color : col, cd: 0 });
    }
  },
  puff(x, y, col) {  // 衝刺噴的粒子（跟戰鬥的 burst 差不多：10 顆、0.3 秒）
    for (let i = 0; i < 10; i++) { const a = rand(0, TAU), v = rand(50, 160); this.puffs.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.3, col }); }
  },
  // 每幀：效果倒數；自己的砲台朝射程內最近的標靶機開火（武器的基本數值、傷害 ×CFG.TURRET.dmg、射速跟飛船一樣）
  updateDash(dt) {
    for (const f of this.dfx) {
      f.t -= dt;
      if (f.k !== 'turret' || f.sl || (f.cd -= dt) > 0) continue;
      const P = weaponParams({ id: this.weaponId, path: null, final: null }), R = clamp(P.speed * P.life + 40, 140, CFG.AUTO_RANGE);
      let T = null, bd = R;
      for (const o of HUB.targets) { const d = Math.hypot(o.x - f.x, o.y - f.y); if (d < bd) { bd = d; T = o; } }
      if (!T) continue;
      f.aim = Math.atan2(T.y - f.y, T.x - f.x); f.cd = P.interval;
      const x = f.x + Math.cos(f.aim) * 10, y = f.y + Math.sin(f.aim) * 10;
      this.addFire(0, x, y, f.aim, this.weaponId, CFG.TURRET.dmg);
      Events.emit('hubFire', { x, y, a: f.aim, w: this.weaponId, m: CFG.TURRET.dmg });
    }
    this.dfx = this.dfx.filter(f => f.t > 0);
    const kd = Math.exp(-8 * dt);
    for (const q of this.puffs) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= kd; q.vy *= kd; q.t -= dt; }
    this.puffs = this.puffs.filter(q => q.t > 0);
  },
  // 星門：o（飛船、子彈）這一幀從門外走進門（(x0, y0) = 移動前）→ 從另一個門出來、放在前方；0.3 秒內不能再走。回傳出口的門（沒穿過 null）
  hop(o, r, x0, y0) {
    if (this.t < (o.pcd || 0)) return null;
    for (const q of this.dfx) {
      if (q.k !== 'portal') continue;
      for (const [ax, ay, bx, by] of [[q.x, q.y, q.x1, q.y1], [q.x1, q.y1, q.x, q.y]]) {
        const rr = 22 + r;
        if (Math.hypot(o.x - ax, o.y - ay) > rr || Math.hypot(x0 - ax, y0 - ay) <= rr) continue;
        const a = Math.atan2(o.y - y0, o.x - x0);
        o.x = bx + Math.cos(a) * (rr + 2); o.y = by + Math.sin(a) * (rr + 2); o.pcd = this.t + 0.3;
        this.puff(bx, by, q.col);
        return [bx, by];
      }
    }
    return null;
  },
  num(x, y, v) { this.nums.push({ x: x + rand(-8, 8), y, v, t: 0.8 }); },
  // 標靶機 i 的每秒傷害（畫在靶上面）：最近 DPS_WIN 秒的傷害 ÷ 從這段裡第一發到現在的時間（最少 1 秒）
  //   以前一律除以 DPS_WIN：剛開始打的前幾秒偏低（軌道砲第一發 30 只顯示 10）
  dps(i) {
    let sum = 0, t0 = Infinity;
    for (const h of this.hits) if (h.i === i) { sum += h.dmg; t0 = Math.min(t0, h.t); }
    return sum ? Math.round(sum / clamp(this.t - t0, 1, HUB.DPS_WIN)) : 0;
  },
  MAX_SHOTS: 200,
  // 出發動畫：開到發射台正中（off = 多人時左右錯開）、船頭轉向跑道 → 發射台蓄能 → 沿跑道加速衝出出口 → then()
  //   只在基地真的畫在畫面上時播；模擬、測試（沒有畫面）、死亡畫面的「重新開始」直接 then()
  //   mates：多人時其他人的 { slot, off }——大家同時出發，其他人的船在自己這邊照同一套動畫畫（mateSeq），不靠位置同步（同步來的位置會跳、出了基地邊界被夾住）
  LAUNCH: { move: 0.6, charge: 0.55, fly: 0.85 },
  launch(then, off = 0, mates = []) {
    if (!this.shown() || typeof GLR === 'undefined' || !GLR.ready || Game.simFast) { if (then) then(); return; }  // GLR.ready：真的有畫面
    const s = this.ship, L = this.zone('launch');
    const inside = r => hubFree({ walk: [r] }, s.x, s.y, 0), D = HUB.doors.find(d => d.y > HUB.rooms.hall.y + HUB.rooms.hall.h - 40);
    if (!inside(HUB.rooms.bay) && !inside(HUB.rooms.hall)) { s.x = D.x + D.w / 2 + off; s.y = D.y; }  // 在別的房間：直接從大廳到甲板的開口起飛
    this.seq = { t: 0, then, x0: s.x, y0: s.y, a0: s.aim, x1: L.x + off, y1: L.y, y2: HUB.H + 240 };
    const ships = this.coop() ? Net.roomShips() : [];
    this.mateSeq = mates.map(m => { const o = ships.find(o => o.slot === m.slot); return o && { slot: m.slot, s: o.s, w: o.w, x0: o.x, y0: o.y, a0: o.a, x1: L.x + m.off, y1: L.y, y2: HUB.H + 240 }; }).filter(Boolean);
    s.vx = s.vy = 0; this.shots = []; this.dashT = 0; this.dfx = [];
    if (this.near) { this.near = null; Events.emit('hubNear', null); }
    Events.emit('hubLaunch');
  },
  updateLaunch(dt) {
    const q = this.seq, s = this.ship, T = this.LAUNCH;
    q.t += dt;
    this.launchPos(q, q.t, s);
    this.follow();
    if (q.t >= T.move + T.charge + T.fly && q.then) { const f = q.then; q.then = null; f(); }  // 飛出去之後停在外面（多人：等房主開始）
  },
  // 出發動畫播到 t 秒時飛船 o 在哪（自己的船、其他人的 mateSeq 共用）：開過去 → 蓄能停住 → 越衝越快
  launchPos(q, t, o) {
    const T = this.LAUNCH, ease = k => k * k * (3 - 2 * k), down = Math.PI / 2;
    o.moving = true; o.dashT = 0;
    if (t < T.move) {
      const k = ease(t / T.move);
      o.x = q.x0 + (q.x1 - q.x0) * k; o.y = q.y0 + (q.y1 - q.y0) * k; o.aim = q.a0 + angleDiff(q.a0, down) * k;
    } else if (t < T.move + T.charge) { o.x = q.x1; o.y = q.y1; o.aim = down; o.moving = false; }
    else {
      const k = Math.min(1, (t - T.move - T.charge) / T.fly);
      o.x = q.x1; o.y = q.y1 + (q.y2 - q.y1) * k * k * k; o.aim = down; o.dashT = 1;  // 越來越快（衝刺的光暈）
    }
    return o;
  },
  // 其他人的船在出發動畫裡的樣子（畫面用）：{ slot, x, y, aim, moving, dashT, s, w }
  mateLaunch() { return this.seq ? (this.mateSeq || []).map(q => this.launchPos(q, this.seq.t, { slot: q.slot, s: q.s, w: q.w })) : null; },
  // 發射台蓄能的程度（0～1，畫面用）：蓄能那段從 0 升到 1，衝出去時保持 1
  heat() { const q = this.seq; return q ? clamp((q.t - this.LAUNCH.move) / this.LAUNCH.charge, 0, 1) : 0; },
  // 衝出去那段播到哪（0～1，畫尾焰用；還沒衝 = 0）
  flyK() { const q = this.seq, T = this.LAUNCH; return q ? clamp((q.t - T.move - T.charge) / T.fly, 0, 1) : 0; },
  // 鏡頭跟著飛船（飛船在標題列以下那塊的正中間），不超出基地外圍太多；縮放照畫面大小（1280×800 = 1）
  follow() {
    const room = VH - HUB.TOP, k = this.k = clamp(Math.min(VW / 1280, VH / 800), 0.7, 1.3), s = this.ship;
    const vw = VW / k, vh = room / k, top = HUB.TOP / k;
    this.cam.x = vw >= HUB.W ? HUB.W / 2 - vw / 2 : clamp(s.x - vw / 2, 0, HUB.W - vw);
    this.cam.y = (vh >= HUB.H ? HUB.H / 2 - vh / 2 : clamp(s.y - vh / 2, 0, HUB.H - vh)) - top;
  },
  // 靠近的東西按 E 有沒有作用（自己開的那艘、裝著的武器：只看數據）；畫面照這個決定要不要顯示 E
  actable(z) { return !!z && !(z.kind === 'pad' && z.ship === this.shipId) && !(z.kind === 'rack' && z.weapon === this.weaponId); },
  // 按 E（或 Enter）：對靠近的東西做事
  interact() {
    const z = this.near;
    if (!z || this.seq) return false;
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
