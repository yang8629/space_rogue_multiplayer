// 星環電路 多人版 · gl/gl_hub.js：WebGL 繪圖層：基地場景（地板、牆、門、停機坪、發射台、終端機、停著的飛船、自己開的船）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   配置照 HUB（js/game/hub.js）；這裡只讀 Hub 的狀態畫出來。文字標籤畫在 2D 畫布（render.js 的 drawHubHud）
//   畫法照「新畫面風格」：切面上色、#03050c 描邊、左上光、金屬藍灰、會亮的地方用加法發光（整個世界有 bloom）
'use strict';

const HUB_INK = 0x03050c;
// 顏色變亮／變暗（k > 0 變亮，< 0 變暗）
function hubShade(c, k) {
  const ch = s => { const v = (c >> s) & 255; return Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)); };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
// 切面的亮度：法線朝左上（光的方向）越亮
const hubLit = (nx, ny) => (-nx - ny) / Math.SQRT2;

const GLHub = {
  init() {
    const L = GLR.L;
    this.gBase = new PIXI.Graphics(); L.hub.addChild(this.gBase);   // 不會動的：地板、牆、停機坪、發射台的底座、終端機
    this.gAnim = new PIXI.Graphics(); L.hub.addChild(this.gAnim);   // 會動的：門片、停機坪的光圈、發射台的箭頭
    this.pG = GLR.pool('hubGlow', L.hub, () => new PIXI.Sprite());  // 加法發光
    this.built = false;
  },
  glow(x, y, r, col, a) { return GLActors.glowAt(this.pG, x, y, r, col, a); },

  // ---------- 不會動的部分：第一次畫的時候畫一次 ----------
  build() {
    const g = this.gBase, W = HUB.W, H = HUB.H, T = HUB.WALL;
    // 地板：80×80 的暗色金屬板，每塊亮度差一點點，左上緣細細一條亮、右下緣暗，板縫用描邊色（地板要暗，停機坪、門才跳得出來）
    const B = 80;
    for (let x = T; x < W - T; x += B) for (let y = T; y < H - T; y += B) {
      const w = Math.min(B, W - T - x), h = Math.min(B, H - T - y), base = hubShade(0x121931, (seeded(x * 0.13 + y * 0.71) - 0.5) * 0.08);
      g.rect(x, y, w, h).fill(base);
      g.poly([x, y, x + w, y, x + w - 3, y + 3, x + 3, y + 3]).fill(hubShade(base, 0.1));
      g.poly([x, y, x + 3, y + 3, x + 3, y + h - 3, x, y + h]).fill(hubShade(base, 0.05));
      g.poly([x, y + h, x + 3, y + h - 3, x + w - 3, y + h - 3, x + w, y + h]).fill(hubShade(base, -0.3));
      g.poly([x + w, y, x + w, y + h, x + w - 3, y + h - 3, x + w - 3, y + 3]).fill(hubShade(base, -0.2));
      g.rect(x, y, w, h).stroke({ width: 1.5, color: HUB_INK });
    }
    // 走道：停機坪那一排、發射台往上的那條，地板顏色亮一點
    g.rect(T + 30, HUB.PAD_Y - 90, W - 2 * T - 60, 180).fill({ color: 0x2a3658, alpha: 0.25 });
    g.rect(W / 2 - 80, HUB.PAD_Y + 90, 160, HUB.H - T - HUB.PAD_Y - 90).fill({ color: 0x2a3658, alpha: 0.25 });
    // 牆：外框一圈厚金屬，上、左面亮，下、右面暗
    const wall = (x, y, w, h, k) => { g.rect(x, y, w, h).fill(hubShade(0x3a4870, k)).stroke({ width: 3, color: HUB_INK }); g.rect(x + 4, y + 4, w - 8, Math.min(10, h - 8)).fill({ color: 0xffffff, alpha: 0.06 }); };
    wall(0, 0, W, T, 0.12); wall(0, H - T, W, T, -0.3); wall(0, T, T, H - 2 * T, 0.05); wall(W - T, T, T, H - 2 * T, -0.22);
    // 牆上的鉚釘條
    for (let x = 40; x < W - 20; x += 80) { g.rect(x, 14, 18, 8).fill(0x55658f).stroke({ width: 2, color: HUB_INK }); g.rect(x, H - 22, 18, 8).fill(0x2a3350).stroke({ width: 2, color: HUB_INK }); }
    // 門洞（上牆挖空，門片在 gAnim 畫）
    for (const z of HUB.zones.filter(z => z.kind === 'door')) {
      g.rect(z.x - 84, 0, 168, T + 6).fill(0x0a0f1f).stroke({ width: 3, color: HUB_INK });
      g.rect(z.x - 92, T + 6, 184, 10).fill(hubShade(0x3a4870, -0.1)).stroke({ width: 2, color: HUB_INK });  // 門檻
    }
    // 發射口（下牆挖空，外面是太空）＋盤面到出口的跑道（兩側金屬軌，箭頭在 gAnim 畫）
    const L = Hub.zone('launch'), RW = HUB.RUNWAY_W, ry = L.y + HUB.LAUNCH_PAD - 4;
    g.rect(L.x - RW / 2 - 8, H - T - 4, RW + 16, T + 4).fill(0x02030a).stroke({ width: 3, color: HUB_INK });
    g.rect(L.x - RW / 2, ry, RW, H - T - ry).fill(0x0c1226).stroke({ width: 2, color: HUB_INK });
    for (const sg of [-1, 1]) g.rect(L.x + sg * (RW / 2 + 4) - 4, ry, 8, H - T - ry).fill(hubShade(0x3a4870, sg < 0 ? 0.05 : -0.2)).stroke({ width: 2, color: HUB_INK });
    // 停機坪：六角形，6 個切面照光的方向上色，中間一圈
    for (const z of HUB.zones.filter(z => z.kind === 'pad')) this.hexPad(g, z.x, z.y, z.r, 0x2b3654);
    // 發射台：八角形盤面＋內圈（畫在跑道上面）
    this.hexPad(g, L.x, L.y, HUB.LAUNCH_PAD, 0x26304c, 8);
    // 終端機：靠牆的控制台＋螢幕
    for (const z of HUB.zones.filter(z => z.kind === 'term')) {
      const left = z.x < W / 2, x0 = left ? T : W - T - 54;
      g.rect(x0, z.y - 60, 54, 120).fill(hubShade(0x3a4870, left ? 0 : -0.2)).stroke({ width: 3, color: HUB_INK });
      g.rect(x0 + 10, z.y - 44, 34, 60).fill(0x060a18).stroke({ width: 2, color: HUB_INK });
      g.rect(x0 + 8, z.y + 26, 38, 12).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
    }
    this.built = true;
  },
  // 切面的多邊形台座：n 邊，每一邊一個三角形切面，亮度照切面朝向
  hexPad(g, cx, cy, r, base, n = 6) {
    const pts = Array.from({ length: n }, (_, i) => { const a = i / n * TAU + Math.PI / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - cy, l = Math.hypot(mx, my);
      g.poly([cx, cy, ax, ay, bx, by]).fill(hubShade(base, hubLit(mx / l, my / l) * 0.35));
    }
    g.poly(pts.flat()).stroke({ width: 3, color: HUB_INK });
    g.circle(cx, cy, r * 0.62).fill(hubShade(base, -0.25)).stroke({ width: 2, color: HUB_INK });
  },

  // ---------- 每幀 ----------
  draw() {
    if (!this.built) this.build();
    const g = this.gAnim, t = Hub.t, s = Hub.ship, seen = unlockSeen();
    g.clear(); GLActors.gS.clear();
    for (const z of HUB.zones) {
      const d = Math.hypot(z.x - s.x, z.y - s.y), near = Hub.near === z, col = glColor(z.color);
      if (z.kind === 'door') {
        const open = clamp((260 - d) / 160, 0, 1) * 70;  // 靠近就滑開
        for (const sg of [-1, 1]) {
          const x0 = z.x + sg * (open + 2), w = 80 - open;
          if (w > 2) { g.rect(sg < 0 ? x0 - w : x0, 4, w, HUB.WALL - 2).fill(hubShade(0x46557f, sg < 0 ? 0.05 : -0.15)).stroke({ width: 2, color: HUB_INK }); }
        }
        g.rect(z.x - 84, HUB.WALL + 2, 168, 4).fill({ color: col, alpha: 0.9 });  // 門框的燈條
        this.glow(z.x, HUB.WALL + 4, near ? 120 : 80, col, near ? 0.55 : 0.3);
        if (open > 10) this.glow(z.x, 30, 60, col, 0.25 * open / 70);  // 門後的房間透出來的光
      } else if (z.kind === 'pad') {
        const S = SHIPS[z.ship], ok = isUnlocked('ship', z.ship), mine = z.ship === Hub.shipId;
        const pc = ok ? col : 0x3a4566, pulse = 0.5 + 0.5 * Math.sin(t * 3 + z.x);
        g.circle(z.x, z.y, z.r * 0.82).stroke({ width: 3, color: pc, alpha: ok ? 0.75 : 0.5 });
        if (near) g.circle(z.x, z.y, z.r + 6 + pulse * 4).stroke({ width: 3, color: pc, alpha: 0.8 });
        this.glow(z.x, z.y, z.r * 1.3, pc, ok ? 0.18 + 0.08 * pulse : 0.08);
        if (mine) continue;  // 自己開走的那艘：停機坪空著
        const ghost = { x: z.x, y: z.y, aim: Math.PI / 2, r: 12, ship: S, parts: S.parts, moving: false, iframe: 0, dashT: 0, overdrive: 0 };
        if (ok) GLActors.ship(ghost, '');
        else this.silhouette(S, z.x, z.y);
        if (Screen.hubNew(z, seen)) this.glow(z.x, z.y, 70, 0xffd166, 0.25 + 0.2 * pulse);
      } else if (z.kind === 'launch') {
        // 盤面：一圈光環＋4 顆燈輪流亮（靠近時光環變亮）
        const P = HUB.LAUNCH_PAD, RW = HUB.RUNWAY_W;
        g.circle(z.x, z.y, P * 0.62 + 4).stroke({ width: 3, color: col, alpha: near ? 0.95 : 0.55 });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2, k = Math.max(0, Math.sin(t * 3 - i * Math.PI / 2));
          g.circle(z.x + Math.cos(a) * P * 0.8, z.y + Math.sin(a) * P * 0.8, 4).fill({ color: col, alpha: 0.3 + 0.7 * k });
        }
        this.glow(z.x, z.y, P * 1.5, col, near ? 0.35 : 0.18);
        // 跑道上往出口的箭頭（一個接一個亮）
        const ry = z.y + P - 4, ye = HUB.H - HUB.WALL, n = 3, step = (ye - ry) / n;
        for (let i = 0; i < n; i++) {
          const y = ry + 4 + i * step, hw = RW / 2 - 14, k = Math.max(0, Math.sin(t * 4 - i * 1.1));
          g.poly([z.x - hw, y, z.x, y + 10, z.x + hw, y, z.x + hw, y + 6, z.x, y + 16, z.x - hw, y + 6]).fill({ color: col, alpha: 0.25 + 0.65 * k });
        }
        this.glow(z.x, HUB.H - HUB.WALL / 2, 90, 0x4cc9f0, 0.4 + 0.1 * Math.sin(t * 2));  // 發射口的力場
        g.rect(z.x - RW / 2 - 8, HUB.H - HUB.WALL / 2 - 2, RW + 16, 4).fill({ color: 0x9fe8ff, alpha: 0.8 });
      } else if (z.kind === 'term') {
        const left = z.x < HUB.W / 2, x0 = left ? HUB.WALL : HUB.W - HUB.WALL - 54;
        g.rect(x0 + 10, z.y - 44, 34, 60).fill({ color: col, alpha: 0.35 + 0.15 * Math.sin(t * 5 + z.y) });  // 螢幕
        for (let i = 0; i < 3; i++) g.rect(x0 + 14, z.y - 38 + i * 16 + ((t * 20) % 16), 26, 3).fill({ color: col, alpha: 0.8 });  // 捲動的字
        this.glow(x0 + 27, z.y - 14, near ? 90 : 60, col, near ? 0.5 : 0.28);
      }
    }
    if (Hub.coop()) {  // 多人房間：其他人的飛船（位置同步來的），船底號碼色的光
      for (const o of Net.roomShips()) {
        const S = SHIPS[o.s], col = glColor(Game.slotColor(o.slot));
        this.glow(o.x, o.y, 34, col, 0.45);
        GLActors.ship({ x: o.x, y: o.y, aim: o.a, r: 12, ship: S, parts: S.parts, moving: o.m, iframe: 0, dashT: 0, overdrive: 0 }, '');
      }
      this.glow(s.x, s.y, 34, glColor(Game.slotColor(Net.mySlot())), 0.45);
    }
    GLActors.ship(s, '');  // 自己開的船
  },
  // 沒解鎖的飛船：黑色剪影＋一圈淡淡的灰光（看得出形狀）
  silhouette(S, x, y) {
    const A = SHIP_ART.get(S), P = GLActors.pS;
    this.glow(x, y, 40, 0x5a6a9e, 0.25);
    const sp = GLR.sprite(P, GLR.T(`s/${A.id}/0`)); sp.position.set(x, y); sp.scale.set(1 / 4); sp.rotation = Math.PI / 2; sp.tint = 0x000000;
  },
};
