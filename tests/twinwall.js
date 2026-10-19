'use strict';
// 暫時的量測：雙子獵艦（boss4）王關裡，誰會卡進牆（Arena.f < 半徑一半）：跟機制檢查「王關場地」一樣的打法，跑很多次，印出卡牆的敵人和當時的狀態
//   用法：node twinwall.js [--n=30]
const { loadGame } = require('./load_game');
const T = loadGame(), { Game, Arena, MechCheck: M } = T;
const N = +((process.argv.find(a => a.startsWith('--n=')) || '').split('=')[1] || 30);
let fails = 0;
const seenKinds = {};
for (let r = 0; r < N; r++) {
  M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
  Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = 'boss4'; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true });
  Game.objs = [];
  const p = Game.player; p.maxHp = p.hp = 1e9;
  let first = null, n = 0, born = null, track = [];
  for (let f = 0; f < 60 * 20; f++) {
    Game.update(1 / 60);
    const tw = Game.enemies.filter(e => e.type === 'boss4'); if (tw.length === 2 && !born) born = tw.map(m => Math.round(m.x) + ',' + Math.round(m.y) + '(' + Arena.f(m.x, m.y).toFixed(0) + ')').join(' ') + ' 第' + f + '幀';
    if (tw.length === 2 && f < 80 && f % 4 === 0) track.push(tw.map(m => Math.round(m.x) + ',' + Math.round(m.y)).join('/'));
    for (const e of Game.enemies) if (!e.dead && Arena.f(e.x, e.y) < e.r * 0.5) {
      n++;
      const k = `${e.type}${e.t.boss ? '（王）' : ''} mode=${e.mode || '-'}`;
      seenKinds[k] = (seenKinds[k] || 0) + 1;
      if (!first && e.type === 'boss4' && e.pair) { const P = e.pair; first = 'P ' + Math.round(P.x) + ',' + Math.round(P.y) + ' f ' + Arena.f(P.x, P.y).toFixed(0) + ' 兩艘 ' + P.members.map(m => Math.round(m.x) + ',' + Math.round(m.y) + '(' + Arena.f(m.x, m.y).toFixed(0) + ')').join(' ') + ' '; }
      if (!first || first.startsWith('P ')) first += `第 ${(f / 60).toFixed(1)} 秒 ${k} 位置 ${Math.round(e.x)},${Math.round(e.y)} 離牆 ${Arena.f(e.x, e.y).toFixed(1)} 半徑 ${e.r} 速度 ${Math.round(Math.hypot(e.vx, e.vy))} spawnT ${(e.spawnT || 0).toFixed(2)} 場地 ${Arena.W}×${Arena.H}`;
    }
  }
  if (n) { fails++; console.log(`第 ${r} 局：卡牆 ${n} 次；出生 ${born}；軌跡 ${track.slice(0, 12).join(' → ')}`); }
}
console.log(`${N} 局有 ${fails} 局卡牆；卡牆的（幀數）：`, JSON.stringify(seenKinds));
