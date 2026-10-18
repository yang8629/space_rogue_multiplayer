// 星環電路 多人版 · gl/gl_hub.js：WebGL 繪圖層：基地（分區的太空站：牆、各房間的地板和擺設、停機位、武器架、操作台、發射台、終端機、飛船）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   配置照 HUB（js/game/hub.js 的 hubLayout）；這裡只讀 Hub 的狀態畫出來。文字（房間名、標籤）畫在 2D 畫布（render.js 的 drawHubHud）
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

// 操作台螢幕上的圖樣：每個面板一個（軍械庫 = 槍、晶片庫 = 晶片、戰績 = 獎盃）；k = 大小
const CONSOLE_ICON = {
  armory: (g, x, y, c, a, k = 1) => {  // 槍的側面（槍口朝右）：槍托、槍身、槍管、握把
    for (const pts of [[[-19, -3], [-10, -6], [-10, 2], [-19, 6]], [[-10, -7], [8, -7], [8, 1], [-10, 1]], [[8, -6], [19, -6], [19, -2], [8, -2]], [[-5, 1], [1, 1], [-1, 10], [-7, 10]]])
      g.poly(pts.flatMap(([px, py]) => [x + px * k, y + py * k])).fill({ color: c, alpha: a * 0.7 }).stroke({ width: 2 * k, color: c, alpha: a });
  },
  chips: (g, x, y, c, a, k = 1) => {
    g.rect(x - 12 * k, y - 12 * k, 24 * k, 24 * k).stroke({ width: 3 * k, color: c, alpha: a });
    for (let i = -1; i <= 1; i++) for (const sg of [-1, 1]) { g.moveTo(x + i * 7 * k, y + sg * 12 * k).lineTo(x + i * 7 * k, y + sg * 18 * k).stroke({ width: 2 * k, color: c, alpha: a }); g.moveTo(x + sg * 12 * k, y + i * 7 * k).lineTo(x + sg * 18 * k, y + i * 7 * k).stroke({ width: 2 * k, color: c, alpha: a }); }
  },
  stats: (g, x, y, c, a, k = 1) => {
    g.poly([x - 13 * k, y - 14 * k, x + 13 * k, y - 14 * k, x + 9 * k, y + 2 * k, x - 9 * k, y + 2 * k]).fill({ color: c, alpha: a * 0.7 }).stroke({ width: 2 * k, color: c, alpha: a });
    g.rect(x - 3 * k, y + 2 * k, 6 * k, 8 * k).fill({ color: c, alpha: a }); g.rect(x - 10 * k, y + 10 * k, 20 * k, 4 * k).fill({ color: c, alpha: a });
  },
};
// 各房間的地板：底色、板子大小、花紋（grate 格柵、trace 電路紋、ring 大廳中間的紋章、carpet 觀景台中間一塊）
const HUB_FLOOR = {
  hall: { base: 0x121931, tile: 80, pattern: 'ring' },
  bay: { base: 0x10162a, tile: 60, pattern: 'grate' },
  hangar: { base: 0x10162a, tile: 60, pattern: 'grate' },
  armory: { base: 0x1a1624, tile: 80, pattern: null },
  lab: { base: 0x0e1b22, tile: 70, pattern: 'trace' },
  deck: { base: 0x141a30, tile: 80, pattern: 'carpet' },
  records: { base: 0x1b1914, tile: 80, pattern: null },
};

