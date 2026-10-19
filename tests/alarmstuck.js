'use strict';
// 警報艇（和寶藏無人機，共用 Enemy.flee）逃跑時多常卡在牆邊：大地圖一般戰，警報艇響了，玩家一直追（距離 180 以外就靠近）
//   每一局 15 秒，量「被追著、幾乎不動（每秒 < 20）」的時間，以及其中貼著牆（離牆 < 半徑 + 12）的時間
//   用法：node alarmstuck.js [--n=40] [--type=alarm|treasure]
const { loadGame } = require('./load_game');
const T = loadGame(), { Game, Arena, CFG } = T;
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const N = +(arg('n') || 40), TYPE = arg('type') || 'alarm';
const rng = require('./rng'); rng.seed(12345);
const dt = 1 / 60, SECS = 15;
let stuckAll = 0, wallAll = 0, total = 0, runsStuck = 0, longest = 0;
for (let r = 0; r < N; r++) {
  Game.chapterId = 1; Game.newRun('run', 'vanguard', 'laser');
  Game.sector = 2; Game.node = { type: 'combat', L: 3, id: 'p' + r };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  if (Arena.rect) { console.log('不是大地圖'); process.exit(1); }
  const C = Game.combat; C.pending = []; Game.enemies = [];
  const P = Game.player;
  const k = Math.floor(Math.random() * Arena.areas.length);
  const [ax, ay] = Arena.randomIn(k, 60);
  Game.spawnEnemy(TYPE); const e = Game.enemies[Game.enemies.length - 1];
  e.spawnT = 0; e.x = ax; e.y = ay; e.home = [ax, ay]; e.zone = Arena.zoneOf(ax, ay); e.alert = true;
  e.hp = e.maxHp = 1e9; e.hurt(1, 0, 0, 'direct');  // 被打到：警報艇開始響、寶藏無人機開始逃
  // 玩家從警報艇附近 250 的空地開始
  let best = null; for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, x = ax + Math.cos(a) * 250, y = ay + Math.sin(a) * 250; if (Arena.f(x, y) > 40 && Arena.zoneOf(x, y) === e.zone) { best = [x, y]; break; } }
  if (!best) { r--; continue; }
  [P.x, P.y] = best; P.zone = e.zone; P.hp = P.maxHp = 1e9;
  let stuck = 0, wall = 0, run = 0;
  for (let f = 0; f < SECS * 60; f++) {
    Game.time += dt;
    const x0 = e.x, y0 = e.y;
    const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1;
    if (d > 180) { const nav = Arena.navTo(P, e.x, e.y); const [mx, my] = nav || [dx / d, dy / d]; P.x += mx * 230 * dt; P.y += my * 230 * dt; }
    Arena.collide(P, P.r || 14, null);
    e.update(dt, P);
    if (e.dead) break;
    const sp = Math.hypot(e.x - x0, e.y - y0) / dt;
    if (sp < 20) { stuck += dt; run += dt; if (Arena.f(e.x, e.y) < e.r + 12) wall += dt; longest = Math.max(longest, run); } else run = 0;
  }
  stuckAll += stuck; wallAll += wall; total += SECS;
  if (stuck > 3) runsStuck++;
}
console.log(`${TYPE}：${N} 局，每局被追 ${SECS} 秒`);
console.log(`  幾乎不動的時間 ${(stuckAll / total * 100).toFixed(1)}%（其中貼牆 ${(wallAll / total * 100).toFixed(1)}%）｜不動超過 3 秒的局 ${runsStuck}/${N}｜最長連續不動 ${longest.toFixed(1)} 秒`);
