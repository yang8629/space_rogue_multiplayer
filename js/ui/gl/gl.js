// 星環電路 雙人版 · gl/gl.js：WebGL 繪圖層（PixiJS）的核心：開關、圖集、圖層、物件池、每幀的總流程
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
// 做法照 Godot：所有東西都是貼圖（圖集 assets/atlas_data.js）、同一張圖集的一次批次畫完；發光用加法混色＋整個畫面的 bloom 光暈
//   圖層（由下到上）：背景星空 → 地圖（牆、物件）→ 我方子彈與特效 → 敵人 → 敵方攻擊 → 飛船 → 浮動數字；HUD 還是畫在上面那層 2D 畫布
//   遊戲邏輯不碰這裡；這裡只讀遊戲狀態畫出來（換引擎時只換這一層）
'use strict';

const GLR = {
  on: false, ready: false, failed: false, app: null, L: {}, tex: {}, frames: null,
  // 開關：設定存在本機（'gl' = 新畫面）；PixiJS 或圖集沒載入就一律用舊畫面
  wanted() { try { return localStorage.getItem('renderer') !== '2d'; } catch (e) { return true; } },  // 預設新畫面；按 F2 或標題畫面的按鈕切換
  available() { return typeof PIXI !== 'undefined' && typeof window !== 'undefined' && !!window.ATLAS && !this.failed; },
  toggle() {
    const next = !(this.on && this.ready);
    try { localStorage.setItem('renderer', next ? 'gl' : '2d'); } catch (e) {}
    this.setOn(next);
  },
  setOn(v) {
    this.on = v && this.available();
    const el = document.getElementById('glc');
    if (el) el.style.display = this.on ? 'block' : 'none';
    if (this.on && !this.app && !this.starting) this.start();
  },
  label() { return this.on ? '🖥 新畫面' : '🖥 舊畫面'; },

  async start() {
    this.starting = true;
    try {
      const app = new PIXI.Application();
      await app.init({ canvas: document.getElementById('glc'), width: VW, height: VH, resolution: DPR, autoDensity: true, antialias: true, background: '#05060f', preference: 'webgl', autoStart: false, sharedTicker: false });
      this.app = app;
      await this.loadAtlas();
      this.buildLayers();
      this.ready = true;
    } catch (e) {
      console.error('WebGL 繪圖層啟動失敗，改用舊畫面', e);
      this.failed = true; this.on = false;
      const el = document.getElementById('glc'); if (el) el.style.display = 'none';
    }
    this.starting = false;
  },
  resize() { if (this.app) this.app.renderer.resize(VW, VH, DPR); },

  // ---------- 圖集 ----------
  async loadAtlas() {
    const A = window.ATLAS, bases = [];
    for (const src of A.pages) {
      const img = new Image(); img.src = src; await img.decode();
      bases.push(PIXI.Texture.from(img).source);
    }
    this.frames = A.frames;
    for (const [name, f] of Object.entries(A.frames)) {
      const t = new PIXI.Texture({ source: bases[f.page], frame: new PIXI.Rectangle(f.x, f.y, f.w, f.h) });
      t.defaultAnchor = { x: f.ax, y: f.ay };
      this.tex[name] = t;
    }
    // 牆面貼磚要能重複鋪：另外做成獨立的貼圖
    this.tiles = {}; this.flows = {};
    for (const [name, f] of Object.entries(A.frames)) {
      const flow = name.match(/^w\/(\w+)\/flow\/(\d+)$/);
      if (!name.endsWith('/tile') && !flow) continue;
      const cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h;
      const img = bases[f.page].resource;
      cv.getContext('2d').drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      const t = PIXI.Texture.from(cv); t.source.addressMode = 'repeat';
      if (flow) (this.flows[flow[1]] = this.flows[flow[1]] || [])[+flow[2]] = t;
      else this.tiles[name.split('/')[1]] = t;
    }
  },
  T(name) { return this.tex[name] || PIXI.Texture.WHITE; },
  res(name) { const f = this.frames[name]; return f ? f.res : 1; },

  // ---------- 圖層 ----------
  buildLayers() {
    const st = this.app.stage, C = () => new PIXI.Container();
    const L = this.L;
    L.bg = C(); L.world = C(); st.addChild(L.bg, L.world);
    for (const k of ['grid', 'map', 'mapFx', 'pickups', 'bullets', 'fx', 'eBullets', 'enemies', 'eFx', 'ships', 'texts']) { L[k] = C(); L.world.addChild(L[k]); }
    // 發光：整個世界加 bloom（亮的地方自然發光）
    const F = PIXI.filters || {};
    if (F.AdvancedBloomFilter) L.world.filters = [new F.AdvancedBloomFilter({ threshold: 0.72, bloomScale: 0.45, brightness: 1, blur: 4, quality: 4 })];
    this.pools = {};
    GLWorld.init(); GLActors.init(); GLFx.init();
  },
  // 物件池：每幀從頭借，用不到的藏起來（不每幀建立／刪除物件）
  pool(key, layer, make) {
    let P = this.pools[key];
    if (!P) P = this.pools[key] = { items: [], n: 0, layer, make };
    return P;
  },
  take(P) {
    let s = P.items[P.n];
    if (!s) { s = P.make(); P.items.push(s); P.layer.addChild(s); }
    P.n++; s.visible = true; return s;
  },
  sprite(P, tex) {
    const s = this.take(P);
    if (s.texture !== tex) s.texture = tex;
    s.alpha = 1; s.tint = 0xffffff; s.rotation = 0; s.scale.set(1); s.blendMode = 'normal';
    s.anchor.copyFrom(tex.defaultAnchor || { x: 0.5, y: 0.5 });
    return s;
  },
  beginPools() { for (const P of Object.values(this.pools)) P.n = 0; },
  endPools() { for (const P of Object.values(this.pools)) for (let i = P.n; i < P.items.length; i++) if (P.items[i].visible) P.items[i].visible = false; },

  // ---------- 每幀 ----------
  render() {
    if (!this.ready) return false;
    const c = Game.cam, L = this.L;
    this.beginPools();
    GLWorld.drawBg();
    L.world.visible = !!Game.inArena;
    if (Game.inArena) {
      const sx = c.shake ? rand(-c.shake, c.shake) : 0, sy = c.shake ? rand(-c.shake, c.shake) : 0;
      L.world.scale.set(ZOOM); L.world.position.set((-c.x + sx) * ZOOM, (-c.y + sy) * ZOOM);
      GLWorld.draw(); GLFx.draw(); GLActors.draw(); GLFx.drawTexts();
    }
    this.endPools();
    this.app.render();
    return true;
  },
};

