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
// 各房間的地板：底色、板子大小、花紋（grate 格柵（沒有貼圖時）、trace 電路紋）
const HUB_FLOOR = {
  hall: { base: 0x121931, tile: 80, pattern: null },
  bay: { base: 0x10162a, tile: 60, pattern: 'grate' },
  hangar: { base: 0x10162a, tile: 60, pattern: 'grate' },
  armory: { base: 0x1a1624, tile: 80, pattern: null },
  lab: { base: 0x0e1b22, tile: 70, pattern: 'trace' },
  deck: { base: 0x141a30, tile: 80, pattern: null },
  records: { base: 0x1b1914, tile: 80, pattern: null },
};

// 貼圖（assets/hub_tex.js 的 HUB_TEX：AI 生的無縫灰階貼圖，tests/perf/teximg.mjs pack 產生；設計見 docs/美術架構.md）
//   畫法：貼圖 × 原本的顏色（染色），所以形狀、切面明暗照舊，只多了質感；貼圖平均亮度 HUB_TEX_MEAN，顏色先除掉它（平均起來跟原本一樣亮）
//   一張貼圖在世界裡鋪多大：wall 牆、metal 物件（停機位、武器架、操作台、發射台、終端機、擺設）；地板照房間的板子大小 × HUB_FLOOR_TEX
const HUB_TEX_MEAN = 0.75;
// 牆的顏色：內牆（房間之間的隔間）、外牆（船殼）、外牆上的鉚釘
const HUB_WALL = { inner: 0x3e4a70, outer: 0x1f2740, rivet: 0x55658f };
// 外牆外面的裝甲裙板：厚度、四個方向的明暗（光從左上）
const HUB_SKIRT = { w: 26, shade: { up: 0.14, left: 0.06, down: -0.3, right: -0.2 } };
// 站體外面的結構件（使用者 10-21 選的外觀）：上排兩端凸角的天線、機庫左邊和軍械庫右邊的對接臂、下面兩翼的散熱板
function hubHullParts(g, H) {
  const R = HUB.rooms, WT = HUB.WT, S = HUB_SKIRT.w, M = 0x3a4466;
  for (const [r, sx] of [[R.lab, -1], [R.records, 1]]) {  // 天線：從凸角斜著伸出去，尖端一盞紅燈
    if (!r) continue;
    const x0 = sx < 0 ? r.x - WT - S * 0.5 : r.x + r.w + WT + S * 0.5, y0 = r.y - WT - S * 0.5, x1 = x0 + sx * 60, y1 = y0 - 60;
    H.hexPad(g, x0, y0, 14, M, 6);
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 7, color: HUB_INK }); g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3.5, color: 0x6a7896 });
    g.circle(x1, y1, 5).fill({ color: 0xff5d73, alpha: 1 }).stroke({ width: 2, color: HUB_INK });
  }
  for (const [r, sx] of [[R.hangar, -1], [R.armory, 1]]) {  // 對接臂：牆中間往外伸一支，末端 U 形夾具
    if (!r) continue;
    const y = r.y + r.h / 2, xw = sx < 0 ? r.x - WT - S : r.x + r.w + WT + S, x1 = xw + sx * 70;
    g.rect(Math.min(xw, x1), y - 12, 70, 24).fill(M).stroke({ width: 3, color: HUB_INK });
    g.rect(Math.min(xw, x1), y - 12, 70, 6).fill(hubShade(M, 0.15));
    for (const sy of [-1, 1]) g.rect(sx < 0 ? x1 - 22 : x1, y + sy * 20 - 6, 22, 12).fill(hubShade(M, -0.1)).stroke({ width: 2.5, color: HUB_INK });
    g.rect(sx < 0 ? x1 - 4 : x1, y - 26, 4, 52).fill(M).stroke({ width: 2, color: HUB_INK });
    g.rect(sx < 0 ? x1 - 18 : x1 + 14, y - 3, 4, 6).fill({ color: 0x4cc9f0, alpha: 1 });
  }
  for (const r of [R.hangar, R.armory]) {  // 散熱板：下牆外面一排薄板
    if (!r) continue;
    const yb = r.y + r.h + WT + S;
    for (let x = r.x + 60; x < r.x + r.w - 60; x += 22) g.rect(x, yb, 12, 34).fill(hubShade(M, -0.05)).stroke({ width: 2, color: HUB_INK });
  }
}
const HUB_TEX_SIZE = { wall: 320, metal: 256 };
const HUB_FLOOR_TEX = 8;  // 地板貼圖一張 = 8 × 8 塊板子（HUB_FLOOR 的 tile）

