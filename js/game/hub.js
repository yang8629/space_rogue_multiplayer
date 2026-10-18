// 星環電路 多人版 · hub.js：基地（主畫面）：開著飛船走動的場景，邏輯（配置、移動、靠近哪裡、互動）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   畫面：js/ui/gl/gl_hub.js（場景）、render.js 的 drawHubHud（文字標籤）、js/ui/base.js（面板、上方列、說明卡）
//   這裡不碰畫面：互動結果交給 Screen（面板），靠近的東西換了就發 hubNear 事件
'use strict';

// 基地配置：世界座標（W×H）。點位由 hubLayout 照數量算（加飛船、武器、門、終端機只要改資料，基地自己變大）
//   kind 決定按 E 做什麼（Hub.ACT）：pad 停機坪（每艘飛船一個）、rack 武器架（每把武器一個）、door 門（打開基地的面板）、
//   launch 發射台（選章、出發；多人 = 準備）、term 終端機
//   由上到下：上牆的門 → 武器架（一排最多 ROW_MAX 個，多的換下一排）→ 停機坪（同樣）→ 發射台＋跑道；終端機貼左右牆
const HUB = {
  WALL: 44, TOP: 100,                     // TOP：畫面上方留給標題列的高度（螢幕 px）
  SPEED: 300, DASH: 900, DASH_T: 0.16, DASH_CD: 0.6,
  MIN_W: 1200,                            // 基地最小寬度
  ROW_MAX: 6, GAP: 190, SIDE: 160,        // 停機坪、武器架：一排最多幾個、間距；左右各留多寬給終端機
  DOOR_Y: 84, DOOR_R: 70, DOOR_GAP: 300,  // 門：在上牆、互動半徑（跟第一排武器架剛好不重疊）、彼此間距
  RACK_Y0: 200, RACK_ROW: 130, RACK_R: 46,  // 武器架：第一排的 y、每排的高度、互動半徑
  PAD_DY: 150, PAD_ROW: 160, PAD_R: 60,   // 停機坪：第一排離最後一排武器架多遠、每排的高度
  TERM_R: 76, TERM_ROW: 170,              // 終端機：互動半徑、同一邊上下的間距
  LAUNCH_DY: 222, LAUNCH_R: 72, BOTTOM: 148,  // 發射台：離最後一排停機坪多遠、互動半徑；發射台到下牆外緣
  LAUNCH_PAD: 62, RUNWAY_W: 84,           // 發射台盤面的半徑；盤面到下方出口那段跑道的寬
  K_MIN: 0.75,                            // 縮放最小到多少；整個基地放不進一個畫面就改成鏡頭跟著飛船捲動
};
// 門、終端機：照這兩張表的順序排（門平均排在上牆；終端機左右輪流貼牆、同一邊的上下排開）
const HUB_DOORS = [
  { id: 'armory', label: '⚔ 軍械庫', color: '#ffb347', tab: 'armory' },
  { id: 'chips', label: '◈ 晶片庫', color: '#4cc9f0', tab: 'chips' },
  { id: 'stats', label: '🏆 戰績', color: '#ffd166', tab: 'stats' },
];
const HUB_TERMS = [
  { id: 'coop', label: '👥 多人連線', color: '#ff9dbd' },
  { id: 'range', label: '🎯 靶場', color: '#9dff6b' },
];
// 照數量算配置：回傳 { W, H, zones, padRows }（padRows = 每排停機坪的 y，地板畫走道用）
function hubLayout(shipIds, weaponIds, doors = HUB_DOORS, terms = HUB_TERMS) {
  const C = HUB, cols = Math.max(1, Math.min(C.ROW_MAX, Math.max(shipIds.length, weaponIds.length)));
  const W = Math.max(C.MIN_W, cols * C.GAP + 2 * C.SIDE, doors.length * C.DOOR_GAP), zones = [];
  // 一排一排擺：rows[j] = 第 j 排的 id
  const rows = ids => Array.from({ length: Math.ceil(ids.length / C.ROW_MAX) }, (_, j) => ids.slice(j * C.ROW_MAX, (j + 1) * C.ROW_MAX));
  const rowX = (i, n) => W / 2 + (i - (n - 1) / 2) * C.GAP;
  doors.forEach((d, i) => zones.push({ ...d, kind: 'door', x: W / 2 + (i - (doors.length - 1) / 2) * C.DOOR_GAP, y: C.DOOR_Y, r: C.DOOR_R }));
  const rr = rows(weaponIds);
  rr.forEach((row, j) => row.forEach((id, i) => zones.push({ id: 'rack:' + id, kind: 'rack', weapon: id, x: rowX(i, row.length), y: C.RACK_Y0 + j * C.RACK_ROW, r: C.RACK_R, label: WEAPONS[id] ? WEAPONS[id].name : id, color: WEAPONS[id] ? WEAPONS[id].color : '#8fa3d9' })));
  const padY0 = C.RACK_Y0 + Math.max(0, rr.length - 1) * C.RACK_ROW + C.PAD_DY, pr = rows(shipIds), padRows = pr.map((_, j) => padY0 + j * C.PAD_ROW);
  pr.forEach((row, j) => row.forEach((id, i) => zones.push({ id: 'pad:' + id, kind: 'pad', ship: id, x: rowX(i, row.length), y: padRows[j], r: C.PAD_R, label: SHIPS[id] ? SHIPS[id].name : id, color: SHIPS[id] ? SHIPS[id].color : '#8fa3d9' })));
  const lastPad = padRows[padRows.length - 1] || padY0, launchY = lastPad + C.LAUNCH_DY;
  zones.push({ id: 'launch', kind: 'launch', x: W / 2, y: launchY, r: C.LAUNCH_R, label: '🚀 發射台', color: '#4cc9f0' });
  // 終端機：左右輪流；同一邊有幾台就以停機坪中間為準上下排開
  const midY = (padRows[0] + lastPad) / 2 + 20, perSide = [Math.ceil(terms.length / 2), Math.floor(terms.length / 2)];
  terms.forEach((t, i) => {
    const side = i % 2, k = Math.floor(i / 2), n = perSide[side];
    zones.push({ ...t, kind: 'term', x: side ? W - C.WALL - 40 : C.WALL + 40, y: midY + (k - (n - 1) / 2) * C.TERM_ROW, r: C.TERM_R });
  });
  return { W, H: launchY + C.BOTTOM, zones, padRows };
}
Object.assign(HUB, hubLayout(Object.keys(SHIPS), Object.keys(WEAPONS)));

