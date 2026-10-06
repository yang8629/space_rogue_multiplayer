// 星環電路 雙人版 · fx.js：粒子、浮動數字（畫面用；遊戲邏輯只發事件 burst／floatText／trail，見 game/effects.js）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

const FX = {
  particles: [], texts: [],
  clear() { this.particles = []; this.texts = []; },
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
Events.on('fxTick', dt => FX.update(dt));  // 跟著遊戲時間走（暫停時粒子也停）
Events.on('fxClear', () => FX.clear());
