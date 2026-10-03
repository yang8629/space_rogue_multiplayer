// 星環電路 雙人版 · arena.js：戰鬥場地（方形場地／不規則大地圖）：產生、撞牆、反彈、閘門、尋路用的牆、畫面、小地圖
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 場地有兩種：
//   方形（rect）：旗艦戰、沙盒、靶場 → 跟以前一樣 CFG.WORLD_W × CFG.WORLD_H，碰到邊緣就停（舊的程式照舊）
//   大地圖：一般戰、精英戰 → 一場戰鬥的 2～3 個區域（一區一波）接成一張圖，區域之間用通道相連，通道中間有閘門
//     區域形狀：一個主圓＋往入口／出口伸出去的兩條「手臂」＋2～4 個衛星圓（疊在一起），邊緣用雜訊弄得坑坑窪窪
//     相鄰區域之間至少隔一道牆（照兩個區域中心的中線切開），只能從通道走
//     場地值 f(x, y)：大約是「離最近的牆多遠」（正 = 空地、負 = 牆裡），存在 20×20 的格點上、用雙線性內插
//     閘門：這一區清完才打開；飛船可以往前穿過、不能回頭；敵人、子彈一律穿不過（子彈打到閘門跟打到牆一樣）
//   地圖用種子產生（雙人：只傳種子，兩邊產生一模一樣的地圖）
// =====================================================================
const ARENA = {
  CELL: 20,           // 格點間距
  GAP: 2650,          // 相鄰區域中心的距離（大小：每區空地平均約 240 萬 px²，方形場地的 2/3）
  MAIN_R: [570, 670], // 主圓半徑
  ARM: 950,           // 手臂長度（區域中心到通道口）
  ARM_W: [190, 235],  // 手臂半寬
  SAT_N: [3, 4], SAT_R: [330, 490], NECK: 160,  // 衛星圓：個數、半徑、跟上一個圓接起來的地方至少多寬（半寬）
  WALL: 160,          // 相鄰區域之間的牆至少多厚
  CORR_W: 120,        // 通道半寬
  GATE_T: 6,          // 閘門半厚（子彈判定）
  MARGIN: 260,        // 地圖外圍留白
};

