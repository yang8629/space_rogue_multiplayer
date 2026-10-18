// 星環電路 多人版 · hub.js：基地（主畫面）：開著飛船走動的場景，邏輯（配置、移動、靠近哪裡、互動）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   畫面：js/ui/gl/gl_hub.js（場景）、render.js 的 drawHubHud（文字標籤）、js/ui/base.js（面板、上方列、說明卡）
//   這裡不碰畫面：互動結果交給 Screen（面板），靠近的東西換了就發 hubNear 事件
'use strict';

// 基地配置：世界座標（W×H），點位一律寫在這張表；kind 決定按 E 做什麼（Hub.ACT）
//   pad：停機坪（每艘飛船一個），door：門（打開基地的面板），launch：發射台（選章、出發；多人 = 準備），term：終端機
const HUB = {
  W: 1200, H: 660, WALL: 44, TOP: 100,  // TOP：畫面上方留給標題列的高度（螢幕 px）
  SPEED: 300, DASH: 900, DASH_T: 0.16, DASH_CD: 0.6,
  zones: [
    { id: 'armory', kind: 'door', x: 300, y: 84, r: 80, label: '⚔ 軍械庫', color: '#ffb347', tab: 'armory' },
    { id: 'chips', kind: 'door', x: 600, y: 84, r: 80, label: '◈ 晶片庫', color: '#4cc9f0', tab: 'chips' },
    { id: 'stats', kind: 'door', x: 900, y: 84, r: 80, label: '🏆 戰績', color: '#ffd166', tab: 'stats' },
    { id: 'coop', kind: 'term', x: 84, y: 330, r: 76, label: '👥 多人連線', color: '#ff9dbd' },
    { id: 'range', kind: 'term', x: 1116, y: 330, r: 76, label: '🎯 靶場', color: '#9dff6b' },
    { id: 'launch', kind: 'launch', x: 600, y: 524, r: 88, label: '🚀 發射台', color: '#4cc9f0' },
  ],
  PAD_Y: 300, PAD_GAP: 190, PAD_R: 60,
};
// 停機坪：照 SHIPS 的順序一排，中間對齊
for (const [i, id] of Object.keys(SHIPS).entries()) {
  const n = Object.keys(SHIPS).length;
  HUB.zones.push({ id: 'pad:' + id, kind: 'pad', ship: id, x: HUB.W / 2 + (i - (n - 1) / 2) * HUB.PAD_GAP, y: HUB.PAD_Y, r: HUB.PAD_R, label: SHIPS[id].name, color: SHIPS[id].color });
}

const Hub = {
  ready: false, shipId: null, ship: null, near: null, cam: { x: 0, y: 0 }, k: 1, t: 0, dashT: 0, dashCd: 0, dashA: 0,  // k：基地的縮放（螢幕 px / 基地座標），整個基地放進一個畫面

  // 進基地：飛船停在發射台前面；機庫選的飛船沒解鎖（例如存檔重來）就換成第一艘解鎖的
  enter() {
    const ids = Object.keys(SHIPS), want = this.shipId || Game.shipId;
    this.shipId = SHIPS[want] && isUnlocked('ship', want) ? want : ids.find(id => isUnlocked('ship', id)) || ids[0];
    const L = this.zone('launch');
    if (!this.ship) this.ship = { x: L.x, y: L.y - 120, vx: 0, vy: 0, aim: -Math.PI / 2, r: 12, moving: false, iframe: 0, dashT: 0, overdrive: 0 };
    this.setShip(this.shipId);
    this.ready = true;
    this.near = null;
    this.follow();
  },
  zone(id) { return HUB.zones.find(z => z.id === id) || null; },
  // 基地畫在畫面上：主畫面（title），或多人開局選配裝（pick）
  shown() { return this.ready && !Game.inArena && (Game.state === 'title' || Game.state === 'pick'); },
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
      if (z.kind === 'pad' && z.ship === this.shipId) continue;
      const d = Math.hypot(z.x - s.x, z.y - s.y);
      if (d < z.r && d < bd) { best = z; bd = d; }
    }
    if (best !== this.near) { this.near = best; Events.emit('hubNear', best); }
  },
  // 鏡頭：整個基地縮放到一個畫面（上方留 TOP 給標題列），置中；畫面大小變了也跟著算
  follow() {
    const room = VH - HUB.TOP;
    this.k = clamp(Math.min(VW / (HUB.W + 60), room / (HUB.H + 30)), 0.55, 1.6);
    this.cam.x = HUB.W / 2 - VW / 2 / this.k;
    this.cam.y = HUB.H / 2 - (HUB.TOP + room / 2) / this.k;
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
    door: z => Screen.basePanel(z.tab),
    launch: () => Screen.basePanel('launch'),
    term: z => { if (!Hub.coop()) { if (z.id === 'coop') Net.lobby(); else Screen.weaponSelect('range', Hub.shipId); } },  // 靶場：用目前開的這艘選武器
  },
};