const Hub = {
  ready: false, shipId: null, weaponId: null, ship: null, near: null, cam: { x: 0, y: 0 }, k: 1, t: 0, dashT: 0, dashCd: 0, dashA: 0,  // k：基地的縮放（螢幕 px / 基地座標）

  // 進基地：飛船停在發射台左邊（不壓到停機坪的名字）；機庫選的飛船沒解鎖（例如存檔重來）就換成第一艘解鎖的
  enter() {
    const ids = Object.keys(SHIPS), want = this.shipId || Game.shipId;
    this.shipId = SHIPS[want] && isUnlocked('ship', want) ? want : ids.find(id => isUnlocked('ship', id)) || ids[0];
    const ws = Object.keys(WEAPONS), ww = this.weaponId || (Game.weapon && Game.weapon.id);  // 武器：上次裝的（沒解鎖就換成第一把解鎖的）
    this.weaponId = WEAPONS[ww] && isUnlocked('weapon', ww) ? ww : ws.find(id => isUnlocked('weapon', id)) || ws[0];
    const L = this.zone('launch');
    if (!this.ship) this.ship = { x: L.x - 150, y: L.y, vx: 0, vy: 0, aim: -Math.PI / 2, r: 12, moving: false, iframe: 0, dashT: 0, overdrive: 0 };
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
    const m = HUB.WALL + s.r;
    s.x = clamp(s.x + s.vx * dt, m, HUB.W - m); s.y = clamp(s.y + s.vy * dt, m + 30, HUB.H - m);
    const wx = Input.mx / this.k + this.cam.x, wy = Input.my / this.k + this.cam.y;
    if (Input.mouseMoved) s.aim = Math.atan2(wy - s.y, wx - s.x);
    else if (s.moving) s.aim = Math.atan2(my, mx);
    this.follow();
    // 最近的互動點（自己現在開的那艘的停機坪不算）
    let best = null, bd = Infinity;
    for (const z of HUB.zones) {
      if ((z.kind === 'pad' && z.ship === this.shipId) || (z.kind === 'rack' && z.weapon === this.weaponId)) continue;
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < z.r && d < bd) { best = z; bd = d; }
    }
    if (best !== this.near) { this.near = best; Events.emit('hubNear', best); }
  },
  // 鏡頭：整個基地縮放到一個畫面（上方留 TOP 給標題列），置中；縮放會小於 K_MIN（基地太大）就停在 K_MIN、改成跟著飛船捲動
  //   每一個方向各自判斷：放得下的方向置中，放不下的方向跟著飛船（不超出基地外面太多）
  follow() {
    const room = VH - HUB.TOP, k = this.k = clamp(Math.min(VW / (HUB.W + 60), room / (HUB.H + 30)), HUB.K_MIN, 1.6), s = this.ship;
    const vw = VW / k, vh = room / k, top = HUB.TOP / k;
    this.cam.x = vw >= HUB.W + 60 ? HUB.W / 2 - vw / 2 : clamp(s.x - vw / 2, -30, HUB.W + 30 - vw);
    this.cam.y = (vh >= HUB.H + 30 ? HUB.H / 2 - vh / 2 : clamp(s.y - vh / 2, -15, HUB.H + 15 - vh)) - top;
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
    door: z => Screen.basePanel(z.tab),
    launch: () => Screen.basePanel('launch'),
    term: z => { if (!Hub.coop()) { if (z.id === 'coop') Net.lobby(); else Game.newRun('range', Hub.shipId, Hub.weaponId); } },  // 靶場：用目前開的船、裝的武器
  },
};
