// 空間格子前後比對：靶場「6 爆量」（散彈＋攔截＋迴旋＋環繞…，攔截子彈上千顆）按住射擊 15 秒，固定亂數，印出每秒的子彈數、敵彈數、總傷害
//   用法：GAME_DIR=<遊戲資料夾> node perf/gridcmp.js   （兩個版本各跑一次，輸出要一模一樣）
const T_ = require('../load_game').loadGame();
const { seed } = require('../rng');
const vm = require('vm'), G = T_.Game, Range = vm.runInThisContext('Range'), Input = vm.runInThisContext('Input');
seed(12345);
G.newRun('range', 'vanguard', 'laser');
Range.key('6');
const p = G.player, out = [];
let dmg = 0; const hurt = G.recordDamage; G.recordDamage = function (s, d, a) { dmg += d; return hurt.call(this, s, d, a); };
for (let f = 0; f < 60 * 15; f++) {
  const e = G.enemies[Math.floor(f / 30) % G.enemies.length];
  p.aim = Math.atan2(e.y - p.y, e.x - p.x); Input.down = true; p.wantFire = true;
  G.update(1 / 60); Range.tick(1 / 60);
  if (f % 60 === 59) out.push(`${(f + 1) / 60}s 子彈 ${G.bullets.length} 敵彈 ${G.eBullets.length} 傷害 ${dmg.toFixed(3)}`);
}
console.log(out.join('\n'));