// 有種子的亂數（mulberry32）
function seededRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Arena = {
  rect: true, W: 2400, H: 1600, seed: 0, n: 0,
  areas: [], gates: [], start: { x: 1200, y: 800 },
  NX: 0, NY: 0, val: null, owner: null, path: null, wallPath: null,

  // ---------- 方形場地（旗艦戰、沙盒、靶場；雙人的隊友收到種子之前也先用這個） ----------
  reset() {
    this.rect = true; this.W = CFG.WORLD_W; this.H = CFG.WORLD_H; this.seed = 0; this.n = 0;
    this.areas = []; this.gates = []; this.start = { x: this.W / 2, y: this.H / 2 };
    this.val = this.owner = this.path = this.wallPath = null; this.exitFlow = null;
  },

  // ---------- 產生大地圖：n 個區域 ----------
  gen(seed, n) {
    const R = seededRand(seed), rr = (a, b) => a + (b - a) * R(), ri = (a, b) => Math.floor(rr(a, b + 1));
    this.rect = false; this.seed = seed; this.n = n;
    // 1. 區域中心：第一區往右，之後往右／上／下（±20°），不能太靠近之前的區域
    const C = [{ x: 0, y: 0 }], dirs = [];
    for (let k = 1; k < n; k++) {
      const p = C[k - 1];
      let best = null;
      for (let t = 0; t < 30 && !best; t++) {
        const base = k === 1 ? 0 : [0, -Math.PI / 2, Math.PI / 2][ri(0, 2)], a = base + rr(-0.35, 0.35);
        const q = { x: p.x + Math.cos(a) * ARENA.GAP, y: p.y + Math.sin(a) * ARENA.GAP };
        if (C.every(c => Math.hypot(c.x - q.x, c.y - q.y) > ARENA.GAP * 0.9)) best = { q, a };
      }
      if (!best) best = { q: { x: p.x + ARENA.GAP, y: p.y }, a: 0 };
      C.push(best.q); dirs.push(best.a);
    }
    // 2. 每個區域的形狀
    const noise = () => Array.from({ length: 6 }, (_, i) => ({ k: [3, 4, 5, 7, 13, 19][i], a: [0.05, 0.035, 0.03, 0.02, 0.012, 0.008][i] * rr(0.6, 1.4), p: rr(0, Math.PI * 2) }));
    const areas = C.map((c, k) => {
      const shapes = [], main = { kind: 'c', x: c.x, y: c.y, r: rr(...ARENA.MAIN_R), nz: noise() };
      shapes.push(main);
      const arms = [];
      if (k > 0) arms.push(dirs[k - 1] + Math.PI);  // 入口（從上一區來）
      if (k < n - 1) arms.push(dirs[k]);             // 出口（往下一區）
      for (const a of arms) shapes.push({ kind: 'cap', ax: c.x, ay: c.y, bx: c.x + Math.cos(a) * ARENA.ARM, by: c.y + Math.sin(a) * ARENA.ARM, w: rr(...ARENA.ARM_W), p: rr(0, 6.28) });
      if (k === 0) shapes.push({ kind: 'cap', ax: c.x, ay: c.y, bx: c.x - Math.cos(dirs[0] || 0) * ARENA.ARM * 0.55, by: c.y - Math.sin(dirs[0] || 0) * ARENA.ARM * 0.55, w: rr(...ARENA.ARM_W), p: rr(0, 6.28) });
      const circles = [main];
      for (let s = ri(...ARENA.SAT_N); s > 0; s--) {
        const par = circles[R() < 0.7 ? 0 : ri(0, circles.length - 1)], r2 = rr(...ARENA.SAT_R);
        // 離開手臂方向至少 35°（不要把通道口塞住）
        let a = 0;
        for (let t = 0; t < 12; t++) { a = rr(0, Math.PI * 2); if (arms.every(b => Math.abs(angleDiff(a, b)) > 0.6)) break; }
        // 接起來的地方至少 2×NECK 寬：兩圓的交線半長 h ≥ NECK（半徑先打 88 折，扣掉雜訊凹進去的部分）
        const r1e = par.r * 0.88, r2e = r2 * 0.88;
        let lo = Math.max(10, Math.abs(r1e - r2e) + 1), hi = r1e + r2e;
        const half = d => { const x = (d * d + r1e * r1e - r2e * r2e) / (2 * d); return Math.sqrt(Math.max(0, r1e * r1e - x * x)); };
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (half(m) >= ARENA.NECK) lo = m; else hi = m; }
        const d = Math.max(par.r * 0.35, lo * rr(0.6, 1));
        const sc = { kind: 'c', x: par.x + Math.cos(a) * d, y: par.y + Math.sin(a) * d, r: r2, nz: noise() };
        shapes.push(sc); circles.push(sc);
      }
      return { k, cx: c.x, cy: c.y, shapes };
    });
    // 3. 通道與閘門：上一區的手臂末端 → 下一區的手臂末端，閘門在正中間（法線朝下一區）
    const corridors = [], gates = [];
    for (let k = 0; k < n - 1; k++) {
      const a = dirs[k], ux = Math.cos(a), uy = Math.sin(a), A = C[k], B = C[k + 1];
      corridors.push({ kind: 'cap', ax: A.x + ux * (ARENA.ARM - 60), ay: A.y + uy * (ARENA.ARM - 60), bx: B.x - ux * (ARENA.ARM - 60), by: B.y - uy * (ARENA.ARM - 60), w: ARENA.CORR_W, p: 0, flat: true });
      gates.push({ i: k, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, nx: ux, ny: uy, L: ARENA.CORR_W + 50, open: false });
    }
    // 4. 外框：全部形狀的範圍加留白，整張圖平移到 (MARGIN, MARGIN) 開始
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ext = s => s.kind === 'c' ? [[s.x - s.r * 1.2, s.y - s.r * 1.2], [s.x + s.r * 1.2, s.y + s.r * 1.2]]
      : [[Math.min(s.ax, s.bx) - s.w * 1.2, Math.min(s.ay, s.by) - s.w * 1.2], [Math.max(s.ax, s.bx) + s.w * 1.2, Math.max(s.ay, s.by) + s.w * 1.2]];
    for (const s of [...areas.flatMap(a => a.shapes), ...corridors]) for (const [x, y] of ext(s)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const ox = ARENA.MARGIN - x0, oy = ARENA.MARGIN - y0;
    const mv = s => { if (s.kind === 'c') { s.x += ox; s.y += oy; } else { s.ax += ox; s.ay += oy; s.bx += ox; s.by += oy; } };
    for (const a of areas) { a.cx += ox; a.cy += oy; a.shapes.forEach(mv); }
    corridors.forEach(mv);
    for (const g of gates) { g.x += ox; g.y += oy; }
    const CELL = ARENA.CELL;
    this.W = Math.ceil((x1 - x0 + ARENA.MARGIN * 2) / CELL) * CELL; this.H = Math.ceil((y1 - y0 + ARENA.MARGIN * 2) / CELL) * CELL;
    this.areas = areas; this.gates = gates; this.corridors = corridors;
    // 5. 格點上的場地值：每個區域取形狀的最大值，再照區域中心的中線切開（留 WALL 厚的牆）；通道另外疊上去
    const NX = this.NX = this.W / CELL, NY = this.NY = this.H / CELL, N = (NX + 1) * (NY + 1);
    const val = this.val = new Float32Array(N).fill(-999), owner = this.owner = new Int8Array(N).fill(-1);
    const tmp = new Float32Array(N);
    const shapeVal = (s, x, y) => {
      if (s.kind === 'c') {
        const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        let m = 1;
        for (const z of s.nz) m += z.a * Math.sin(z.k * th + z.p);
        return s.r * m - d;
      }
      const vx = s.bx - s.ax, vy = s.by - s.ay, L2 = vx * vx + vy * vy, t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / L2));
      const d = Math.hypot(x - s.ax - vx * t, y - s.ay - vy * t);
      return (s.flat ? s.w : s.w * (1 + 0.1 * Math.sin(t * 9 + s.p) + 0.05 * Math.sin(t * 23 + s.p * 2))) - d;
    };
    const box = s => { const [[a, b], [c, d]] = ext(s); return [Math.max(0, Math.floor(a / CELL)), Math.max(0, Math.floor(b / CELL)), Math.min(NX, Math.ceil(c / CELL)), Math.min(NY, Math.ceil(d / CELL))]; };
    for (const A of areas) {
      tmp.fill(-999);
      for (const s of A.shapes) {
        const [i0, j0, i1, j1] = box(s);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * (NX + 1) + i, v = shapeVal(s, i * CELL, j * CELL);
          if (v > tmp[k]) tmp[k] = v;
        }
      }
      for (let k = 0; k < N; k++) {
        if (tmp[k] <= -999) continue;
        const x = (k % (NX + 1)) * CELL, y = Math.floor(k / (NX + 1)) * CELL, ds = Math.hypot(x - A.cx, y - A.cy);
        let v = tmp[k];
        for (const B of areas) if (B !== A) v = Math.min(v, (Math.hypot(x - B.cx, y - B.cy) - ds) / 2 - ARENA.WALL / 2);
        if (v > val[k]) { val[k] = v; owner[k] = v > 0 ? A.k : -1; }
      }
    }
    for (const s of corridors) {
      const [i0, j0, i1, j1] = box(s);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * (NX + 1) + i, v = shapeVal(s, i * CELL, j * CELL);
        if (v > val[k]) { val[k] = v; owner[k] = -1; }
      }
    }
    this.start = { x: areas[0].cx, y: areas[0].cy };
    this.exitFlow = null;
    this.buildPath();
  },

  // ---------- 查詢 ----------
  // 場地值（不含閘門）：大約是離最近的牆多遠；方形場地 = 離最近的邊多遠
  f(x, y) {
    if (this.rect) return Math.min(x, y, this.W - x, this.H - y);
    const CELL = ARENA.CELL, gx = x / CELL, gy = y / CELL;
    if (gx < 0 || gy < 0 || gx >= this.NX || gy >= this.NY) return -100;
    const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j, W = this.NX + 1, k = j * W + i, v = this.val;
    return (v[k] * (1 - tx) + v[k + 1] * tx) * (1 - ty) + (v[k + W] * (1 - tx) + v[k + W + 1] * tx) * ty;
  },
  // 往空地的方向（場地值增加最快的方向）
  grad(x, y) {
    const h = 6, gx = this.f(x + h, y) - this.f(x - h, y), gy = this.f(x, y + h) - this.f(x, y - h), l = Math.hypot(gx, gy);
    return l > 1e-6 ? [gx / l, gy / l] : [1, 0];
  },
  // (x, y) 在第幾個區域（通道、牆裡：照最近的閘門在哪一側）
  zoneOf(x, y) {
    if (this.rect) return 0;
    const CELL = ARENA.CELL, i = clamp(Math.round(x / CELL), 0, this.NX), j = clamp(Math.round(y / CELL), 0, this.NY), o = this.owner[j * (this.NX + 1) + i];
    if (o >= 0) return o;
    let best = null, bd = Infinity;
    for (const g of this.gates) { const d = dist2(x, y, g.x, g.y); if (d < bd) { bd = d; best = g; } }
    return best ? ((x - best.x) * best.nx + (y - best.y) * best.ny > 0 ? best.i + 1 : best.i) : 0;
  },
  // 圓形物體 o（半徑 r）在牆外：推回空地、拿掉往牆裡的速度；閘門：照 o.zone 擋在對的一側（canPass(g) = 這道閘門讓它過）
  // 回傳撞到的牆的法線（朝空地）或 null
  collide(o, r, canPass) {
    let hit = null;
    if (o.zone == null) o.zone = this.zoneOf(o.x, o.y);
    for (const g of this.gates) {
      const dx = o.x - g.x, dy = o.y - g.y, s = dx * g.nx + dy * g.ny, t = -dx * g.ny + dy * g.nx;
      if (Math.abs(t) > g.L || Math.abs(s) > r + 300) continue;
      if (o.zone <= g.i) {  // 在閘門後面
        if (canPass && canPass(g)) continue;
        if (s > -r) { o.x -= g.nx * (s + r); o.y -= g.ny * (s + r); hit = [-g.nx, -g.ny]; }
      } else if (s < r) { o.x += g.nx * (r - s); o.y += g.ny * (r - s); hit = [g.nx, g.ny]; }  // 在閘門前面（已經穿過去了）
    }
    for (let it = 0; it < 3; it++) {
      const v = this.f(o.x, o.y);
      if (v >= r) break;
      const [nx, ny] = this.grad(o.x, o.y);
      o.x += nx * (r - v + 0.5); o.y += ny * (r - v + 0.5);
      hit = [nx, ny];
    }
    if (hit && o.vx != null) { const vn = o.vx * hit[0] + o.vy * hit[1]; if (vn < 0) { o.vx -= vn * hit[0]; o.vy -= vn * hit[1]; } }
    return hit;
  },
  // 飛船穿過打開的閘門：區域 +1
  updateZone(p) {
    if (this.rect) return;
    if (p.zone == null) p.zone = this.zoneOf(p.x, p.y);
    const g = this.gates[p.zone];
    if (g && g.open && (p.x - g.x) * g.nx + (p.y - g.y) * g.ny > 0) p.zone++;
  },
  // 飛船：這道閘門讓不讓過（打開了，而且是從後面往前走）
  shipPass(p) { return g => g.open && p.zone === g.i; },
  // 點放進空地（離牆至少 r）：方形場地 = 夾在邊界裡
  clampIn(x, y, r) {
    if (this.rect) return [clamp(x, r, this.W - r), clamp(y, r, this.H - r)];
    const o = { x: clamp(x, r, this.W - r), y: clamp(y, r, this.H - r) };
    this.collide(o, r, () => true);
    return [o.x, o.y];
  },
  // 線段 (ax, ay) → (bx, by) 穿過哪一道閘門（子彈用）；回傳 { g, nx, ny }（法線朝線段起點那一側）
  gateCross(ax, ay, bx, by) {
    for (const g of this.gates) {
      const sa = (ax - g.x) * g.nx + (ay - g.y) * g.ny, sb = (bx - g.x) * g.nx + (by - g.y) * g.ny;
      if ((sa > 0) === (sb > 0) && Math.abs(sb) > ARENA.GATE_T) continue;
      const k = Math.abs(sa - sb) > 1e-6 ? sa / (sa - sb) : 0, x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
      if (Math.abs(-(x - g.x) * g.ny + (y - g.y) * g.nx) > g.L) continue;
      const side = sa > 0 ? 1 : -1;
      return { g, nx: g.nx * side, ny: g.ny * side, x, y, s: sb };
    }
    return null;
  },
  // 我方子彈碰牆／閘門：回傳 null（沒碰到）或法線 { nx, ny, x, y }（x, y = 推回空地的位置）
  bulletWall(px, py, x, y, r) {
    if (this.rect) return null;
    const G = this.gateCross(px, py, x, y);
    if (G) return { nx: G.nx, ny: G.ny, x: G.x + G.nx * (ARENA.GATE_T + r + 1), y: G.y + G.ny * (ARENA.GATE_T + r + 1) };
    const v = this.f(x, y);
    if (v >= 0) return null;
    const [nx, ny] = this.grad(x, y);
    return { nx, ny, x: x + nx * (1 - v), y: y + ny * (1 - v) };
  },
  // 直線上有沒有牆或閘門（pad：線的半寬）；每 16 取一點
  losBlocked(ax, ay, bx, by, pad) {
    if (this.rect) return false;
    if (this.gateCross(ax, ay, bx, by)) return true;
    const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 16);
    for (let i = 1; i < n; i++) if (this.f(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) < pad) return true;
    return false;
  },
  // 從 (x, y) 往角度 a 最多能走多遠（離牆至少 r，不穿閘門；瞬移用）
  rayFree(x, y, a, dist, r) {
    if (this.rect) return dist;
    const ux = Math.cos(a), uy = Math.sin(a);
    let ok = 0;
    for (let d = 10; d <= dist; d += 10) {
      const tx = x + ux * d, ty = y + uy * d;
      if (this.f(tx, ty) < r || this.gateCross(x, y, tx, ty)) break;
      ok = d;
    }
    return ok;
  },
  // 敵人出生點：散在第 k 區各處（主圓、衛星圓、手臂隨機挑一個再隨機一點），離 refs（在這一區的玩家）至少 minD、離牆至少 margin
  //   （以前是離玩家 520～780 的一圈：剛穿過閘門時那一圈大多落在前方，敵人一起生在面前）
  spawnPoint(k, refs, minD, margin) {
    return this.randomIn(k, margin, refs, minD);
  },
  // 第 k 區裡隨機一點（離牆至少 margin；盡量離 refs 至少 minD）
  randomIn(k, margin, refs = [], minD = 0) {
    const A = this.areas[k] || this.areas[0];
    let fallback = null;
    for (let t = 0; t < 300; t++) {
      const s = A.shapes[Math.floor(Math.random() * A.shapes.length)];
      const x = s.kind === 'c' ? s.x + rand(-s.r, s.r) : s.ax + (s.bx - s.ax) * Math.random() + rand(-s.w, s.w);
      const y = s.kind === 'c' ? s.y + rand(-s.r, s.r) : s.ay + (s.by - s.ay) * Math.random() + rand(-s.w, s.w);
      if (this.f(x, y) < margin || this.zoneOf(x, y) !== A.k) continue;
      if (!fallback) fallback = [x, y];
      if (refs.every(p => dist2(x, y, p.x, p.y) >= minD * minD)) return [x, y];
    }
    return fallback || [A.cx, A.cy];
  },
  areaCenter(k) { const A = this.areas[k] || this.areas[0]; return { x: A.cx, y: A.cy }; },
  // 第 k 區的入口（從閘門進來的地方；第 1 區 = 出生點）
  entryOf(k) {
    const g = this.gates[k - 1];
    return g ? { x: g.x + g.nx * 120, y: g.y + g.ny * 120 } : { ...this.start };
  },

  // ---------- 尋路用：哪些格子是牆（格子大小 = OBJ.FLOW_CELL，格子中心離牆不到 pad 就算牆；閘門附近也算） ----------
  markWalls(blk, C, W, H, pad) {
    if (this.rect) return;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = (x + 0.5) * C, cy = (y + 0.5) * C;
      if (this.f(cx, cy) < pad) blk[y * W + x] = 1;
    }
    for (const g of this.gates) for (let t = -g.L; t <= g.L; t += C / 2) for (const s of [-C / 2, 0, C / 2]) {
      const x = Math.floor((g.x - g.ny * t + g.nx * s) / C), y = Math.floor((g.y + g.nx * t + g.ny * s) / C);
      if (x >= 0 && y >= 0 && x < W && y < H) blk[y * W + x] = 1;
    }
  },
  // 牆圖快取（格子中心離牆的值；尋路每 0.25 秒用一次，牆不會變，算一次就好）
  wallMask(C, W, H, pad) {
    const key = `${this.seed}:${C}:${W}:${H}:${pad}`;
    if (this._mask && this._mask.key === key) return this._mask.blk;
    const blk = new Uint8Array(W * H);
    this.markWalls(blk, C, W, H, pad);
    this._mask = { key, blk };
    return blk;
  },
  // 出口方向（電腦操作用）：從閘門往外算步數，回傳往閘門走的方向；閘門沒開回傳 null
  exitDir(x, y, k) {
    const g = this.gates[k];
    if (this.rect || !g || !g.open) return null;
    const C = OBJ.FLOW_CELL, W = Math.ceil(this.W / C), H = Math.ceil(this.H / C);
    if (!this.exitFlow || this.exitFlow.k !== k) {
      const blk = new Uint8Array(W * H);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (this.f((xx + 0.5) * C, (yy + 0.5) * C) < 24) blk[yy * W + xx] = 1;
      const dist = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
      let head = 0, tail = 0;
      const tx = Math.floor((g.x - g.nx * 40) / C), ty = Math.floor((g.y - g.ny * 40) / C), s = ty * W + tx;
      dist[s] = 0; q[tail++] = s;
      while (head < tail) {
        const c = q[head++], cx = c % W, d = dist[c] + 1;
        for (const n of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (n < 0 || n >= W * H || dist[n] >= 0 || blk[n]) continue;
          dist[n] = d; q[tail++] = n;
        }
      }
      this.exitFlow = { k, dist, W, H };
    }
    // 直線看得到閘門就直接指過去；看不到就沿著步數遞減的路線往前走（最多 60 格），指向路線上「從這裡直線看得到」的最遠一點
    //   （只看隔壁一格的話，飛船在格子裡移動方向就會在 45° 之間跳來跳去，箭頭會抖）
    const goal = [g.x - g.nx * 40, g.y - g.ny * 40], to = ([px, py]) => { const l = Math.hypot(px - x, py - y) || 1; return [(px - x) / l, (py - y) / l]; };
    if (!this.losBlocked(x, y, goal[0], goal[1], 16)) return to([g.x + g.nx * 80, g.y + g.ny * 80]);  // 看得到閘門：指向閘門另一邊（直接穿過去，不會停在門前）
    const F = this.exitFlow;
    let c = clamp(Math.floor(y / C), 0, H - 1) * W + clamp(Math.floor(x / C), 0, W - 1);
    const path = [];
    for (let step = 0; step < 60; step++) {
      const cx = c % W, cy = Math.floor(c / W);
      let best = -1, bd = F.dist[c] >= 0 ? F.dist[c] : Infinity;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox, yy = cy + oy;
        if ((!ox && !oy) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = F.dist[yy * W + xx];
        if (d >= 0 && d < bd) { bd = d; best = yy * W + xx; }
      }
      if (best < 0) break;
      c = best; path.push([(c % W + 0.5) * C, (Math.floor(c / W) + 0.5) * C]);
      if (bd === 0) break;
    }
    if (!path.length) return to(goal);
    for (let i = path.length - 1; i > 0; i--) if (!this.losBlocked(x, y, path[i][0], path[i][1], 12)) return to(path[i]);
    return to(path[0]);
  },

  // ---------- 畫面 ----------
  // 牆的輪廓：在格點上做 marching squares，把線段接成封閉的圈，做成 Path2D（只算一次）
  buildPath() {
    this.path = this.wallPath = null;
    this.loops = [];
    const NX = this.NX, NY = this.NY, W = NX + 1, v = this.val, CELL = ARENA.CELL;
    const V = (i, j) => v[j * W + i];
    // 邊的編號：橫邊 (i, j)-(i+1, j) = 2 * (j * W + i)；直邊 (i, j)-(i, j+1) = 2 * (j * W + i) + 1
    const pt = e => {
      const n = e >> 1, i = n % W, j = Math.floor(n / W), a = V(i, j);
      const b = e & 1 ? V(i, j + 1) : V(i + 1, j), t = a / (a - b);
      return e & 1 ? [i * CELL, (j + t) * CELL] : [(i + t) * CELL, j * CELL];
    };
    const adj = new Map(), link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = V(i, j) > 0, b = V(i + 1, j) > 0, c = V(i + 1, j + 1) > 0, d = V(i, j + 1) > 0;
      const idx = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = 2 * (j * W + i), R = 2 * (j * W + i + 1) + 1, B = 2 * ((j + 1) * W + i), L = 2 * (j * W + i) + 1;
      const segs = {
        1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, B]], 6: [[T, B]], 7: [[L, B]], 8: [[B, L]], 9: [[B, T]], 11: [[B, R]], 12: [[R, L]], 13: [[R, T]], 14: [[T, L]],
        5: (V(i, j) + V(i + 1, j) + V(i + 1, j + 1) + V(i, j + 1)) > 0 ? [[L, B], [R, T]] : [[L, T], [R, B]],
        10: (V(i, j) + V(i + 1, j) + V(i + 1, j + 1) + V(i, j + 1)) > 0 ? [[T, L], [B, R]] : [[T, R], [B, L]],
      }[idx];
      for (const [p, q] of segs) link(p, q);
    }
    const seen = new Set();
    for (const s of adj.keys()) {
      if (seen.has(s)) continue;
      const loop = [];
      let prev = -1, cur = s;
      while (cur != null && !seen.has(cur)) {
        seen.add(cur); loop.push(pt(cur));
        const nb = adj.get(cur), nx = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = nx;
      }
      if (loop.length > 2) this.loops.push(loop);
    }
    if (typeof Path2D === 'undefined') return;
    const P = new Path2D();
    for (const l of this.loops) { P.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) P.lineTo(l[i][0], l[i][1]); P.closePath(); }
    const WP = new Path2D();
    WP.rect(-4000, -4000, this.W + 8000, this.H + 8000);
    WP.addPath(P);
    this.path = P; this.wallPath = WP;
  },
  // 牆（填滿＋發光的邊）與閘門；viewer = 畫面跟著的飛船（閘門顏色：能過 = 綠、關著 = 紅）
  draw(viewer) {
    if (this.rect || !this.wallPath) return;
    ctx.fillStyle = '#131a33';
    ctx.fill(this.wallPath, 'evenodd');
    ctx.strokeStyle = 'rgba(110, 140, 230, 0.10)'; ctx.lineWidth = 14; ctx.stroke(this.path);
    ctx.strokeStyle = 'rgba(130, 160, 240, 0.65)'; ctx.lineWidth = 3; ctx.stroke(this.path);
    const t = Game.time;
    for (const g of this.gates) {
      const pass = viewer && viewer.zone === g.i && g.open, behind = viewer && viewer.zone > g.i;
      const color = pass ? '#2ee6a6' : '#ff4d6d', ex = -g.ny * g.L, ey = g.nx * g.L;
      ctx.globalAlpha = behind ? 0.35 : pass ? 0.55 + 0.25 * Math.sin(t * 5) : 0.8;
      ctx.strokeStyle = color; ctx.lineWidth = pass ? 3 : 6;
      if (pass) ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(g.x - ex, g.y - ey); ctx.lineTo(g.x + ex, g.y + ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12; ctx.lineWidth = 22; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
  // 小地圖（畫面右上角，螢幕座標）：整張地圖、閘門、飛船
  drawMinimap(x, y, maxW, maxH) {
    if (this.rect || !this.path) return;
    const s = Math.min(maxW / this.W, maxH / this.H), w = this.W * s, h = this.H * s;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(5, 8, 20, 0.7)'; ctx.fillRect(x - w, y, w, h);
    ctx.strokeStyle = 'rgba(130, 160, 240, 0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x - w, y, w, h);
    ctx.translate(x - w, y); ctx.scale(s, s);
    const C = Game.combat, cur = C ? Math.max(0, (C.wave || 1) - 1) : 0;
    ctx.fillStyle = 'rgba(70, 90, 160, 0.55)'; ctx.fill(this.path);
    for (const g of this.gates) {
      ctx.strokeStyle = g.open ? '#2ee6a6' : '#ff4d6d'; ctx.lineWidth = 3 / s * 0.8;
      ctx.beginPath(); ctx.moveTo(g.x + g.ny * g.L, g.y - g.nx * g.L); ctx.lineTo(g.x - g.ny * g.L, g.y + g.nx * g.L); ctx.stroke();
    }
    const A = this.areas[cur];
    if (A) { ctx.fillStyle = 'rgba(255, 209, 102, 0.9)'; ctx.font = `bold ${Math.round(14 / s)}px Microsoft JhengHei`; ctx.textAlign = 'center'; }
    for (const e of Game.enemies) { if (e.dead) continue; ctx.fillStyle = '#ff4d6d'; ctx.fillRect(e.x - 1.5 / s, e.y - 1.5 / s, 3 / s, 3 / s); }
    for (const p of [Game.player, Game.mate]) {
      if (!p || p.gone) continue;
      ctx.fillStyle = p.dead ? '#888' : p === Game.player ? '#fff' : (p.ship && p.ship.color) || '#4cc9f0';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
};
Arena.reset();