// 轉了角度的矩形（中心 cx, cy、寬 w、高 h、轉 a）→ poly 用的點
const hubRect = (cx, cy, w, h, a) => { const c = Math.cos(a), n = Math.sin(a), out = []; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(cx + (u * w * c - v * h * n) / 2, cy + (u * w * n + v * h * c) / 2); return out; };
const GLHub = {
  init() {
    const L = GLR.L;
    this.sky = new PIXI.Container(); L.hub.addChild(this.sky);  // 站體後面的太空：中子星（skyDraw）
    this.gSky = new PIXI.Graphics(); this.sky.addChild(this.gSky);
    this.pSky = GLR.pool('hubSky', this.sky, () => new PIXI.Sprite());
    this.gBase = new PIXI.Graphics(); L.hub.addChild(this.gBase);   // 不會動的：牆、地板、擺設、停機位、武器架、操作台、發射台的底座
    this.gAnim = new PIXI.Graphics(); L.hub.addChild(this.gAnim);   // 會動的：光圈、操作台螢幕、導管光點、燈、無人機、發射台的箭頭
    this.pG = GLR.pool('hubGlow', L.hub, () => new PIXI.Sprite());  // 加法發光
    this.built = false;
    this.loadTex();
  },
  glow(x, y, r, col, a) { return GLActors.glowAt(this.pG, x, y, r, col, a); },

  // ---------- 貼圖 ----------
  tex: {},
  loadTex() {  // 沒有 HUB_TEX（測試、還沒載入）就照原本的平塗；每張讀好就重畫一次
    const T = globalThis.HUB_TEX;
    if (!T) return;
    for (const [k, src] of Object.entries(T)) {
      const img = new Image();
      img.onload = () => {
        const s = new PIXI.ImageSource({ resource: img, addressMode: 'repeat', autoGenerateMipmaps: true });  // 重複鋪；縮小時用 mipmap（不閃）
        this.tex[k] = new PIXI.Texture({ source: s }); this.built = false;
      };
      img.src = src;
    }
  },
  // 貼圖 × 顏色的填法（世界座標對齊：相鄰的東西花紋接得起來）；size = 一張在世界裡多大；沒有這張貼圖就回傳原本的顏色
  texFill(color, key, size, ox = 0, oy = 0) {
    const T = this.tex[key];
    if (!T) return color;
    const ch = s => Math.min(255, Math.round(((color >> s) & 255) / HUB_TEX_MEAN));
    return { texture: T, color: (ch(16) << 16) | (ch(8) << 8) | ch(0), textureSpace: 'global', matrix: new PIXI.Matrix().scale(size / T.width, size / T.height).translate(ox, oy) };
  },
  // 靜態圖層用的畫筆：fill(數字顏色) 自動換成 this.texKind 那張貼圖 × 顏色；半透明（{ color, alpha }）、貼圖填法照原樣
  //   所以牆、物件、擺設的畫法不用一個一個改；texKind = null 時不換
  texPen(g) {
    const pen = new Proxy(g, {
      get: (t, k) => {
        if (k === 'fill') return st => { t.fill(typeof st === 'number' && this.texKind ? this.texFill(st, this.texKind, HUB_TEX_SIZE[this.texKind]) : st); return pen; };
        const v = t[k];
        return typeof v === 'function' ? (...a) => { const r = v.apply(t, a); return r === t ? pen : r; } : v;
      },
    });
    return pen;
  },

  // ---------- 不會動的部分：第一次畫的時候畫一次（配置換了把 built 設回 false） ----------
  padLamps: new Map(),  // 停機位的燈座位置（shipPad 算好，draw 每幀點亮）
  build() {
    const g = this.texPen(this.gBase), WT = HUB.WT, R = HUB.rooms, rooms = Object.values(R);
    g.clear();
    // 1) 牆：每間房往外擴 WT 的範圍連成一整塊（相鄰房間共用同一道牆，交界不會有接縫）
    //   內牆（兩間房中間）：比較亮、乾淨的隔間（metal 貼圖）；外牆（外面是太空）：厚重的船殼裝甲（wall 貼圖、深色、一排鉚釘）
    //   外牆外面再一圈裝甲裙板（HUB_SKIRT 厚）：站體的凸角切成 45° 斜角（外觀不要太方正）；窗戶的位置牆和裙板都挖空（看得到外面真的太空）
    const ex = r => [r.x - WT, r.y - WT, r.w + 2 * WT, r.h + 2 * WT], hull = this.hullSegs(rooms), wins = this.windows = this.hubWindows();
    const LZ = HUB.zones.find(z => z.kind === 'launch'), holes = [...wins, ...(LZ && R.bay ? [{ x: LZ.x - HUB.RUNWAY_W / 2 - 8, y: R.bay.y + R.bay.h - 2, w: HUB.RUNWAY_W + 16, h: WT + HUB_SKIRT.w + 4 }] : [])];  // 跑道出口
    const cut = (x, y, w, h) => {  // 洞要裁到這塊圖形裡面（超出圖形的洞挖不出來）
      for (const q of holes) {
        const x0 = Math.max(x, q.x), y0 = Math.max(y, q.y), x1 = Math.min(x + w, q.x + q.w), y1 = Math.min(y + h, q.y + q.h);
        if (x1 - x0 > 0.5 && y1 - y0 > 0.5) g.rect(x0, y0, x1 - x0, y1 - y0).cut();
      }
    };
    const skirts = hull.map(s => this.skirtPoly(s));
    this.texKind = 'metal';
    for (const r of rooms) { g.rect(...ex(r)).fill(HUB_WALL.inner); cut(...ex(r)); }
    this.texKind = 'wall';
    hull.forEach((s, i) => {
      g.rect(s.x, s.y, s.w, s.h).fill(HUB_WALL.outer); cut(s.x, s.y, s.w, s.h);
      const xs = skirts[i].filter((_, k) => k % 2 === 0), ys = skirts[i].filter((_, k) => k % 2);
      g.poly(skirts[i]).fill(hubShade(HUB_WALL.outer, HUB_SKIRT.shade[s.out])); cut(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (s.along === 'x') for (let k = s.x + 30; k < s.x + s.w - 20; k += 90) { if (!this.onWindow(k, s.y + s.h / 2)) g.rect(k, s.y + s.h / 2 - 3, 14, 6).fill(HUB_WALL.rivet).stroke({ width: 2, color: HUB_INK }); }
      else for (let k = s.y + 30; k < s.y + s.h - 20; k += 90) { if (!this.onWindow(s.x + s.w / 2, k)) g.rect(s.x + s.w / 2 - 3, k, 6, 14).fill(HUB_WALL.rivet).stroke({ width: 2, color: HUB_INK }); }
    });
    // 描邊（填完再描，碰到洞就跳過）：裙板的外緣＋凸角的斜邊＝站體的輪廓；牆和裙板的交界一條細線
    this.texKind = null;
    const line = (x0, y0, x1, y1, width) => {
      let segs = [[0, 1]];  // 這條線上還要畫的部分（0～1）
      if (x0 === x1 || y0 === y1) for (const q of holes) {  // 斜線只在凸角，不會碰到洞
        const hor = y0 === y1, c = hor ? y0 : x0, [q0, q1] = hor ? [q.y, q.y + q.h] : [q.x, q.x + q.w];
        if (c < q0 || c > q1) continue;
        const [a, b] = hor ? [x0, x1] : [y0, y1], [h0, h1] = (hor ? [q.x, q.x + q.w] : [q.y, q.y + q.h]).map(v => (v - a) / (b - a)).sort((m, n) => m - n);
        segs = segs.flatMap(([s0, s1]) => [[s0, Math.min(s1, h0)], [Math.max(s0, h1), s1]]).filter(([s0, s1]) => s1 - s0 > 0.001);
      }
      for (const [s0, s1] of segs) g.moveTo(x0 + (x1 - x0) * s0, y0 + (y1 - y0) * s0).lineTo(x0 + (x1 - x0) * s1, y0 + (y1 - y0) * s1).stroke({ width, color: HUB_INK });
    };
    hull.forEach((s, i) => {
      const p = skirts[i], P = k => [p[k * 2], p[k * 2 + 1]];
      if (s.c0) line(...P(0), ...P(1), 4);
      line(...P(1), ...P(2), 4);
      if (s.c1) line(...P(2), ...P(3), 4);
      const e = { up: [s.x, s.y, s.x + s.w, s.y], down: [s.x, s.y + s.h, s.x + s.w, s.y + s.h], left: [s.x, s.y, s.x, s.y + s.h], right: [s.x + s.w, s.y, s.x + s.w, s.y + s.h] }[s.out];
      line(...e, 2);
    });
    hubHullParts(g, this);
    // 牆的內緣：沿著每間房的地板一圈斜面（光從左上：朝上、朝左的面亮，朝下、朝右的面暗），四個角斜切接起來
    const BV = 7;
    for (const r of rooms) {
      const { x, y, w, h } = r, X = x + w, Y = y + h, base = HUB_WALL.inner;
      g.poly([x - BV, y - BV, X + BV, y - BV, X, y, x, y]).fill(hubShade(base, -0.35));  // 上牆朝下的面
      g.poly([x - BV, y - BV, x, y, x, Y, x - BV, Y + BV]).fill(hubShade(base, -0.2));    // 左牆朝右的面
      g.poly([x, Y, X, Y, X + BV, Y + BV, x - BV, Y + BV]).fill(hubShade(base, 0.18));    // 下牆朝上的面
      g.poly([X, y, X + BV, y - BV, X + BV, Y + BV, X, Y]).fill(hubShade(base, 0.1));     // 右牆朝左的面
    }
    // 2) 地板：每間房自己的樣子；開口的地板接起兩邊（蓋掉那一段牆），兩側各一條門框
    this.texKind = null;  // 地板用自己那張貼圖（floorTiles）
    for (const r of rooms) this.floor(g, r, HUB_FLOOR[r.id] || HUB_FLOOR.hall);
    this.texKind = 'metal';  // 之後的門框、擺設、停機位、武器架、操作台、發射台、終端機
    for (const d of HUB.doors) this.door(g, d);
    this.decorBuild(g);
    this.hallCore(g, R.hall);
    // 3) 停機位、武器架、操作台、發射台、終端機的底座
    for (const z of HUB.zones) {
      if (z.kind === 'pad') this.shipPad(g, z);
      else if (z.kind === 'rack') this.rackPlate(g, z.x, z.y);
      else if (z.kind === 'console') { this.hexPad(g, z.x, z.y + 8, 40, 0x2b3654, 8); g.circle(z.x, z.y + 8, 18).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK }); }
      else if (z.kind === 'launch') { const bay = R.bay; this.launchPad(g, z, bay.y + bay.h); }  // 跑道穿過下牆的開口在畫牆時挖穿（看得到外面的太空）
      else if (z.kind === 'term') this.wallPanel(g, z.side ? R.hall.x + R.hall.w - 54 : R.hall.x, z.y, 120, z.side);
    }
    this.built = true;
  },
  // 掛在左右牆上的面板（大廳的終端機、戰績室的顯示螢幕共用）：x0 = 面板左緣、yc = 中心、h = 高（寬固定 54）、side = 1 掛右牆（背光那面暗一點）
  wallPanel(g, x0, yc, h, side) {
    g.rect(x0, yc - h / 2, 54, h).fill(hubShade(0x3a4870, side ? -0.2 : 0)).stroke({ width: 3, color: HUB_INK });
    g.rect(x0 + 10, yc - h / 2 + 16, 34, h - 60).fill(0x060a18).stroke({ width: 2, color: HUB_INK });
    g.rect(x0 + 8, yc + h / 2 - 34, 38, 12).fill(0x55658f).stroke({ width: 2, color: HUB_INK });
  },
  // 面板的螢幕（每幀）：底光一明一暗＋往下捲的字（螢幕多高就放幾行）；gr、ga = 光暈半徑、強度
  wallPanelScreen(g, x0, yc, h, col, t, gr, ga) {
    const y0 = yc - h / 2 + 16, sh = h - 60;
    g.rect(x0 + 10, y0, 34, sh).fill({ color: col, alpha: 0.35 + 0.15 * Math.sin(t * 5 + yc) });
    for (let i = 0; i < Math.floor((sh - 12) / 16); i++) g.rect(x0 + 14, y0 + 6 + i * 16 + ((t * 20) % 16), 26, 3).fill({ color: col, alpha: 0.8 });
    this.glow(x0 + 27, y0 + sh / 2, gr, col, ga);
  },
  // 一個開口＝隔艙門：開口在牆中間收窄的斜切門框、地上分節的板子、門框上兩盞小燈（發光的用 { color, alpha }：不會被換成金屬貼圖）
  //   門的座標用 (u, v)：u 沿著開口寬（0～L）、v 穿過牆（0～T；開口兩邊各伸進房間 30，牆在 v = W0～W1）
  door(g, d) {
    const vert = d.w > d.h, L = vert ? d.w : d.h, T = vert ? d.h : d.w, W0 = 30, W1 = 30 + HUB.WT;  // vert：上下相通的開口（寬 > 高）
    const P = (u, v) => vert ? [d.x + u, d.y + v] : [d.x + v, d.y + u];
    const poly = pts => g.poly(pts.flatMap(([u, v]) => P(u, v)));
    const rect = (u, v, w, h) => { const [x, y] = P(u, v); return vert ? g.rect(x, y, w, h) : g.rect(x, y, h, w); };
    // 門檻板：只鋪在牆的厚度裡（多蓋住房間邊緣的斜面 BV），顏色是兩邊房間地板的平均（以前整塊深藍、伸進房間 30：接到棕、綠的地板像一道黑色凹槽）
    const BV = 7, at = (u, v) => { const [x, y] = P(u, v); return Object.values(HUB.rooms).find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); };
    const fa = (HUB_FLOOR[(at(L / 2, 2) || {}).id] || HUB_FLOOR.hall).base, fb = (HUB_FLOOR[(at(L / 2, T - 2) || {}).id] || HUB_FLOOR.hall).base;
    const mid = [16, 8, 0].reduce((c, s) => c | (Math.round((((fa >> s) & 255) + ((fb >> s) & 255)) / 2) << s), 0);
    rect(0, W0 - BV, L, W1 - W0 + 2 * BV).fill(hubShade(mid, 0.06));
    for (const v of [W0 - BV, W1 + BV - 2]) rect(0, v, L, 2).fill({ color: HUB_INK, alpha: 0.55 });  // 兩端的接縫
    for (const sg of [1, -1]) {
      const U = u => sg > 0 ? u : L - u;
      poly([[U(-8), W0 - 12], [U(12), W0 - 12], [U(28), W0 + 6], [U(28), W1 - 6], [U(12), W1 + 12], [U(-8), W1 + 12]]).fill(0x3a4466).stroke({ width: 3, color: HUB_INK });
      poly([[U(12), W0 - 12], [U(28), W0 + 6], [U(22), W0 + 8], [U(8), W0 - 6]]).fill(hubShade(0x3a4466, 0.18));  // 斜切面（朝上的亮）
      rect(sg > 0 ? 8 : L - 14, (W0 + W1) / 2 - 3, 6, 6).fill({ color: 0x4cc9f0, alpha: 1 });
    }
  },
  // 大廳中間的能量核心：四條導管接到四根導航燈柱（導管停在燈柱底座前面）
  hallCore(g, r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    for (const [px, py] of this.decor.pylons) {
      const x = cx + (px - cx) * 0.86, y = cy + (py - cy) * 0.86;
      g.moveTo(cx, cy).lineTo(x, y).stroke({ width: 16, color: HUB_INK }); g.moveTo(cx, cy).lineTo(x, y).stroke({ width: 11, color: 0x3a4466 });
      g.moveTo(cx, cy).lineTo(x, y).stroke({ width: 3, color: 0x4cc9f0, alpha: 0.7 });
    }
    this.hexPad(g, cx, cy, 46, 0x2a3454, 6);
    g.circle(cx, cy, 18).fill({ color: 0x0a0f22, alpha: 1 }).stroke({ width: 2, color: HUB_INK }); g.circle(cx, cy, 11).fill({ color: 0x4cc9f0, alpha: 1 });
  },
  // 外牆：每間房四邊的牆裡，「再往外一個牆厚」是太空的那幾段（往外還有別間房的牆＝內牆）
  //   { x, y, w, h, along 沿著哪個軸, out 朝外的方向（up／down／left／right）, c0／c1 開頭／結尾是不是站體的凸角（沿著牆再過去也是太空） }
  //   以前用「跟別間房的牆重疊」判斷內牆：兩間房之間的隔間牆通到外牆的那一小段被算成內牆，外面的裙板斷一個缺口（10-21 使用者看到透出太空）
  hullSegs(rooms) {
    const WT = HUB.WT, out = [], ex = r => [r.x - WT, r.y - WT, r.x + r.w + WT, r.y + r.h + WT];
    const covered = (r, X0, Y0, X1, Y1) => rooms.some(o => { if (o === r) return false; const [a, b, c, d] = ex(o); return Math.min(X1, c) - Math.max(X0, a) >= 1 && Math.min(Y1, d) - Math.max(Y0, b) >= 1; });
    for (const r of rooms) {
      const [x0, y0, x1, y1] = ex(r);
      // 四邊的牆：[沿著的軸, 從, 到, 厚度方向的從, 到, 朝外, 往外那一條（厚度方向的從, 到）]
      const sides = [['x', x0, x1, y0, r.y, 'up', y0 - WT, y0], ['x', x0, x1, r.y + r.h, y1, 'down', y1, y1 + WT], ['y', y0, y1, x0, r.x, 'left', x0 - WT, x0], ['y', y0, y1, r.x + r.w, x1, 'right', x1, x1 + WT]];
      const box = (ax, s0, s1, t0, t1) => ax === 'x' ? [s0, t0, s1, t1] : [t0, s0, t1, s1];  // (沿著, 厚度) → [X0, Y0, X1, Y1]
      for (const [ax, a0, a1, t0, t1, dir, o0, o1] of sides) {
        let segs = [[a0, a1]];
        for (const o of rooms) {
          if (o === r) continue;
          const [ox0, oy0, ox1, oy1] = ex(o), [b0, b1, c0, c1] = ax === 'x' ? [ox0, ox1, oy0, oy1] : [oy0, oy1, ox0, ox1];
          if (Math.min(o1, c1) - Math.max(o0, c0) < 1) continue;  // 往外那一條沒碰到這間：這段外面不是它
          segs = segs.flatMap(([s0, s1]) => [[s0, Math.min(s1, b0)], [Math.max(s0, b1), s1]]).filter(([s0, s1]) => s1 - s0 > 1);
        }
        for (const [s0, s1] of segs) out.push({ ...(ax === 'x' ? { x: s0, y: t0, w: s1 - s0, h: t1 - t0 } : { x: t0, y: s0, w: t1 - t0, h: s1 - s0 }), along: ax, out: dir,
          c0: !covered(r, ...box(ax, s0 - WT, s0, t0, t1)), c1: !covered(r, ...box(ax, s1, s1 + WT, t0, t1)) });  // 沿著牆再過去還接著別間房的牆：不是凸角
      }
    }
    return out;
  },
  // 一段外牆外面的裙板（poly 的點）：凸角那一端斜切 45°（兩邊的裙板在斜線上接起來）
  skirtPoly(s) {
    const S = HUB_SKIRT.w, { x, y, w, h, c0, c1 } = s;
    switch (s.out) {
      case 'up': return [c0 ? x - S : x, y, x, y - S, x + w, y - S, c1 ? x + w + S : x + w, y];
      case 'down': return [c0 ? x - S : x, y + h, x, y + h + S, x + w, y + h + S, c1 ? x + w + S : x + w, y + h];
      case 'left': return [x, c0 ? y - S : y, x - S, y, x - S, y + h, x, c1 ? y + h + S : y + h];
      default: return [x + w, c0 ? y - S : y, x + w + S, y, x + w + S, y + h, x + w, c1 ? y + h + S : y + h];
    }
  },
  // 窗戶（挖穿外牆和裙板的洞）：觀景台上牆一整片大窗、機庫左牆和軍械庫右牆各兩扇；{ x, y, w, h, out 朝外 }
  hubWindows() {
    const R = HUB.rooms, WT = HUB.WT, S = HUB_SKIRT.w, deck = R.deck, hg = R.hangar, ar = R.armory, out = [];
    if (deck) out.push({ x: deck.x + 40, y: deck.y - WT - S + 8, w: deck.w - 80, h: WT + S - 16, out: 'up' });
    for (const k of [0.3, 0.7]) {
      if (hg) out.push({ x: hg.x - WT - S + 8, y: hg.y + hg.h * k - 40, w: WT + S - 16, h: 80, out: 'left' });
      if (ar) out.push({ x: ar.x + ar.w + 8, y: ar.y + ar.h * k - 40, w: WT + S - 16, h: 80, out: 'right' });
    }
    return out;
  },
  onWindow(x, y, pad = 12) { return (this.windows || []).some(q => x > q.x - pad && x < q.x + q.w + pad && y > q.y - pad && y < q.y + q.h + pad); },
  // 一間房的地板：板子＋花紋（分開：換成貼圖的地板只換板子，花紋照畫在上面）
  floor(g, r, F) { this.floorTiles(g, r, F); this.floorPattern(g, r, F); },
  // 板子：亮度差一點、左上亮右下暗、板縫描邊色
  floorTiles(g, r, F) {
    const B = F.tile, T = 'floor_' + r.id;
    if (this.tex[T]) { g.rect(r.x, r.y, r.w, r.h).fill(this.texFill(F.base, T, B * HUB_FLOOR_TEX, r.x, r.y)); return; }  // 貼圖從房間左上角開始鋪
    for (let x = r.x; x < r.x + r.w; x += B) for (let y = r.y; y < r.y + r.h; y += B) {
      const w = Math.min(B, r.x + r.w - x), h = Math.min(B, r.y + r.h - y), base = hubShade(F.base, (seeded(x * 0.13 + y * 0.71) - 0.5) * 0.08);
      g.rect(x, y, w, h).fill(base);
      g.poly([x, y, x + w, y, x + w - 3, y + 3, x + 3, y + 3]).fill(hubShade(base, 0.1));
      g.poly([x, y + h, x + 3, y + h - 3, x + w - 3, y + h - 3, x + w, y + h]).fill(hubShade(base, -0.3));
      if (F.pattern === 'grate') for (let k = 8; k < h - 4; k += 8) g.rect(x + 6, y + k, w - 12, 2).fill({ color: HUB_INK, alpha: 0.5 });
      g.rect(x, y, w, h).stroke({ width: 1.5, color: HUB_INK });
    }
  },
  // 花紋：電路紋（晶片實驗室）
  floorPattern(g, r, F) {
    if (F.pattern === 'trace') {  // 電路紋：直角轉彎的細線＋端點
      for (let i = 0; i < 14; i++) {
        const x0 = r.x + 30 + seeded(i * 3.1 + r.x) * (r.w - 60), y0 = r.y + 30 + seeded(i * 5.7 + r.y) * (r.h - 60), x1 = x0 + (seeded(i * 7.3) - 0.5) * 220, y1 = y0 + (seeded(i * 2.9) - 0.5) * 160;
        const ex = clamp(x1, r.x + 20, r.x + r.w - 20), ey = clamp(y1, r.y + 20, r.y + r.h - 20);
        g.poly([x0, y0, ex, y0, ex, ey], false).stroke({ width: 2, color: 0x2ee6a6, alpha: 0.18 });
        g.circle(ex, ey, 3).fill({ color: 0x2ee6a6, alpha: 0.3 });
      }
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
  // 機庫的停機位：跟中間的轉盤同一套——深色切面台座、中間凹下去一圈、3 個嵌在切面上的燈座（燈在 draw 照船的顏色亮）
  shipPad(g, z) {
    this.hexPad(g, z.x, z.y, z.r, 0x1a2238);
    const lamps = [];
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + Math.PI / 6, R = z.r * 0.8, x = z.x + Math.cos(a) * R, y = z.y + Math.sin(a) * R;  // 隔一個切面放一個
      g.poly(hubRect(x, y, 18, 9, a + Math.PI / 2)).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK });
      g.poly(hubRect(x - Math.cos(a), y - Math.sin(a), 14, 5, a + Math.PI / 2)).fill(0x3a4466);
      g.poly(hubRect(x, y, 11, 3, a + Math.PI / 2)).fill(0x141c34);
      lamps.push({ x, y, a: a + Math.PI / 2 });
    }
    this.padLamps.set(z.id, lamps);
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
    // 每間房上牆一排燈（燈座裝在牆的內緣上，地板的光每幀畫）：照牆寬平均排、左右對稱；碰到門口、窗戶的那盞連同對稱的那盞一起拿掉
    //   上牆放不下（門、窗、獎盃）的：燈改到左右牆；信號燈裝在大廳四個角的牆角（不佔地板、不碰門）
    //   燈：[x, y, 光往哪照（0 下、1 右、-1 左）]
    // 戰績室左右牆下段的顯示螢幕（跟大廳終端機同一種掛牆面板；下面畫，燈要避開）：放在左牆門口（往觀景台）和地板下緣之間，右牆對稱
    const py0 = rec.y + rec.h / 2 + HUB.DOOR_W / 2 + 10, py1 = rec.y + rec.h - 6, ph = Math.min(104, py1 - py0);
    const panels = [0, 1].map(side => ({ x0: side ? rec.x + rec.w - 54 : rec.x, yc: (py0 + py1) / 2, h: ph, side, wall: side ? rec.x + rec.w : rec.x }));
    const onDoor = (x, y) => HUB.doors.some(d => x > d.x - 24 && x < d.x + d.w + 24 && y > d.y - 12 && y < d.y + d.h + 12);
    const side = [];
    for (const r of Object.values(R)) {
      const n = Math.max(1, Math.round(r.w / 220)), xs = Array.from({ length: n }, (_, i) => r.x + r.w * (i + 0.5) / n), y = r.y - 3;
      const bad = xs.map(x => onDoor(x, y) || this.onWindow(x, y, 20)), top = r.id === 'records' ? [] : xs.filter((x, i) => !bad[i] && !bad[n - 1 - i]);
      if (top.length) for (const x of top) D.lamps.push([x, y, 0]);
      else if (r.id !== 'bay') side.push(r);  // 發射甲板太小，不放
    }
    // 左右牆的燈：照上段 → 下段 → 中間挑兩邊都不碰門、終端機、螢幕的高度；能挑的高度少的房間先挑
    //   隔間牆另一面已經有燈的高度不用（觀景台、戰績室的燈背靠背裝在同一道牆上，看起來像一對）
    const walls = r => [r.x - 3, r.x + r.w + 3];
    const free = (r, y) => walls(r).every(x => !onDoor(x, y) && !Z.some(z => z.kind === 'term' && Math.abs(z.y - y) < 90 && Math.abs(z.x - x) < 90)
      && !panels.some(s => Math.abs(s.wall - x) < 30 && Math.abs(s.yc - y) < s.h / 2 + 20));
    const heights = r => [r.y + 40, r.y + r.h - 60, r.y + r.h / 2].filter(y => free(r, y));
    for (const r of side.sort((a, b) => heights(a).length - heights(b).length)) {
      const sy = heights(r).find(y => walls(r).every(x => !D.lamps.some(([lx, ly]) => Math.abs(lx - x) < WT + 20 && Math.abs(ly - y) < 60)));
      if (sy != null) walls(r).forEach((x, i) => D.lamps.push([x, sy, i ? -1 : 1]));
    }
    for (const [x, y, sd] of D.lamps) (sd ? g.rect(x - 4, y - 14, 8, 28) : g.rect(x - 14, y - 4, 28, 8)).fill(0xfff2c4).stroke({ width: 2, color: HUB_INK });
    const bw = WT / 2;
    D.beacons = [[hall.x - bw, hall.y - bw], [hall.x + hall.w + bw, hall.y - bw], [hall.x - bw, hall.y + hall.h + bw], [hall.x + hall.w + bw, hall.y + hall.h + bw]];
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
    // 大廳：四個斜角的導航燈柱（底座在這裡畫，燈每幀亮）；玩家是飛船，不擺人用的椅子、盆栽
    const hx0 = hall.x + hall.w / 2, hy0 = hall.y + hall.h / 2;
    D.pylons = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [hx0 + sx * 200, hy0 + sy * 175]);
    for (const [x, y] of D.pylons) { this.hexPad(g, x, y, 17, 0x3a4466); g.circle(x, y, 6).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK }); }
    // 機庫：中間的轉盤、角落的燃料槽和貨櫃（停機位那一圈不畫地板環和弧形標線：鋪了金屬地板後平的細線很突兀，10-21 使用者）
    const { cx: hx, cy: hy } = hg;
    this.hexPad(g, hx, hy, 92, 0x1a2238, 12);  // 中間的轉盤（顏色貼近地板：10-20 使用者說太亮、跟地板配不起來）
    // 盤面：6 個嵌在切面上的燈座（深色外殼、金屬邊框、一條燈槽，沿著盤的切線擺；燈在 draw 每幀亮）、中間一圈溝槽（燈帶）＋6 道接縫、正中一個小台座
    //   燈不轉、不是光點：10-20 使用者說轉的燈、光點都突兀，要細節一點
    D.ttLamps = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, x = hx + Math.cos(a) * 75, y = hy + Math.sin(a) * 75;
      g.poly(hubRect(x, y, 26, 11, a + Math.PI / 2)).fill(0x0a0f22).stroke({ width: 2, color: HUB_INK });  // 外殼
      g.poly(hubRect(x - Math.cos(a), y - Math.sin(a), 22, 7, a + Math.PI / 2)).fill(0x3a4466);  // 金屬邊框（左上光：外殼裡面的斜面）
      g.poly(hubRect(x, y, 18, 3.5, a + Math.PI / 2)).fill(0x141c34);  // 燈槽（沒亮的時候）
      D.ttLamps.push({ x, y, a: a + Math.PI / 2, ph: i * 0.9 });
    }
    g.circle(hx, hy, 34).stroke({ width: 2, color: HUB_INK, alpha: 0.8 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.moveTo(hx + Math.cos(a) * 34, hy + Math.sin(a) * 34).lineTo(hx + Math.cos(a) * 57, hy + Math.sin(a) * 57).stroke({ width: 1.5, color: HUB_INK, alpha: 0.6 }); }
    this.hexPad(g, hx, hy, 16, 0x2a3454);
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
    for (const T of HUB.targets) this.hexPad(g, T.x, T.y, T.r + 12, 0x3a4466);  // 靶場：標靶機的切面底座；標靶機本身是敵人（dummy），跟戰鬥一樣由 GLActors.enemies 畫（以前手畫在底座上不動：被鉤爪拉走時畫面沒動，10-22）
    this.crate(g, ar.x + 20, ar.y + ar.h - 82, 64, 64, 0x5a3a2a); this.crate(g, ar.x + 92, ar.y + ar.h - 70, 52, 52, 0x5a4a32);
    this.crate(g, ar.x + ar.w - 84, ar.y + ar.h - 82, 64, 64, 0x5a3a2a); this.barrel(g, ar.x + ar.w - 112, ar.y + ar.h - 30, 15, 0x7a3b33);
    // 晶片實驗室：上牆、左牆一排伺服器機櫃（燈每幀閃）
    for (let x = lab.x + 30; x < lab.x + lab.w - 60; x += 70) this.server(g, x, lab.y + 8, 56, 40, D);
    for (let y = lab.y + 90; y < lab.y + lab.h - 60; y += 70) this.server(g, lab.x + 8, y, 40, 56, D);
    // 窗戶的玻璃（洞在畫牆的時候挖好了：透出外面真的太空；觀景台外面那顆行星在 skyDraw）
    for (const q of this.windows) this.window(g, q);
    // 觀景台：兩個面向窗戶的停泊台（跟機庫停機位同一套的切面台座）
    for (const sg of [-1, 1]) {
      const bx = deck.x + deck.w / 2 + sg * 110, by = deck.y + deck.h * 0.5;
      this.hexPad(g, bx, by, 48, 0x1a2238, 6);
      this.hexPad(g, bx, by, 26, 0x2a3454, 6);
    }
    // 戰績室：上牆一排獎盃（旗艦的顏色），左右牆下段的顯示螢幕
    const bosses = Object.values(ENEMY_TYPES).filter(t => t.boss);
    const step = Math.min(100, (rec.w - 40) / bosses.length), pw = Math.min(60, step - 14);  // 旗艦多了就排密一點，整排留在房間裡（5 隻時 100 一個會超出牆）
    bosses.forEach((t, i) => { const x = rec.x + rec.w / 2 + (i - (bosses.length - 1) / 2) * step, y = rec.y + 30; g.rect(x - pw / 2, rec.y + 4, pw, 44).fill(0x3a3220).stroke({ width: 2, color: HUB_INK }); D.leds.push({ x, y, col: glColor(t.color), trophy: true }); });
    for (const s of panels) { this.wallPanel(g, s.x0, s.yc, s.h, s.side); D.leds.push({ ...s, col: 0xffd166, panel: true }); }  // 位置在上面燈那段算
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
  window(g, q) {  // 窗戶的玻璃：淡藍的一層、斜的反光、窗櫺（每 110 一根）、一圈金屬窗框
    const { x, y, w, h } = q, wide = w > h, L = wide ? w : h, D = wide ? h : w;
    g.rect(x, y, w, h).fill({ color: 0x8fd8ff, alpha: 0.07 });
    for (let k = 30; k + 18 + D * 0.6 < L - 10; k += 150) for (const [o, ww, al] of [[0, 16, 0.06], [22, 5, 0.1]]) {  // 反光：一寬一細兩道斜線
      const u = k + o, pts = [[u, D], [u + ww, D], [u + ww + D * 0.6, 0], [u + D * 0.6, 0]];
      g.poly(pts.flatMap(([a, b]) => wide ? [x + a, y + b] : [x + b, y + a])).fill({ color: 0xffffff, alpha: al });
    }
    for (let k = 110; k < L - 40; k += 110) (wide ? g.rect(x + k - 3, y, 6, h) : g.rect(x, y + k - 3, w, 6)).fill(0x55658f).stroke({ width: 1.5, color: HUB_INK });
    g.rect(x - 3, y - 3, w + 6, h + 6).stroke({ width: 5, color: 0x55658f }); g.rect(x - 6, y - 6, w + 12, h + 12).stroke({ width: 2, color: HUB_INK });
  },

  // ---------- 每幀 ----------
  draw() {
    if (!this.built) this.build();
    const g = this.gAnim, t = Hub.t, s = Hub.ship, seen = unlockSeen(), D = this.decor;
    g.clear();
    this.skyDraw(t);
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
    for (const [i, [x, y, sd]] of D.lamps.entries()) this.glow(x + sd * 30, y + (sd ? 0 : 30), 80, 0xfff2c4, 0.11 + 0.02 * Math.sin(t * 7 + i * 1.7));
    if (D.turntable) {  // 機庫轉盤：燈座的燈槽慢慢亮暗（每個錯開一點，不轉），光往盤面灑一點；中間的溝槽是一圈淡淡的燈帶
      const { x: tx, y: ty } = D.turntable;
      for (const L of D.ttLamps) {
        const k = 0.55 + 0.35 * Math.sin(t * 1.4 + L.ph);
        g.poly(hubRect(L.x, L.y, 18, 3.5, L.a)).fill({ color: 0x9fd4ff, alpha: 0.35 + 0.6 * k });
        g.poly(hubRect(L.x, L.y, 10, 1.5, L.a)).fill({ color: 0xffffff, alpha: 0.5 * k });
        this.glow(L.x, L.y, 22, 0x7fb4ff, 0.3 * k);
      }
      const rk = 0.5 + 0.15 * Math.sin(t * 1.4);  // 溝槽裡的燈帶：畫在深色溝槽線的內側（疊在上面會被蓋住）
      g.circle(tx, ty, 30).stroke({ width: 2.5, color: 0x7fb4ff, alpha: rk });
      g.circle(tx, ty, 30).stroke({ width: 1, color: 0xffffff, alpha: 0.35 * rk });
      this.glow(tx, ty, 46, 0x7fb4ff, 0.18 * rk);
    }
    for (const [i, [x, y]] of D.pylons.entries()) { const k = 0.6 + 0.4 * Math.sin(t * 1.6 + i * Math.PI / 2); g.circle(x, y, 4).fill({ color: 0x9fe8ff, alpha: k }); this.glow(x, y, 34, 0x4cc9f0, 0.35 * k); }  // 大廳的導航燈柱：慢慢一明一暗
    for (const [i, [x, y]] of D.beacons.entries()) { const on = Math.sin(t * 2.4 + i * Math.PI / 2) > 0.6; g.circle(x, y, 3.5).fill(on ? 0xff4d6d : 0x5a1f2e); if (on) this.glow(x, y, 26, 0xff4d6d, 0.5); }
    for (const e of D.leds) {
      if (e.trophy) { CONSOLE_ICON.stats(g, e.x, e.y, e.col, 0.95); this.glow(e.x, e.y, 30, e.col, 0.3); }
      else if (e.panel) this.wallPanelScreen(g, e.x0, e.yc, e.h, e.col, t, 50, 0.22);
      else { const on = Math.sin(t * 3 + e.k) > 0; g.circle(e.x, e.y, 2.5).fill(on ? e.col : 0x1a3a30); if (on) this.glow(e.x, e.y, 10, e.col, 0.5); }
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
        const pc = ok ? col : 0x3a4566, pulse = 0.5 + 0.5 * Math.sin(t * 3 + z.x), k = ok ? (near ? 0.75 + 0.25 * pulse : 0.6 + 0.2 * Math.sin(t * 1.4 + z.x)) : 0.15;
        for (const L of this.padLamps.get(z.id) || []) {  // 燈座：船的顏色（沒解鎖的暗暗的）；靠近時一閃一閃
          g.poly(hubRect(L.x, L.y, 11, 3, L.a)).fill({ color: pc, alpha: 0.35 + 0.65 * k });
          if (ok) { g.poly(hubRect(L.x, L.y, 6, 1.2, L.a)).fill({ color: 0xffffff, alpha: 0.5 * k }); this.glow(L.x, L.y, 18, pc, 0.3 * k); }
        }
        g.circle(z.x, z.y, z.r * 0.62 - 3).stroke({ width: 2.5, color: pc, alpha: ok ? 0.55 + 0.15 * Math.sin(t * 1.4 + z.x) : 0.2 });  // 中間凹槽裡的燈帶：畫在凹槽邊線的內側（疊在上面會被蓋住）
        if (near) g.circle(z.x, z.y, z.r + 6 + pulse * 4).stroke({ width: 3, color: pc, alpha: 0.8 });
        this.glow(z.x, z.y, z.r * 1.2, pc, ok ? 0.1 + 0.05 * pulse : 0.04);
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
        this.wallPanelScreen(g, z.side ? HUB.rooms.hall.x + HUB.rooms.hall.w - 54 : HUB.rooms.hall.x, z.y, 120, col, t, near ? 90 : 60, near ? 0.5 : 0.28);
      }
    }
    if (Hub.coop()) {  // 多人房間：船底號碼色的光；出發動畫中其他人的船照同一套動畫畫（Hub.mateLaunch，不用同步來的位置），平常是 Game.mates（GLActors.ships 畫）
      const ML = Hub.mateLaunch();
      for (const o of ML || []) {
        const S = SHIPS[o.s];
        this.launchTrail(g, o);
        this.glow(o.x, o.y, 34, glColor(Game.slotColor(o.slot)), 0.45);
        GLActors.ship({ x: o.x, y: o.y, aim: o.aim, r: 12, ship: S, parts: S.parts, weaponId: o.w, moving: o.moving, iframe: 0, dashT: o.dashT, overdrive: 0 }, '');
      }
      for (const p of Game.allShips()) this.glow(p.x, p.y, 34, glColor(Game.slotColor(p === s ? Net.mySlot() : p.slot)), 0.45);
    }
    for (const q of Game.portals) GLWorld.portal(g, q.ax, q.ay, q.bx, q.by, q.color, Math.min(1, q.t * 2), t);  // 星門（星門號衝刺）
    this.launchTrail(g, s);  // 自己的船由 GLActors.ships 畫（跟戰鬥一樣）
  },
  // 出發動畫衝出去：船尾拖一道能量光跡（越快越長）；o = 自己的船或其他人（mateLaunch）
  launchTrail(g, o) {
    const fk = Hub.flyK();
    if (!(fk > 0 && fk < 1)) return;
    const y0 = Math.max(Hub.seq.y1, o.y - 30 - 320 * fk);
    g.moveTo(o.x, y0).lineTo(o.x, o.y - 6).stroke({ width: 12, color: 0x4cc9f0, alpha: 0.3 });
    g.moveTo(o.x, (y0 + o.y) / 2).lineTo(o.x, o.y - 6).stroke({ width: 4, color: 0xffffff, alpha: 0.85 });
    this.glow(o.x, o.y - 12, 46, 0x4cc9f0, 0.7);
  },
  // 背景的中子星（站體右上方的太空）：很亮的白核、一圈傾斜的吸積盤（暖色，上面幾個亮點繞著轉）、兩道慢慢掃過的脈衝光束、大片藍色光暈
  //   放在戰績室右邊、軍械庫上面那片空的太空；視差 SKY_PAR：鏡頭移動時它少動一點（看起來在站體後面、比較遠）；被站體擋住的部分在站體後面
  SKY_PAR: 0.25,
  skyDraw(t) {
    const g = this.gSky, P = this.pSky, ar = HUB.rooms.armory, rec = HUB.rooms.records;
    g.clear();
    const bx = (rec.x + rec.w + ar.x + ar.w) / 2 + 40, by = (rec.y + ar.y) / 2;  // 鏡頭正對這一點時它就在這裡；鏡頭離開時只跟著移動 SKY_PAR
    const x = bx + (Hub.cam.x - (bx - VW / 2 / Hub.k)) * this.SKY_PAR, y = by + (Hub.cam.y - (by - VH / 2 / Hub.k)) * this.SKY_PAR;
    GLActors.glowAt(P, x, y, 420, 0x3a5cff, 0.16);  // 大片光暈
    // 脈衝光束：兩道相反方向的細長光錐，每 18 秒轉一圈
    const b = t * TAU / 18;
    for (const s of [0, Math.PI]) {
      const a = b + s, L = 1100;
      for (const [w, al] of [[0.07, 0.07], [0.025, 0.16]]) {
        g.poly([x, y, x + Math.cos(a - w) * L, y + Math.sin(a - w) * L, x + Math.cos(a + w) * L, y + Math.sin(a + w) * L]).fill({ color: 0x9fe8ff, alpha: al });
      }
    }
    // 吸積盤：傾斜的橢圓，外暖內熱（三圈）；亮點沿著盤繞
    const tilt = -0.38, ell = (rx, ry) => { const pts = []; for (let i = 0; i < 64; i++) { const u = i / 64 * TAU, ex = Math.cos(u) * rx, ey = Math.sin(u) * ry; pts.push(x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y + ex * Math.sin(tilt) + ey * Math.cos(tilt)); } return pts; };
    for (const [rx, w, c, al] of [[118, 10, 0xc77dff, 0.18], [96, 7, 0xff9f6b, 0.32], [76, 4, 0xffd9a0, 0.5]]) g.poly(ell(rx, rx * 0.3)).stroke({ width: w, color: c, alpha: al });
    for (let i = 0; i < 4; i++) {
      const u = t * (0.9 - i * 0.12) + i * 1.7, rx = 80 + i * 12, ex = Math.cos(u) * rx, ey = Math.sin(u) * rx * 0.3;
      const px = x + ex * Math.cos(tilt) - ey * Math.sin(tilt), py = y + ex * Math.sin(tilt) + ey * Math.cos(tilt);
      g.circle(px, py, 2).fill({ color: 0xffffff, alpha: 0.8 }); GLActors.glowAt(P, px, py, 16, 0xffb36b, 0.5);
    }
    // 核心：白色小點＋兩層藍白光
    GLActors.glowAt(P, x, y, 110, 0x7fd4ff, 0.55 + 0.1 * Math.sin(t * 9));
    GLActors.glowAt(P, x, y, 36, 0xeaf8ff, 1);
    g.circle(x, y, 7).fill(0xffffff);
    // 觀景台外面的行星（從觀景台的大窗看得到）：同樣的視差；藍色的球、左上亮面、右下陰影、一圈大氣光
    const dk = HUB.rooms.deck;
    if (dk) {
      const ax = dk.x + dk.w * 0.68, ay = dk.y - 70, R = 160;  // 中心在大窗後面一點：一半被站體擋住
      const qx = ax + (Hub.cam.x - (ax - VW / 2 / Hub.k)) * this.SKY_PAR, qy = ay + (Hub.cam.y - (ay - VH / 2 / Hub.k)) * this.SKY_PAR;
      GLActors.glowAt(P, qx, qy, R * 1.5, 0x4a7cff, 0.22);
      g.circle(qx, qy, R).fill(0x23407a);
      g.circle(qx - R * 0.22, qy - R * 0.22, R * 0.78).fill({ color: 0x5f8fe0, alpha: 0.35 });
      for (const [dy, a] of [[-0.35, 0.12], [0.05, 0.1], [0.4, 0.08]]) g.ellipse(qx, qy + dy * R, R * Math.sqrt(1 - dy * dy) * 0.98, R * 0.07).fill({ color: 0xbfd8ff, alpha: a });  // 雲帶
      g.circle(qx + R * 0.3, qy + R * 0.3, R * 0.95).fill({ color: 0x050a18, alpha: 0.45 });  // 背光的那半邊
    }
  },
  // 沒解鎖的飛船：黑色剪影＋一圈淡淡的灰光（看得出形狀）
  silhouette(S, x, y, rot = 0) {
    const A = SHIP_ART.get(S), P = GLActors.pS;
    this.glow(x, y, 40, 0x5a6a9e, 0.25);
    const sp = GLR.sprite(P, GLR.T(`s/${A.id}/0`)); sp.position.set(x, y); sp.scale.set(1 / 4); sp.rotation = rot; sp.tint = 0x000000;
  },
};