const GLHub = {
  init() {
    const L = GLR.L;
    this.gBase = new PIXI.Graphics(); L.hub.addChild(this.gBase);   // 不會動的：牆、地板、擺設、停機位、武器架、操作台、發射台的底座
    this.gAnim = new PIXI.Graphics(); L.hub.addChild(this.gAnim);   // 會動的：光圈、操作台螢幕、導管光點、燈、無人機、發射台的箭頭
    this.pG = GLR.pool('hubGlow', L.hub, () => new PIXI.Sprite());  // 加法發光
    this.built = false;
  },
  glow(x, y, r, col, a) { return GLActors.glowAt(this.pG, x, y, r, col, a); },

  // ---------- 不會動的部分：第一次畫的時候畫一次（配置換了把 built 設回 false） ----------
  build() {
    const g = this.gBase, WT = HUB.WT, R = HUB.rooms, rooms = Object.values(R);
    g.clear();
    // 1) 牆：每個房間外面一圈厚金屬（上、左面亮，下、右面暗）；房間之間的牆兩邊各畫一次剛好疊在一起
    for (const r of rooms) {
      const x = r.x - WT, y = r.y - WT, w = r.w + 2 * WT, h = r.h + 2 * WT, m = 0x3a4870;
      g.rect(x, y, w, h).fill(m).stroke({ width: 3, color: HUB_INK });
      g.poly([x, y, x + w, y, x + w - WT, y + WT, x + WT, y + WT]).fill(hubShade(m, 0.12));
      g.poly([x, y, x + WT, y + WT, x + WT, y + h - WT, x, y + h]).fill(hubShade(m, 0.04));
      g.poly([x, y + h, x + WT, y + h - WT, x + w - WT, y + h - WT, x + w, y + h]).fill(hubShade(m, -0.32));
      g.poly([x + w, y, x + w, y + h, x + w - WT, y + h - WT, x + w - WT, y + WT]).fill(hubShade(m, -0.22));
      for (let k = x + 30; k < x + w - 20; k += 90) g.rect(k, y + 14, 16, 7).fill(0x55658f).stroke({ width: 2, color: HUB_INK });  // 上牆的鉚釘
    }
    // 2) 地板：每間房自己的樣子；開口的地板接起兩邊（蓋掉那一段牆），兩側各一條門框
    for (const r of rooms) this.floor(g, r, HUB_FLOOR[r.id] || HUB_FLOOR.hall);
    for (const d of HUB.doors) {
      g.rect(d.x, d.y, d.w, d.h).fill(0x161d36);
      const vert = d.w > d.h;  // 上下相通的開口（寬 > 高）
      for (let k = 0; k < (vert ? d.w : d.h); k += 20) g.rect(vert ? d.x + k : d.x + 4, vert ? d.y + 4 : d.y + k, vert ? 10 : d.w - 8, vert ? d.h - 8 : 10).fill({ color: 0x2a3658, alpha: 0.5 });
      for (const sg of [0, 1]) {  // 門框（開口兩側的金屬條）
        if (vert) g.rect(sg ? d.x + d.w - 6 : d.x - 2, d.y + 28, 8, d.h - 56).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
        else g.rect(d.x + 28, sg ? d.y + d.h - 6 : d.y - 2, d.w - 56, 8).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
      }
    }
    this.decorBuild(g);
    // 3) 停機位、武器架、操作台、發射台、終端機的底座
    for (const z of HUB.zones) {
      if (z.kind === 'pad') this.hexPad(g, z.x, z.y, z.r, 0x2b3654);
      else if (z.kind === 'rack') this.rackPlate(g, z.x, z.y);
      else if (z.kind === 'console') { this.hexPad(g, z.x, z.y + 8, 40, 0x2b3654, 8); g.circle(z.x, z.y + 8, 18).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK }); }
      else if (z.kind === 'launch') { const bay = R.bay; this.launchPad(g, z, bay.y + bay.h); g.rect(z.x - HUB.RUNWAY_W / 2 - 8, bay.y + bay.h - 2, HUB.RUNWAY_W + 16, WT + 2).fill(0x02030a).stroke({ width: 3, color: HUB_INK }); }
      else if (z.kind === 'term') {
        const x0 = z.side ? R.hall.x + R.hall.w - 54 : R.hall.x;
        g.rect(x0, z.y - 60, 54, 120).fill(hubShade(0x3a4870, z.side ? -0.2 : 0)).stroke({ width: 3, color: HUB_INK });
        g.rect(x0 + 10, z.y - 44, 34, 60).fill(0x060a18).stroke({ width: 2, color: HUB_INK });
        g.rect(x0 + 8, z.y + 26, 38, 12).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
      }
    }
    this.built = true;
  },
  // 一間房的地板：板子（亮度差一點、左上亮右下暗、板縫描邊色）＋花紋
  floor(g, r, F) {
    const B = F.tile;
    for (let x = r.x; x < r.x + r.w; x += B) for (let y = r.y; y < r.y + r.h; y += B) {
      const w = Math.min(B, r.x + r.w - x), h = Math.min(B, r.y + r.h - y), base = hubShade(F.base, (seeded(x * 0.13 + y * 0.71) - 0.5) * 0.08);
      g.rect(x, y, w, h).fill(base);
      g.poly([x, y, x + w, y, x + w - 3, y + 3, x + 3, y + 3]).fill(hubShade(base, 0.1));
      g.poly([x, y + h, x + 3, y + h - 3, x + w - 3, y + h - 3, x + w, y + h]).fill(hubShade(base, -0.3));
      if (F.pattern === 'grate') for (let k = 8; k < h - 4; k += 8) g.rect(x + 6, y + k, w - 12, 2).fill({ color: HUB_INK, alpha: 0.5 });
      g.rect(x, y, w, h).stroke({ width: 1.5, color: HUB_INK });
    }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (F.pattern === 'trace') {  // 電路紋：直角轉彎的細線＋端點
      for (let i = 0; i < 14; i++) {
        const x0 = r.x + 30 + seeded(i * 3.1 + r.x) * (r.w - 60), y0 = r.y + 30 + seeded(i * 5.7 + r.y) * (r.h - 60), x1 = x0 + (seeded(i * 7.3) - 0.5) * 220, y1 = y0 + (seeded(i * 2.9) - 0.5) * 160;
        const ex = clamp(x1, r.x + 20, r.x + r.w - 20), ey = clamp(y1, r.y + 20, r.y + r.h - 20);
        g.poly([x0, y0, ex, y0, ex, ey], false).stroke({ width: 2, color: 0x2ee6a6, alpha: 0.18 });
        g.circle(ex, ey, 3).fill({ color: 0x2ee6a6, alpha: 0.3 });
      }
    }
    if (F.pattern === 'carpet') g.rect(cx - r.w * 0.3, cy - r.h * 0.18, r.w * 0.6, r.h * 0.5).fill({ color: 0x2a3060, alpha: 0.45 }).stroke({ width: 2, color: 0x4a5a86, alpha: 0.5 });
    if (F.pattern === 'ring') {  // 大廳：中間一塊圓形紋章（外圈＋放射的線＋八角內盤），出生點就在正中間
      g.circle(cx, cy, 240).stroke({ width: 3, color: 0x2a3658, alpha: 0.8 }); g.circle(cx, cy, 300).stroke({ width: 2, color: 0x2a3658, alpha: 0.5 });
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.moveTo(cx + Math.cos(a) * 245, cy + Math.sin(a) * 245).lineTo(cx + Math.cos(a) * 295, cy + Math.sin(a) * 295).stroke({ width: 2, color: 0x2a3658, alpha: 0.6 }); }
      g.circle(cx, cy, 150).fill(hubShade(F.base, 0.07)).stroke({ width: 3, color: 0x2a3658 });
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.poly([cx + Math.cos(a) * 140, cy + Math.sin(a) * 140, cx + Math.cos(a + 0.12) * 100, cy + Math.sin(a + 0.12) * 100, cx + Math.cos(a - 0.12) * 100, cy + Math.sin(a - 0.12) * 100]).fill({ color: 0x4cc9f0, alpha: 0.18 }); }  // 指向四個方向的箭頭（往各區）
      g.circle(cx, cy, 70).stroke({ width: 3, color: 0x4cc9f0, alpha: 0.35 });
    }
  },
  // 發射台＋跑道一體：八角盤面（光從左上的切面）、最下面那條邊撐開到跑道寬，接著直直往下到發射口；
  //   外面一圈金屬邊（描邊—金屬—描邊）連續繞過盤面和跑道兩側，跑道中間一條凹下去的滑軌（箭頭在 gAnim 畫）
  launchPad(g, L, yEnd) {
    const P = HUB.LAUNCH_PAD, hw = HUB.RUNWAY_W / 2, base = 0x26304c, n = 8;
    const oct = Array.from({ length: n }, (_, i) => { const a = i / n * TAU + Math.PI / n; return [L.x + Math.cos(a) * P, L.y + Math.sin(a) * P]; });
    oct[1][0] = L.x + hw; oct[2][0] = L.x - hw;  // 最下面兩個點（右下、左下）往外撐到跑道寬
    const by = oct[1][1];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = oct[i], [bx, by2] = oct[(i + 1) % n], mx = (ax + bx) / 2 - L.x, my = (ay + by2) / 2 - L.y, l = Math.hypot(mx, my);
      g.poly([L.x, L.y, ax, ay, bx, by2]).fill(hubShade(base, hubLit(mx / l, my / l) * 0.35));
    }
    g.rect(L.x - hw, by, hw * 2, yEnd - by).fill(hubShade(base, -0.18));
    g.rect(L.x - hw + 14, by, hw * 2 - 28, yEnd - by).fill(0x0a0f22);
    g.rect(L.x - hw + 14, by, 2, yEnd - by).fill(0x03050c); g.rect(L.x + hw - 16, by, 2, yEnd - by).fill(hubShade(base, 0.25));
    const rim = [[L.x - hw, yEnd], ...oct.slice(2), oct[0], oct[1], [L.x + hw, yEnd]].flat();
    g.poly(rim, false).stroke({ width: 10, color: HUB_INK, join: 'round' });
    g.poly(rim, false).stroke({ width: 5, color: 0x4a5a86, join: 'round' });
    g.poly(rim, false).stroke({ width: 1.5, color: 0x8a9ac4, alpha: 0.5, join: 'round' });
    g.circle(L.x, L.y, P * 0.62).fill(hubShade(base, -0.25)).stroke({ width: 3, color: HUB_INK });
  },
  // 武器架：一塊金屬掛板（影子、斜面、深色凹槽、上下兩對夾扣），武器平放在凹槽上
  rackPlate(g, x, y) {
    const m = 0x3a4466;
    g.rect(x - 50 + 5, y - 28 + 7, 100, 56).fill({ color: 0x000000, alpha: 0.35 });
    g.rect(x - 50, y - 28, 100, 56).fill(m);
    g.poly([x - 50, y - 28, x + 50, y - 28, x + 45, y - 23, x - 45, y - 23]).fill(hubShade(m, 0.25));
    g.poly([x - 50, y + 28, x - 45, y + 23, x + 45, y + 23, x + 50, y + 28]).fill(hubShade(m, -0.35));
    g.rect(x - 50, y - 28, 100, 56).stroke({ width: 2.5, color: HUB_INK });
    g.rect(x - 44, y - 18, 88, 36).fill(0x141a2e).stroke({ width: 2, color: HUB_INK });
    for (const cx of [x - 22, x + 18]) for (const sg of [-1, 1]) g.rect(cx, sg < 0 ? y - 21 : y + 15, 8, 6).fill(0x8a9ac4).stroke({ width: 1.5, color: HUB_INK });
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

  // ---------- 擺設：每間房自己的東西（位置都照配置算，房間變大也跟著擺） ----------
  //   算好的路線、燈、信號燈、無人機、會閃的東西記在 this.decor（每幀畫）
  decorBuild(g) {
    const R = HUB.rooms, Z = HUB.zones, WT = HUB.WT, D = this.decor = { paths: [], lamps: [], beacons: [], drones: [], leds: [] };
    const hall = R.hall, hg = R.hangar, ar = R.armory, lab = R.lab, deck = R.deck, rec = R.records, bay = R.bay;
    const L = Z.find(z => z.kind === 'launch');
    // 每間房上牆一排燈（燈座畫在牆邊，地板的光每幀畫）；信號燈放在大廳四角
    const onDoor = (x, y) => HUB.doors.some(d => x > d.x - 20 && x < d.x + d.w + 20 && y > d.y - 10 && y < d.y + d.h + 10);  // 燈不要擺在開口上
    for (const r of Object.values(R)) for (let x = r.x + 110; x < r.x + r.w - 80; x += 220) if (!onDoor(x, r.y + 4)) D.lamps.push([x, r.y + 4]);
    for (const [x, y] of D.lamps) g.rect(x - 14, y - 6, 28, 8).fill(0xfff2c4).stroke({ width: 2, color: HUB_INK });
    D.beacons = [[hall.x + 14, hall.y + 14], [hall.x + hall.w - 14, hall.y + 14], [hall.x + 14, hall.y + hall.h - 14], [hall.x + hall.w - 14, hall.y + hall.h - 14]];
    for (const [x, y] of D.beacons) g.circle(x, y, 6).fill(0x2a3350).stroke({ width: 2, color: HUB_INK });
    // 大廳：能量導管從機庫、軍械庫的開口沿大廳下緣、穿過甲板的開口接到發射台（飛船、武器的能量送去發射）；跑道出口兩側警示條紋
    const [dH, dA] = HUB.doors, yLow = hall.y + hall.h - 60, xm = HUB.BAY_DOOR / 2 - 22;
    for (const [d, sg, col] of [[dH, -1, 0x7fb4ff], [dA, 1, 0xffb347]]) {
      const yy = d.y + d.h / 2, xs = sg < 0 ? d.x + d.w : d.x, xe = L.x + sg * (HUB.LAUNCH_PAD + 4);
      D.paths.push({ pts: [[xs, yy], [xs - sg * 60, yy], [xs - sg * 60, yLow], [L.x + sg * xm, yLow], [L.x + sg * xm, L.y], [xe, L.y]], col });
    }
    // 用 moveTo／lineTo 畫折線（poly 不封口時三層線會往多邊形的一側偏，左右兩條偏的方向相反）
    const line = pts => { g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); return g; };
    for (const P of D.paths) {
      line(P.pts).stroke({ width: 10, color: HUB_INK, join: 'miter' });
      line(P.pts).stroke({ width: 6, color: 0x0a0f22, join: 'miter' });
      line(P.pts).stroke({ width: 2, color: P.col, alpha: 0.35, join: 'miter' });
      P.len = P.pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - P.pts[i][0], p[1] - P.pts[i][1]), 0);
    }
    const hw = HUB.RUNWAY_W / 2, yb = bay.y + bay.h;
    for (const sg of [-1, 1]) {
      const x0 = sg < 0 ? L.x - hw - 40 : L.x + hw + 14, w = 26, y0 = yb - 64;
      g.rect(x0, y0, w, 64).fill(0xc9961f).stroke({ width: 2, color: HUB_INK });
      for (let y = y0 + 6; y < yb - 4; y += 12) g.poly([x0, y + 6, x0 + w, y - 2, x0 + w, y + 3, x0, y + 11]).fill({ color: HUB_INK, alpha: 0.85 });
    }
    // 大廳：紋章左右兩張長椅、四個斜角的盆栽（大廳＝大家集合的地方）
    const hx0 = hall.x + hall.w / 2, hy0 = hall.y + hall.h / 2;
    for (const sg of [-1, 1]) { const bx = hx0 + sg * 220 - 11, by = hy0 - 55; g.rect(bx, by, 22, 110).fill(0x4a3a2a).stroke({ width: 2, color: HUB_INK }); g.rect(sg < 0 ? bx : bx + 17, by, 5, 110).fill(0x6a5440); }
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.plant(g, hx0 + sx * 200, hy0 + sy * 175);
    // 機庫：停機位那一圈的地板環、每個停機位外側一段弧形標線、中間的轉盤、角落的燃料槽和貨櫃
    const { cx: hx, cy: hy, ring } = hg, pads = Z.filter(z => z.kind === 'pad'), half = (TAU - HUB.RING_GAP) / Math.max(1, pads.length) / 2 - 0.06;
    g.circle(hx, hy, ring + 95).stroke({ width: 6, color: 0x2a3658, alpha: 0.7 }); g.circle(hx, hy, ring - 85).stroke({ width: 4, color: 0x2a3658, alpha: 0.7 });
    for (const z of pads) {
      const a = z.face + Math.PI;
      glArc(g, hx, hy, ring + 80, a - half * 0.7, a + half * 0.7); g.stroke({ width: 3, color: 0xb89a45, alpha: 0.55 });
    }
    this.hexPad(g, hx, hy, 92, 0x26304c, 12);  // 中間的轉盤
    D.turntable = { x: hx, y: hy };
    this.tank(g, hg.x + 50, hg.y + hg.h - 50, 30); this.tank(g, hg.x + 112, hg.y + hg.h - 40, 22);
    this.crate(g, hg.x + 18, hg.y + 104, 62, 62, 0x5a4a32); this.crate(g, hg.x + hg.w - 80, hg.y + hg.h - 76, 62, 62, 0x3f5a46); this.crate(g, hg.x + hg.w - 80, hg.y + 14, 62, 62, 0x5a4a32);
    // 軍械庫：武器架後面的展示板（貼上牆）、下面角落的彈藥箱
    const racks = Z.filter(z => z.kind === 'rack');
    if (racks.length) {
      const xs = racks.map(z => z.x), x0 = Math.min(...xs) - 70, x1 = Math.max(...xs) + 70;
      g.rect(x0, ar.y + 6, x1 - x0, 26).fill(0x4a3a2a).stroke({ width: 2, color: HUB_INK });
      for (const z of racks) g.rect(z.x - 30, ar.y + 10, 60, 18).fill(0x2a2018).stroke({ width: 2, color: HUB_INK });
    }
    this.crate(g, ar.x + 20, ar.y + ar.h - 82, 64, 64, 0x5a3a2a); this.crate(g, ar.x + 92, ar.y + ar.h - 70, 52, 52, 0x5a4a32);
    this.crate(g, ar.x + ar.w - 84, ar.y + ar.h - 82, 64, 64, 0x5a3a2a); this.barrel(g, ar.x + ar.w - 112, ar.y + ar.h - 30, 15, 0x7a3b33);
    // 晶片實驗室：上牆、左牆一排伺服器機櫃（燈每幀閃）
    for (let x = lab.x + 30; x < lab.x + lab.w - 60; x += 70) this.server(g, x, lab.y + 8, 56, 40, D);
    for (let y = lab.y + 90; y < lab.y + lab.h - 60; y += 70) this.server(g, lab.x + 8, y, 40, 56, D);
    // 觀景台：上牆一整片大窗戶（看得到星空和一顆行星）、兩張長椅、兩盆植物
    this.window(g, deck.x + 40, deck.y - WT + 6, deck.w - 80, WT + 30, true);
    for (const sg of [-1, 1]) {
      const bx = deck.x + deck.w / 2 + sg * 110 - 50, by = deck.y + deck.h * 0.62;
      g.rect(bx, by, 100, 22).fill(0x4a3a2a).stroke({ width: 2, color: HUB_INK }); g.rect(bx, by, 100, 5).fill(0x6a5440);
      this.plant(g, deck.x + (sg < 0 ? 36 : deck.w - 36), deck.y + deck.h - 40);
    }
    // 戰績室：上牆一排獎盃（旗艦的顏色），左右牆的顯示螢幕
    const bosses = Object.values(ENEMY_TYPES).filter(t => t.boss);
    bosses.forEach((t, i) => { const x = rec.x + rec.w / 2 + (i - (bosses.length - 1) / 2) * 100, y = rec.y + 30; g.rect(x - 30, rec.y + 4, 60, 44).fill(0x3a3220).stroke({ width: 2, color: HUB_INK }); D.leds.push({ x, y, col: glColor(t.color), trophy: true }); });
    for (const sg of [0, 1]) { const x = sg ? rec.x + rec.w - 14 : rec.x + 6; g.rect(x, rec.y + 120, 8, 120).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK }); D.leds.push({ x: x + 4, y: rec.y + 180, col: 0xffd166, screen: true }); }
    // 外牆的窗戶：機庫左牆、軍械庫右牆
    for (const [x, y] of [[hg.x - WT + 8, hg.y + hg.h * 0.3], [hg.x - WT + 8, hg.y + hg.h * 0.7], [ar.x + ar.w + 8, ar.y + ar.h * 0.3], [ar.x + ar.w + 8, ar.y + ar.h * 0.7]]) this.window(g, x, y - 40, WT - 16, 80, false);
    // 巡邏的維修無人機：大廳繞圈、機庫走道上下、實驗室繞圈
    D.drones = [
      { cx: hall.x + hall.w * 0.3, cy: hall.y + hall.h * 0.35, rx: 110, ry: 50, sp: 0.45, ph: 0 },
      { cx: hg.cx, cy: hg.cy, rx: 130, ry: 130, sp: 0.35, ph: 1.5 },  // 機庫：繞著轉盤
      { cx: lab.x + lab.w / 2, cy: lab.y + lab.h / 2 + 10, rx: 100, ry: 70, sp: 0.6, ph: 3 },
    ];
  },
  crate(g, x, y, w, h, col) {  // 貨櫃（從上往下看）：切面的箱子＋兩條束帶
    g.rect(x, y, w, h).fill(col);
    g.poly([x, y, x + w, y, x + w - 7, y + 7, x + 7, y + 7]).fill(hubShade(col, 0.25));
    g.poly([x, y, x + 7, y + 7, x + 7, y + h - 7, x, y + h]).fill(hubShade(col, 0.12));
    g.poly([x, y + h, x + 7, y + h - 7, x + w - 7, y + h - 7, x + w, y + h]).fill(hubShade(col, -0.35));
    g.poly([x + w, y, x + w, y + h, x + w - 7, y + h - 7, x + w - 7, y + 7]).fill(hubShade(col, -0.25));
    g.rect(x + w * 0.3, y, 4, h).fill({ color: HUB_INK, alpha: 0.45 }); g.rect(x + w * 0.66, y, 4, h).fill({ color: HUB_INK, alpha: 0.45 });
    g.rect(x, y, w, h).stroke({ width: 2.5, color: HUB_INK });
  },
  barrel(g, x, y, r, col) {  // 油桶：圓桶＋箍＋左上的反光
    g.circle(x, y, r).fill(col).stroke({ width: 2.5, color: HUB_INK });
    g.circle(x, y, r * 0.7).stroke({ width: 2, color: hubShade(col, -0.35) });
    g.circle(x - r * 0.35, y - r * 0.35, r * 0.25).fill({ color: 0xffffff, alpha: 0.25 });
  },
  tank(g, x, y, r) {  // 燃料槽：大圓槽（金屬藍灰）＋蓋子
    g.circle(x, y, r).fill(0x4a5a86).stroke({ width: 3, color: HUB_INK });
    g.circle(x, y, r * 0.78).fill(0x36446c);
    g.circle(x, y, r * 0.35).fill(0x5f6f9c).stroke({ width: 2, color: HUB_INK });
    g.circle(x - r * 0.4, y - r * 0.4, r * 0.18).fill({ color: 0xffffff, alpha: 0.25 });
  },
  server(g, x, y, w, h, D) {  // 伺服器機櫃：深色箱子＋一排燈（每幀閃）
    g.rect(x, y, w, h).fill(0x1c2440).stroke({ width: 2.5, color: HUB_INK });
    g.rect(x + 4, y + 4, w - 8, 3).fill({ color: 0xffffff, alpha: 0.12 });
    const n = 3;
    for (let i = 0; i < n; i++) D.leds.push({ x: w > h ? x + 12 + i * (w - 24) / (n - 1) : x + w / 2, y: w > h ? y + h / 2 + 4 : y + 12 + i * (h - 24) / (n - 1), col: 0x2ee6a6, k: seeded(x + y + i) * 10 });
  },
  window(g, x, y, w, h, planet) {  // 窗戶：金屬框＋星空（觀景台的大窗加一顆行星）
    g.rect(x - 4, y - 4, w + 8, h + 8).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
    g.rect(x, y, w, h).fill(0x02030a);
    for (let i = 0; i < Math.max(6, w * h / 400); i++) g.circle(x + 3 + seeded(i * 7.1 + x) * (w - 6), y + 3 + seeded(i * 3.3 + y * 1.7) * (h - 6), seeded(i + y) < 0.2 ? 1.4 : 0.8).fill({ color: 0xffffff, alpha: 0.4 + 0.6 * seeded(i * 9 + x) });
    if (planet) { const px = x + w * 0.72, py = y + h * 0.9; g.circle(px, py, h * 0.7).fill(0x3a5aa8); g.circle(px - h * 0.15, py - h * 0.15, h * 0.55).fill({ color: 0x6f8fd8, alpha: 0.5 }); }
    g.rect(x, y, w, h).fill({ color: 0x4cc9f0, alpha: 0.07 });
  },
  plant(g, x, y) {  // 盆栽：花盆＋幾片葉子
    g.circle(x, y, 14).fill(0x5a4a32).stroke({ width: 2, color: HUB_INK });
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.3; g.ellipse(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 9, 5).fill(0x3f8a56).stroke({ width: 1.5, color: HUB_INK }); }
  },

  // ---------- 每幀 ----------
  draw() {
    if (!this.built) this.build();
    const g = this.gAnim, t = Hub.t, s = Hub.ship, seen = unlockSeen(), D = this.decor;
    g.clear(); GLActors.gS.clear();
    // 導管的光點、燈照在地板上、信號燈、伺服器的燈、獎盃、無人機
    for (const P of D.paths) {  // 左右兩條同時出發（對稱）
      const d = (t * 110) % (P.len + 160);
      if (d > P.len) continue;
      let left = d;
      for (let k = 1; k < P.pts.length; k++) {
        const [ax, ay] = P.pts[k - 1], [bx, by] = P.pts[k], l = Math.hypot(bx - ax, by - ay);
        if (left <= l) { const x = ax + (bx - ax) * left / l, y = ay + (by - ay) * left / l; g.circle(x, y, 2.5).fill(0xffffff); this.glow(x, y, 16, P.col, 0.7); break; }
        left -= l;
      }
    }
    for (const [i, [x, y]] of D.lamps.entries()) this.glow(x, y + 30, 80, 0xfff2c4, 0.11 + 0.02 * Math.sin(t * 7 + i * 1.7));
    for (const [i, [x, y]] of D.beacons.entries()) { const on = Math.sin(t * 2.4 + i * Math.PI / 2) > 0.6; g.circle(x, y, 3.5).fill(on ? 0xff4d6d : 0x5a1f2e); if (on) this.glow(x, y, 26, 0xff4d6d, 0.5); }
    for (const e of D.leds) {
      if (e.trophy) { CONSOLE_ICON.stats(g, e.x, e.y, e.col, 0.95); this.glow(e.x, e.y, 30, e.col, 0.3); }
      else if (e.screen) g.rect(e.x - 3, e.y - 50, 6, 100).fill({ color: e.col, alpha: 0.25 + 0.15 * Math.sin(t * 2 + e.x) });
      else { const on = Math.sin(t * 3 + e.k) > 0; g.circle(e.x, e.y, 2.5).fill(on ? e.col : 0x1a3a30); if (on) this.glow(e.x, e.y, 10, e.col, 0.5); }
    }
    if (D.turntable) {  // 機庫中間轉盤：一圈慢慢轉的燈
      const { x, y } = D.turntable;
      for (let i = 0; i < 12; i++) { const a = t * 0.6 + i / 12 * TAU, on = (i % 3) === 0; g.circle(x + Math.cos(a) * 70, y + Math.sin(a) * 70, on ? 4 : 2.5).fill({ color: 0x7fb4ff, alpha: on ? 0.9 : 0.4 }); if (on) this.glow(x + Math.cos(a) * 70, y + Math.sin(a) * 70, 18, 0x7fb4ff, 0.4); }
    }
    for (const Rd of D.drones) {  // 無人機：影子、四支螺旋臂、機身（左上亮）、一閃一閃的燈
      const a = t * Rd.sp + Rd.ph, x = Rd.cx + Math.cos(a) * Rd.rx, y = Rd.cy + Math.sin(a) * Rd.ry, h = Math.sin(t * 3 + Rd.ph) * 2;
      g.ellipse(x + 4, y + 10, 9, 4).fill({ color: 0x000000, alpha: 0.35 });
      for (let k = 0; k < 4; k++) { const b = k * Math.PI / 2 + Math.PI / 4; g.moveTo(x, y + h).lineTo(x + Math.cos(b) * 12, y + h + Math.sin(b) * 12).stroke({ width: 2.5, color: HUB_INK }); g.circle(x + Math.cos(b) * 12, y + h + Math.sin(b) * 12, 3.5).fill({ color: 0x8a9ac4, alpha: 0.6 }); }
      g.circle(x, y + h, 7).fill(0x4a5a86).stroke({ width: 2, color: HUB_INK });
      g.poly([x - 6, y + h - 2, x, y + h - 7, x + 4, y + h - 5]).fill({ color: 0xffffff, alpha: 0.3 });
      const blink = Math.sin(t * 5 + Rd.ph) > 0;
      g.circle(x, y + h, 2.5).fill(blink ? 0x9dff6b : 0x2a4a2a); if (blink) this.glow(x, y + h, 18, 0x9dff6b, 0.5);
    }
    for (const z of HUB.zones) {
      const near = Hub.near === z, col = glColor(z.color);
      if (z.kind === 'pad') {
        const S = SHIPS[z.ship], ok = isUnlocked('ship', z.ship), mine = z.ship === Hub.shipId;
        const pc = ok ? col : 0x3a4566, pulse = 0.5 + 0.5 * Math.sin(t * 3 + z.x);
        g.circle(z.x, z.y, z.r * 0.82).stroke({ width: 3, color: pc, alpha: ok ? 0.75 : 0.5 });
        if (near) g.circle(z.x, z.y, z.r + 6 + pulse * 4).stroke({ width: 3, color: pc, alpha: 0.8 });
        this.glow(z.x, z.y, z.r * 1.3, pc, ok ? 0.18 + 0.08 * pulse : 0.08);
        if (mine || !S) continue;  // 自己開走的那艘：停機位空著
        const ghost = { x: z.x, y: z.y, aim: z.face || 0, r: 12, ship: S, parts: S.parts, moving: false, iframe: 0, dashT: 0, overdrive: 0 };  // 船頭朝機庫中間
        if (ok) GLActors.ship(ghost, '');
        else this.silhouette(S, z.x, z.y, z.face || 0);
        if (Screen.hubNew(z, seen)) this.glow(z.x, z.y, 70, 0xffd166, 0.25 + 0.2 * pulse);
      } else if (z.kind === 'rack') {
        // 武器平放在掛板上；裝備中：武器裝到船上了，架子只剩很淡的輪廓；沒解鎖：暗色剪影；靠近：掛板外框亮
        const ok = isUnlocked('weapon', z.weapon), on = z.weapon === Hub.weaponId;
        if (near) g.rect(z.x - 54, z.y - 32, 108, 64).stroke({ width: 3, color: col, alpha: 0.6 + 0.3 * Math.sin(t * 4) });
        glWeapon(g, z.weapon, z.x, z.y, 0, 1, col, on ? 'ghost' : ok ? '' : 'dark', (x, y, r, c, a) => this.glow(x, y, r, c, a));
        if (Screen.hubNew(z, seen)) this.glow(z.x, z.y, 56, 0xffd166, 0.25 + 0.2 * Math.sin(t * 3));
      } else if (z.kind === 'console') {
        // 底座中間的圓形螢幕：房間色的底光＋圖樣（靠近時變亮）
        const k = near ? 1 : 0.6;
        this.glow(z.x, z.y + 8, 50, col, 0.3 * k);
        g.circle(z.x, z.y + 8, 15).fill({ color: col, alpha: 0.18 * k });
        (CONSOLE_ICON[z.id] || CONSOLE_ICON.stats)(g, z.x, z.y + 8, col, k, 0.62);
        if (near) g.circle(z.x, z.y + 8, z.r - 16 + Math.sin(t * 3) * 2).stroke({ width: 3, color: col, alpha: 0.7 });
        if (Screen.hubNew(z, seen)) this.glow(z.x, z.y, 60, 0xffd166, 0.25 + 0.2 * Math.sin(t * 3));
      } else if (z.kind === 'launch') {
        const P = HUB.LAUNCH_PAD, RW = HUB.RUNWAY_W, ye = HUB.rooms.bay.y + HUB.rooms.bay.h, h = Hub.heat();  // h：出發動畫的蓄能（燈轉快、變亮）
        g.circle(z.x, z.y, P * 0.62 + 4).stroke({ width: 3 + 2 * h, color: h ? hubShade(col, 0.5 * h) : col, alpha: near || h ? 0.95 : 0.55 });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2, k = h ? Math.max(h * 0.6, Math.sin(t * (3 + 15 * h) - i * Math.PI / 2)) : Math.max(0, Math.sin(t * 3 - i * Math.PI / 2));
          g.circle(z.x + Math.cos(a) * P * 0.8, z.y + Math.sin(a) * P * 0.8, 4).fill({ color: col, alpha: 0.3 + 0.7 * k });
        }
        this.glow(z.x, z.y, P * (1.5 + 0.6 * h), col, (near ? 0.35 : 0.18) + 0.45 * h);
        const ry = z.y + P * Math.sin(3 * Math.PI / 8), n = 4, step = (ye - ry) / n;
        for (let i = 0; i < n; i++) {
          const y = ry + 3 + i * step, hw = RW / 2 - 20, k = Math.max(h * 0.5, Math.sin(t * (4 + 14 * h) - i * 1.1));
          g.poly([z.x - hw, y, z.x, y + 10, z.x + hw, y, z.x + hw, y + 6, z.x, y + 16, z.x - hw, y + 6]).fill({ color: col, alpha: 0.25 + 0.65 * k });
        }
        this.glow(z.x, ye + HUB.WT / 2, 90 + 50 * h, 0x4cc9f0, 0.4 + 0.1 * Math.sin(t * 2) + 0.4 * h);  // 發射口的力場
        g.rect(z.x - RW / 2 - 8, ye + HUB.WT / 2 - 2, RW + 16, 4).fill({ color: 0x9fe8ff, alpha: 0.8 });
      } else if (z.kind === 'term') {
        const x0 = z.side ? HUB.rooms.hall.x + HUB.rooms.hall.w - 54 : HUB.rooms.hall.x;
        g.rect(x0 + 10, z.y - 44, 34, 60).fill({ color: col, alpha: 0.35 + 0.15 * Math.sin(t * 5 + z.y) });  // 螢幕
        for (let i = 0; i < 3; i++) g.rect(x0 + 14, z.y - 38 + i * 16 + ((t * 20) % 16), 26, 3).fill({ color: col, alpha: 0.8 });  // 捲動的字
        this.glow(x0 + 27, z.y - 14, near ? 90 : 60, col, near ? 0.5 : 0.28);
      }
    }
    if (Hub.coop()) {  // 多人房間：其他人的飛船（位置同步來的），船底號碼色的光
      for (const o of Net.roomShips()) {
        const S = SHIPS[o.s], col = glColor(Game.slotColor(o.slot));
        this.glow(o.x, o.y, 34, col, 0.45);
        GLActors.ship({ x: o.x, y: o.y, aim: o.a, r: 12, ship: S, parts: S.parts, weaponId: o.w, moving: o.m, iframe: 0, dashT: 0, overdrive: 0 }, '');
      }
      this.glow(s.x, s.y, 34, glColor(Game.slotColor(Net.mySlot())), 0.45);
    }
    // 基地裡射出去的子彈（快的拖一條光、慢的是光球）、打到牆的火花（擴散的圈）
    for (const b of Hub.shots) {
      const c = glColor(b.col), fade = Math.min(1, b.t / b.life * 3), sp = Math.hypot(b.vx, b.vy), tail = Math.min(40, sp * 0.03);
      if (tail > 14) { g.moveTo(b.x - b.vx / sp * tail, b.y - b.vy / sp * tail).lineTo(b.x, b.y).stroke({ width: b.r * 1.6, color: c, alpha: 0.7 * fade }); g.moveTo(b.x - b.vx / sp * tail * 0.6, b.y - b.vy / sp * tail * 0.6).lineTo(b.x, b.y).stroke({ width: b.r * 0.6, color: 0xffffff, alpha: fade }); }
      else { g.circle(b.x, b.y, b.r).fill({ color: c, alpha: fade }); g.circle(b.x, b.y, b.r * 0.45).fill({ color: 0xffffff, alpha: fade }); }
      this.glow(b.x, b.y, b.r * 5, c, 0.5 * fade);
    }
    for (const k of Hub.sparks) { const c = glColor(k.col), q = 1 - k.t / 0.3; g.circle(k.x, k.y, 4 + q * 14).stroke({ width: 2, color: c, alpha: 1 - q }); this.glow(k.x, k.y, 26, c, 0.6 * (1 - q)); }
    const fk = Hub.flyK();
    if (fk > 0 && fk < 1) {  // 出發動畫衝出去：船尾拖一道能量光跡（越快越長）
      const y0 = Math.max(Hub.seq.y1, s.y - 30 - 320 * fk);
      g.moveTo(s.x, y0).lineTo(s.x, s.y - 6).stroke({ width: 12, color: 0x4cc9f0, alpha: 0.3 });
      g.moveTo(s.x, (y0 + s.y) / 2).lineTo(s.x, s.y - 6).stroke({ width: 4, color: 0xffffff, alpha: 0.85 });
      this.glow(s.x, s.y - 12, 46, 0x4cc9f0, 0.7);
    }
    GLActors.ship(s, '');  // 自己開的船（船頭的武器也在裡面畫）
  },
  // 沒解鎖的飛船：黑色剪影＋一圈淡淡的灰光（看得出形狀）
  silhouette(S, x, y, rot = 0) {
    const A = SHIP_ART.get(S), P = GLActors.pS;
    this.glow(x, y, 40, 0x5a6a9e, 0.25);
    const sp = GLR.sprite(P, GLR.T(`s/${A.id}/0`)); sp.position.set(x, y); sp.scale.set(1 / 4); sp.rotation = rot; sp.tint = 0x000000;
  },
};
