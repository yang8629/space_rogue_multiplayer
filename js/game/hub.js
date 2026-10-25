// 星環電路 多人版 · hub.js：基地（主畫面）：開著飛船走動的太空站，邏輯（配置、碰撞、移動、靠近哪裡、互動）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   畫面：js/ui/gl/gl_hub.js（場景）、render.js 的 drawHubHud（文字標籤）、js/ui/base.js（面板、上方列、說明卡）
//   這裡不碰畫面：打開面板發 hubPanel、靠近的東西換了發 hubNear 事件
//   飛船、子彈、衝刺跟戰鬥同一套（見 build）
'use strict';

// 基地配置：分區的太空站。中間是中央大廳（出生點在正中），下面延伸出去發射甲板（發射台、跑道）；左翼機庫（停機位沿大圓排一圈、船頭朝中間的轉盤）；右翼軍械庫（武器架靠上牆排）；
//   上面一排：晶片實驗室、觀景台、戰績室。房間之間隔一道牆，牆上的開口讓飛船過去。
//   房間、開口都是矩形：飛船只能待在這些矩形裡（walk）。
//   點位由 hubLayout 照數量算：加飛船 = 機庫的圓圈變大，加武器 = 軍械庫多一個架（一排 ARMORY_COLS 個），房間自己變大
//   kind 決定按 E 做什麼（Hub.ACT）：pad 停機位、rack 武器架、console 房間裡的操作台（打開面板）、launch 發射台、term 終端機
const HUB = {
  WT: 40, MARGIN: 140, TOP: 100,          // 牆厚；基地外圍留白（看得到太空）；畫面上方標題列的高度（螢幕 px）
  HALL_W: 860, HALL_H: 640,               // 中央大廳（最小）
  BAY_W: 320, BAY_H: 400, BAY_DOOR: 230,   // 發射甲板（大廳下面延伸出去）：寬、高、跟大廳之間的開口寬
  BAY_ARC: 200, RING_MIN: 230, RING_GAP: 1.3, PAD_R: 60,  // 機庫：每個停機位佔的弧長、圓圈最小半徑、對著大廳那側的缺口（弧度）
  RACK_GAP: 130, ARMORY_COLS: 5, RACK_ROW: 150, RACK_R: 46,      // 軍械庫：武器架間距、一排幾個、每排高度
  TOP_W: 440, TOP_H: 380,                 // 上面一排三個房間的大小
  DOOR_W: 170,                            // 牆上開口的寬
  CHAMFER: 44,                            // 房間四個角斜切掉的大小（外觀不要太方正；旁邊有門的角、發射甲板不切）
  CONSOLE_R: 70, TERM_R: 70, LAUNCH_R: 72, LAUNCH_PAD: 62, RUNWAY_W: 84,
  TARGET_R: 24, DPS_WIN: 3,               // 軍械庫標靶機的半徑、每秒傷害算最近幾秒
};
// 房間：名字（地上的字）、顏色（地板色調、燈）；console = 房間裡的操作台打開哪個面板；uncut = 不切的角（上左、上右、下右、下左）
const HUB_ROOMS = {
  hall: { label: '中央大廳', en: 'CENTRAL HALL', color: '#4cc9f0' },
  bay: { label: '發射甲板', en: 'LAUNCH DECK', color: '#4cc9f0' },
  hangar: { label: '機庫', en: 'HANGAR', color: '#7fb4ff' },
  armory: { label: '軍械庫', en: 'ARMORY', color: '#ffb347', console: { id: 'armory', label: '⚔ 武器資料', tab: 'armory' } },
  lab: { label: '晶片實驗室', en: 'CHIP LAB', color: '#2ee6a6', console: { id: 'chips', label: '◈ 晶片庫', tab: 'chips' } },
  deck: { label: '觀景台', en: 'OBSERVATION', color: '#9fb4ff' },
  records: { label: '戰績室', en: 'RECORDS', color: '#ffd166', console: { id: 'stats', label: '🏆 戰績', tab: 'stats' }, uncut: ['下右'] },  // uncut：不切的角（左右牆下段掛螢幕，一路到地板）
};
// 終端機：中央大廳的左右牆，左右輪流、同一邊往下排；desc = 靠近時說明卡寫的（按 E 做什麼在 Hub.TERM_ACT）
const HUB_TERMS = [
  { id: 'coop', label: '👥 多人連線', color: '#ff9dbd', desc: () => '開房間或加入朋友的房間' },
  { id: 'range', label: '🎯 靶場', color: '#9dff6b', desc: () => `用${SHIPS[Hub.shipId].name}＋${WEAPONS[Hub.weaponId].name}進靶場` },
  { id: 'tutorial', label: '📘 新手引導', color: '#ffd166', desc: () => `一次教一件事：${TUTORIAL_SECS.join('、')}` },
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
  // 房間的切角：每個切掉的角 { x, y, sx, sy }（角的位置、往房間裡面的方向）；角落 C＋24 的範圍裡有門就不切（門口不能被切到）
  //   碰撞（Arena.fromRects、hubFree）和畫面（GLHub）都照這份
  const CH = C.CHAMFER, P = CH + 24;
  for (const r of Object.values(rooms)) {
    r.C = CH;
    r.cuts = r.id === 'bay' ? [] : [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x + r.w, r.y + r.h, -1, -1], [r.x, r.y + r.h, 1, -1]]
      .filter(([x, y, sx, sy]) => !(r.uncut || []).includes((sy > 0 ? '上' : '下') + (sx > 0 ? '左' : '右')) && !doors.some(d => d.x < Math.max(x, x + sx * P) && d.x + d.w > Math.min(x, x + sx * P) && d.y < Math.max(y, y + sy * P) && d.y + d.h > Math.min(y, y + sy * P)))
      .map(([x, y, sx, sy]) => ({ x, y, sx, sy }));
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
  // 終端機：大廳左右牆，左右輪流、同一邊往下排；第一台從 y + 180 開始（再上面是左上角地上的房名「中央大廳 CENTRAL HALL」，130 時終端機蓋住英文字）
  //   第二排起放在左右牆中間的開口（通機庫、軍械庫）下面：照 180 + 170 排會擋在開口前
  terms.forEach((t, i) => { const side = i % 2, k = Math.floor(i / 2);
    zones.push({ ...t, kind: 'term', side, x: side ? hall.x + hall.w - 56 : hall.x + 56, y: k ? my + D / 2 + C.TERM_R + 20 + (k - 1) * 170 : hall.y + 180, r: C.TERM_R }); });
  return { W: R.armory.x + armoryW + M, H: R.bay.y + R.bay.h + M, rooms, doors, walk: [...Object.values(rooms), ...doors], zones, spawn: { x: cx, y: hall.y + hall.h / 2 }, targets };
}
Object.assign(HUB, hubLayout(Object.keys(SHIPS), Object.keys(WEAPONS)));
// 配置 L 裡，半徑 r 的飛船放在 (x, y) 可不可以：整個在某個房間（扣掉切角）或開口裡
function hubFree(L, x, y, r) { return L.walk.some(R => x - r >= R.x && x + r <= R.x + R.w && y - r >= R.y && y + r <= R.y + R.h && !hubInCut(R, x, y, r)); }
// (x, y) 半徑 r 有沒有碰到 R 的切角（切角的斜邊：(x - 角x)·sx + (y - 角y)·sy = C；離斜邊 r 以內也算碰到）
function hubInCut(R, x, y, r = 0) { return (R.cuts || []).some(q => (x - q.x) * q.sx + (y - q.y) * q.sy < R.C + r * Math.SQRT2); }

