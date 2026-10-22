// 子彈上限實測：開一場真的戰鬥（1-5，飛船無敵；我方的兩組場上一直有 500 顆敵彈＝攔截有東西擋），每幀把子彈補到 N 顆，N 逐步加大，每段 2 秒
//   記每幀時間（平均、95%）、遊戲邏輯（Game.update）、畫面（GLR.render）→ 找出從哪個數量開始卡，定 CFG.BULLET_CAP
//   三種：雷射（一般子彈）、雷射＋攔截（每幀要找最近的敵彈、合併回射）、敵彈
//   用法：node perf/bulletcap.mjs [數量…]（預設 2000～40000；一段 95% 的幀超過 200ms 就停）
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const steps = process.argv.slice(2).map(Number).filter(Boolean);
const NS = steps.length ? steps : [2000, 5000, 10000, 15000, 20000, 30000, 40000];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await wait(1500);

const run = (kind, N) => p.evaluate(async (kind, N) => {
  CFG.BULLET_CAP = { mine: 1e9, enemy: 1e9 };  // 測試時不刪
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.chain = kind === 'intercept' ? ['weapon', 'intercept'] : ['weapon']; Game.recalc();
  Game.node = { type: 'combat', L: 4, id: 'cap' }; Game.startCombat({ level: 4, wavesTotal: 3, elites: 0 });
  const P = Game.player; P.hp = P.maxHp = 1e9;
  let up = 0, gr = 0;
  const fu = Game.update, fr = GLR.render;
  Game.update = function (dt) { const t = performance.now(); const v = fu.call(this, dt); up += performance.now() - t; return v; };
  GLR.render = function () { const t = performance.now(); const v = fr.call(this); gr += performance.now() - t; return v; };
  const eb = n => { const need = n - Game.eBullets.length;
      for (let i = 0; i < need; i++) { const a = Math.random() * TAU, d = 200 + Math.random() * 900; Game.eBullets.push({ x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d, vx: Math.cos(a + 2) * 120, vy: Math.sin(a + 2) * 120, r: 6, dmg: 0, life: 6, from: '測試' }); } };
  const top = () => {
    if (kind !== 'enemy') eb(500);
    if (kind === 'enemy') {
      const need = N - Game.eBullets.length;
      for (let i = 0; i < need; i++) { const a = Math.random() * TAU, d = 200 + Math.random() * 900; Game.eBullets.push({ x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d, vx: Math.cos(a + 2) * 120, vy: Math.sin(a + 2) * 120, r: 6, dmg: 0, life: 6, from: '測試' }); }
    } else {
      const need = N - Game.bullets.length;
      if (need > 0) fireChainAt(P, null, Array.from({ length: need }, () => Math.random() * TAU));
    }
  };
  for (let i = 0; i < 20; i++) { top(); await new Promise(r => requestAnimationFrame(r)); }  // 先補滿
  up = gr = 0;
  const fr2 = []; let last = performance.now(), n = 0, cnt = 0;
  const end = last + 2000;
  while (performance.now() < end) { top(); await new Promise(r => requestAnimationFrame(r)); const now = performance.now(); fr2.push(now - last); last = now; n++; cnt += kind === 'enemy' ? Game.eBullets.length : Game.bullets.length; }
  Game.update = fu; GLR.render = fr;
  fr2.sort((a, b) => a - b);
  const avg = fr2.reduce((a, b) => a + b, 0) / fr2.length;
  const res = { avg: Math.round(avg), p95: Math.round(fr2[Math.floor(fr2.length * 0.95)]), max: Math.round(fr2[fr2.length - 1]), up: Math.round(up / n), gr: Math.round(gr / n), cnt: Math.round(cnt / n) };
  Game.bullets = []; Game.eBullets = [];
  return res;
}, kind, N);

for (const [kind, name, list] of [['laser', '雷射', NS], ['intercept', '雷射＋攔截', NS], ['enemy', '敵彈', NS]]) {
  console.log(`== ${name}（每段 2 秒；一幀 ms：平均／95%／最慢；邏輯、畫面＝每幀平均 ms；60fps ＝ 16.7ms）`);
  for (const N of list) {
    const r = await run(kind, N);
    console.log(`  ${String(N).padStart(6)} 顆（實際平均 ${r.cnt}）：一幀 ${r.avg}／${r.p95}／${r.max}　邏輯 ${r.up}　畫面 ${r.gr}`);
    if (r.p95 > 200) break;  // 已經卡死了，不用再加
  }
}
await b.close();