// 顏色字串（#rgb、#rrggbb、rgba(...)）→ 數字（給 tint）；快取
const GLCOL = new Map();
function glColor(c) {
  let v = GLCOL.get(c);
  if (v !== undefined) return v;
  if (typeof c === 'string' && c[0] === '#') { const h = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, '$1$1$2$2$3$3') : c.slice(1, 7); v = parseInt(h, 16); }
  else if (typeof c === 'string' && c.startsWith('rgb')) { const m = c.match(/[\d.]+/g) || []; v = ((+m[0] || 0) << 16) | ((+m[1] || 0) << 8) | (+m[2] || 0); }
  else v = 0xffffff;
  if (GLCOL.size < 4000) GLCOL.set(c, v);
  return v;
}

// 畫弧線：先把筆移到弧的起點（PixiJS 的 arc 會從上一筆的終點連一條線過來）
function glArc(g, x, y, r, a0, a1) { return g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1); }

// 粒子容器：大量同類的小東西（我方子彈、敵彈、粒子）一次送給顯示卡；同一個容器的貼圖要在同一頁圖集上
//   每幀 begin → get（借一個、設好位置）→ end（把用到的交給容器）
class GLParticles {
  constructor(layer, blend) {
    this.pc = new PIXI.ParticleContainer({ dynamicProperties: { position: true, rotation: true, vertex: true, color: true } });
    this.pc.blendMode = blend; layer.addChild(this.pc);
    this.items = []; this.n = 0;
  }
  begin() { this.n = 0; }
  get(tex, x, y) {
    let q = this.items[this.n];
    if (!q) { q = new PIXI.Particle({ texture: tex }); this.items.push(q); }
    this.n++;
    q.texture = tex; q.x = x; q.y = y; q.rotation = 0; q.scaleX = q.scaleY = 1; q.tint = 0xffffff; q.alpha = 1;
    const a = tex.defaultAnchor; q.anchorX = a ? a.x : 0.5; q.anchorY = a ? a.y : 0.5;
    return q;
  }
  end() { const L = this.pc.particleChildren; L.length = 0; for (let i = 0; i < this.n; i++) L.push(this.items[i]); this.pc.update(); }
}
