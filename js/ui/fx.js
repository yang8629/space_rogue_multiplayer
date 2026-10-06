// 星環電路 雙人版 · fx.js：粒子、浮動數字、爆炸光圈、電弧、閃光、橫幅、畫面震動（畫面用；遊戲邏輯只發事件，見 game/effects.js）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

const FX = {
  particles: [], texts: [], rings: [], zaps: [], flashes: [], banner: null, shake: 0, zapSent: 0,
  clear() { this.particles = []; this.texts = []; this.rings = []; this.zaps = []; this.flashes = []; this.banner = null; this.shake = 0; },
  // 往四周噴 n 顆粒子
  burst(d) {
    const P = this.particles;
    for (let i = 0; i < d.n && P.length < 1500; i++) {
      const a = rand(0, TAU), s = rand(0.2, 1) * d.spd, l = rand(0.5, 1) * d.life;
      P.push({ x: d.x, y: d.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, color: d.color, size: d.size });
    }
  },
  // 留在原地的一顆（衝刺、衝鋒的殘影）
  trail(d) {
    if (this.particles.length < 1500 && !(d.chance < 1 && Math.random() >= d.chance))
      this.particles.push({ x: d.x, y: d.y, vx: 0, vy: 0, life: d.life, max: d.life, color: d.color, size: d.size });
  },
  text(d) {
    if (this.texts.length > 120) return;
    this.texts.push({ x: d.x + rand(-6, 6), y: d.y - 8, text: d.text, color: d.color, life: 0.7, big: d.big });
  },
  update(dt) {
    for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; q.life -= dt; }
    this.particles = this.particles.filter(q => q.life > 0);
    for (const t of this.texts) { t.y -= 40 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter(r => r.life > 0);
    for (const z of this.zaps) z.life -= dt;
    this.zaps = this.zaps.filter(z => z.life > 0);
    for (const q of this.flashes) q.life -= dt;
    this.flashes = this.flashes.filter(q => q.life > 0);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    this.shake = Math.max(0, this.shake - dt * 40);
    this.zapSent = 0;
  },
};

// 房主的粒子、數字也轉給隊友（隊友收到後照樣呼叫 burst／floatText，見 net.js）
Events.on('burst', d => {
  if (Net.role === 'host') Net.fx(['b', Math.round(d.x), Math.round(d.y), d.color, d.n, Math.round(d.spd), d.life, d.size]);
  FX.burst(d);
});
Events.on('floatText', d => {
  if (Net.role === 'host') Net.fx(['t', Math.round(d.x), Math.round(d.y), d.text, d.color, d.big ? 1 : 0]);
  FX.text(d);
});
Events.on('trail', d => FX.trail(d));
Events.on('ring', d => {
  if (Net.role === 'host') Net.fx(['r', Math.round(d.x), Math.round(d.y), Math.round(d.r), d.color]);
  if (FX.rings.length < 40) FX.rings.push({ x: d.x, y: d.y, r: d.r, life: 0.3, max: 0.3, color: d.color });
});
Events.on('zap', d => {
  // 轉給隊友：share 是機率（電網一次幾百條時只傳一部分），每幀最多 60 條
  if (Net.role === 'host' && (d.share == null || (FX.zapSent < 60 && Math.random() < d.share))) {
    if (d.share != null) FX.zapSent++;
    Net.fx(['z', Math.round(d.x1), Math.round(d.y1), Math.round(d.x2), Math.round(d.y2), ...(d.c ? [d.c] : [])]);
  }
  if (FX.zaps.length < d.cap) FX.zaps.push({ x1: d.x1, y1: d.y1, x2: d.x2 + (d.jitter ? rand(-d.jitter, d.jitter) : 0), y2: d.y2 + (d.jitter ? rand(-d.jitter, d.jitter) : 0), life: d.life, max: d.life, c: d.c });
});
Events.on('flash', d => {
  if (Net.role === 'host') Net.fx(['f', Math.round(d.x), Math.round(d.y), Math.round(d.r)]);
  if (FX.flashes.length < 20) FX.flashes.push({ x: d.x, y: d.y, r: d.r, life: 0.35, max: 0.35 });
});
Events.on('banner', d => { FX.banner = { text: d.text, sub: d.sub, t: d.t }; });  // 隊友那邊由房主的同步蓋過去（net.js 的 bn）
Events.on('shake', v => { FX.shake = Math.max(FX.shake, v); });
Events.on('fxTick', dt => FX.update(dt));  // 跟著遊戲時間走（暫停時粒子也停）
Events.on('fxClear', () => FX.clear());