const Hub = {
  driving: false,  // 基地的飛船現在能開（基地畫面、沒開面板）；畫面開關面板時用 setDriving 設
  setDriving(on) { this.driving = !!on; },
  ready: false, shipId: null, weaponId: null, ship: null, near: null, seq: null, cam: { x: 0, y: 0 }, k: 1, t: 0,  // ship = Game.player（戰鬥的 Player）；k：基地的縮放（螢幕 px / 基地座標）；seq：出發動畫播到哪（null = 沒在播）
  ghosts: {},  // 多人房間：其他人的飛船（號碼 → Player，見 updateGhosts）

  // 上次選的飛船、武器（存在瀏覽器 HUB_LAST_KEY：重新整理、下次打開遊戲還記得）；壞掉的存檔當成沒有
  last() { const o = Save.load('lastPick', {}); return o && typeof o === 'object' ? o : {}; },  // 上次選的飛船、武器
  saveLast() { Save.save('lastPick', { ship: this.shipId, weapon: this.weaponId }); },
  // 進基地：飛船在大廳正中（spawn）；選的飛船（這次開著的 → 上次存的）沒解鎖（例如存檔重來）就換成第一艘解鎖的
  //   存的排在 Game.weapon 前面：遊戲一打開 Game.weapon 就是預設的雷射（真的 Chrome 測到存的武器被它蓋掉）；存的每次換都會更新，一定是最新的
  enter() {
    const L = this.last(), ids = Object.keys(SHIPS), want = this.shipId || L.ship || Game.shipId;
    this.shipId = SHIPS[want] && isUnlocked('ship', want) ? want : ids.find(id => isUnlocked('ship', id)) || ids[0];
    const ws = Object.keys(WEAPONS), ww = this.weaponId || L.weapon || (Game.weapon && Game.weapon.id);  // 武器：上次裝的（沒解鎖就換成第一把解鎖的）
    this.weaponId = WEAPONS[ww] && isUnlocked('weapon', ww) ? ww : ws.find(id => isUnlocked('weapon', id)) || ws[0];
    const s = this.ship && !this.seq ? this.ship : null;  // 出發過（飛出去了）：回來從大廳正中開始
    this.seq = null;
    this.build(s ? s.x : HUB.spawn.x, s ? s.y : HUB.spawn.y, s ? s.aim : -Math.PI / 2);
    this.ready = true;
    this.near = null;
    this.follow();
  },
  // 基地 = 一個房間的戰場：房間、開口的矩形做成場地（Arena.fromRects），飛船、子彈、衝刺、飛船能力、武器右鍵都是戰鬥那一套（Player、Bullet、Dash）；
  //   標靶機 = 打不死的標靶（dummy，hits 記每一下，見 dps）；自己的配裝（Game.L）照開的船、裝的武器重建，電路只有武器
  build(x, y, aim) {
    const G = Game, S = SHIPS[this.shipId];
    G.mode = 'hub'; G.shipId = this.shipId;
    Arena.fromRects(HUB.walk, HUB.W, HUB.H, HUB.spawn);
    Object.assign(G, { weapon: { id: this.weaponId, path: null, final: null }, chain: ['weapon', null, null, null], socks: [], inventory: Array(CFG.INV_SLOTS).fill(null),
      wSock: CFG.WEAPON_SOCKETS, playKills: {}, parts: { ...S.parts }, partSlots: S.partSlots, cap: S.cap, boons: cleanBoons() });
    Object.assign(G, { runStats: null, combat: null, objs: [], mates: [], bullets: [], slashQ: [], eBullets: [], pickups: [], triggerQueue: [],
      portals: [], decoys: [], turrets: [], zones: [], nextId: 1 });
    this.ghosts = {};
    Events.emit('fxClear');
    const p = G.player = this.ship = new Player(S);
    p.x = x; p.y = y; p.aim = aim;
    G.enemies = HUB.targets.map(T => { const e = new Enemy('dummy', T.x, T.y, 1); e.r = T.r; e.hx = T.x; e.hy = T.y; e.spawnT = 0; e.hits = []; return e; });
    G.refreshWeapon();  // 內含 recalc（血量、數值）
    p.hp = p.maxHp;
  },
  rebuild() { const s = this.ship; this.build(s.x, s.y, s.aim); },  // 換船、換武器：原地重建
  setShip(id) { this.shipId = id; if (this.ship) this.rebuild(); },
  zone(id) { return HUB.zones.find(z => z.id === id) || null; },
  // 基地畫在畫面上：主畫面（title）、多人連線畫面（lobby，從基地的終端機打開，基地留在後面）、多人房間（pick）
  shown() { return this.ready && !Game.inArena && ['title', 'lobby', 'pick'].includes(Game.state); },
  coop() { return Game.state === 'pick'; },  // 多人選配裝中：發射台 = 準備，終端機不能用
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
    this.weaponId = id; this.rebuild(); this.saveLast();
    Events.emit('hubSwap', id);
    return true;
  },
  // 選的章：沒解鎖就用第一章
  chapter() { return chapterUnlocked(Game.chapterId) ? Game.chapterId : CHAPTERS[0].id; },

  // 每幀（只在基地畫面、沒開面板時）：跑戰鬥那一套（飛船、標靶、殘影、砲台、星門、子彈、特效），找最近的互動點
  update(dt) {
    const G = Game;
    this.t += dt;
    if (this.seq) { this.updateLaunch(dt); return; }  // 出發動畫中：不能操作
    if (this.coop()) this.updateGhosts(dt);
    G.step(dt);  // 戰場那一套（跟戰鬥同一個函式）
    if (this.coop()) this.roomHits();
    G.updateFx(dt);
    this.follow(dt);
    // 最近的互動點（自己開的那艘的停機坪、裝著的武器的架子也算：看數據，按 E 不會換）
    const s = this.ship;
    let best = null, bd = Infinity;
    for (const z of HUB.zones) {
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < z.r && d < bd) { best = z; bd = d; }
    }
    if (best !== this.near) { this.near = best; Events.emit('hubNear', best); }
  },
  // 多人房間：其他人的飛船在自己這邊也跑一份（G.mates，配裝照他開的船、裝的武器）——位置照同步，開火、衝刺、右鍵照同步來的按鍵（Net.onRoomPos）；
  //   開火、右鍵、飛船能力照戰鬥的隊友一樣算（Net.hostUpdateMate）。只是看得到、打得到標靶機，不影響對方
  updateGhosts(dt) {
    const G = Game, list = [];
    for (const o of Net.roomShips()) {
      let m = this.ghosts[o.slot];
      if (!m || m.ship !== SHIPS[o.s] || m.L.weapon.id !== o.w) {
        m = this.ghosts[o.slot] = new Player(SHIPS[o.s]);
        m.slot = o.slot; m.L = Net.makeLoadout({ ship: o.s, weapon: WEAPONS[o.w] ? o.w : 'laser', chip: null }); m.dashSeq = o.ds; m.altSeq = o.as;
      }
      m.x = o.x; m.y = o.y; m.vx = o.vx; m.vy = o.vy; m.aim = o.a; m.moving = o.m; m.dashT = o.dT; m.wantFire = o.f && !o.b;
      if (o.ds > m.dashSeq) { m.dashSeq = o.ds; m.dashSX = o.x; m.dashSY = o.y; G.withLoadout(m.L, () => m.onDash()); }  // 殘影、砲台、星門
      if (o.as > m.altSeq) { m.altSeq = o.as; m.altQ = true; }
      list.push(m);
    }
    G.mates = list;
    for (const m of list) Net.hostUpdateMate(m, dt);
  },
  // 多人房間的互射（不扣血）：別人的子彈打到自己 → 自己的船往子彈方向推、閃白（CFG.ROOM_HIT）；自己的子彈打到別人 → 只畫火花（推他由他自己的電腦算）
  //   鉤爪不算（勾人走 GrappleHook.hookShips）。b.owner：別人的子彈是他的配裝、自己的是 null
  roomHits() {
    const G = Game, P = G.player, R = CFG.ROOM_HIT;
    for (const b of G.bullets) {
      if (b.dead || b.hook || b.mode === 'park') continue;
      const tgt = b.owner ? (P.dead ? null : P) : G.mates.find(m => dist2(m.x, m.y, b.x, b.y) < (m.r + b.r) ** 2);
      if (!tgt || b.hitSet.has('ship' + G.slotOf(tgt)) || dist2(tgt.x, tgt.y, b.x, b.y) >= (tgt.r + b.r) ** 2) continue;
      b.hitSet.add('ship' + G.slotOf(tgt));
      if (tgt === P) { P.vx = Math.cos(b.angle) * R.push; P.vy = Math.sin(b.angle) * R.push; P.kbT = R.t; P.iframe = Math.max(P.iframe || 0, R.t); }
      burst(b.x, b.y, b.color, 6, 140, 0.25, 2);
      if (!(b.pierce > 0)) b.dead = true;
    }
  },
  // 飛船（半徑 r）放在 (x, y) 可不可以：整個在某個房間或開口裡
  free(x, y, r) {
    return hubFree(HUB, x, y, r);
  },
  // 標靶機 i 的每秒傷害（畫在靶上面）：最近 DPS_WIN 秒的傷害 ÷ 從這段裡第一發到現在的時間（最少 1 秒）
  //   以前一律除以 DPS_WIN：剛開始打的前幾秒偏低（射速慢的武器第一發只顯示三分之一）
  dps(i) {
    const e = Game.enemies[i], now = Game.time;
    if (!e || !e.hits) return 0;
    e.hits = e.hits.filter(h => now - h[0] < HUB.DPS_WIN);
    let sum = 0, t0 = Infinity;
    for (const [t, d] of e.hits) { sum += d; t0 = Math.min(t0, t); }
    return sum ? Math.round(sum / clamp(now - t0, 1, HUB.DPS_WIN)) : 0;
  },
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
    s.vx = s.vy = 0; s.dashT = 0; Game.bullets = []; Game.decoys = []; Game.turrets = []; Game.portals = []; Game.mates = [];  // 其他人改照 mateSeq 畫
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
  // 鏡頭跟著飛船：dt 有給 = 平滑跟上（跟戰鬥一樣每秒 8 倍差距；先鋒號瞬移時鏡頭不會一下跳過去）；沒給 = 直接對準（進基地、出發動畫）
  follow(dt) {
    const room = VH - HUB.TOP, k = this.k = clamp(Math.min(VW / 1280, VH / 800), 0.7, 1.3), s = this.ship;
    const vw = VW / k, vh = room / k, top = HUB.TOP / k;
    const tx = vw >= HUB.W ? HUB.W / 2 - vw / 2 : clamp(s.x - vw / 2, 0, HUB.W - vw);
    const ty = (vh >= HUB.H ? HUB.H / 2 - vh / 2 : clamp(s.y - vh / 2, 0, HUB.H - vh)) - top;
    const a = dt == null ? 1 : Math.min(1, dt * 8);
    this.cam.x += (tx - this.cam.x) * a; this.cam.y += (ty - this.cam.y) * a;
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
  // 按 Q：靠近武器架（鎖住的也行）→ 打開電路總覽的武器頁、捲到這把的升級路線（ui/listeners.js）
  paths() {
    const z = this.near;
    if (!z || z.kind !== 'rack' || this.seq) return false;
    Events.emit('hubPaths', z.weapon);
    return true;
  },
  ACT: {
    pad: z => Hub.pick(z.ship),
    rack: z => Hub.equip(z.weapon),
    console: z => Events.emit('hubPanel', z.tab),  // 打開面板（ui/base.js）
    launch: () => Events.emit('hubPanel', 'launch'),
    term: z => { if (!Hub.coop()) Hub.TERM_ACT[z.id](); },
  },
  // 終端機按 E：靶場用目前開的船、裝的武器；新手引導固定用 CFG.TUTORIAL 的船和武器
  TERM_ACT: {
    coop: () => Net.lobby(),
    range: () => Game.newRun('range', Hub.shipId, Hub.weaponId),
    tutorial: () => Tutorial.begin(),
  },
};
