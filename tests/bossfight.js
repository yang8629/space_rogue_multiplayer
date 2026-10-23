// 旗艦檢查（不量平衡）：熟練電腦打指定的王，飛船血量給很厚（不會死），看打多久、掉多少血、被什麼打、光束打中幾次、砲塔打掉幾座
//   用法：node bossfight.js [王=boss3,boss4,boss5] [局數=3] [星區=3] [王血量倍數=1] [武器=全部，例 drone,laser]
//   每局印「打王 %」：打在王身上的傷害佔總傷害幾成（其餘打到護衛、召喚的蟲群）
'use strict';
const T_ = require('./load_game').loadGame();
const G = T_.Game; G.simFast = true;
const { seed, splitEnemyRng, noFx, resetRun } = require('./rng');
splitEnemyRng(T_); noFx();
const QB = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
const bosses = (process.argv[2] || 'boss3,boss4,boss5').split(','), N = +(process.argv[3] || 3), SEC = +(process.argv[4] || 3), HPK = +(process.argv[5] || 1);  // HPK：王的血量 ×（只看流程時調低）
const weapons = process.argv[6] ? process.argv[6].split(',') : Object.keys(T_.WEAPONS);
for (const id of bosses) {
  const rows = [];
  for (let s = 0; s < N; s++) {
    seed(9100 + s * 53); resetRun(T_); QB.resetBot();
    const w = weapons[s % weapons.length];
    G.newRun('run', 'vanguard', w, null);
    G.sector = SEC; G.bossId = id; G.node = { id: 0, type: 'boss', L: 6, next: [] };
    G.startCombat({ level: (SEC - 1) * 7 + 6, wavesTotal: 1, elites: 0, boss: true });
    const p = G.player; p.hp = p.maxHp = 1e5;
    let t = 0, turrets = 0;
    const taken0 = { ...G.runStats.taken };
    let cut = false; const seenB = new Set();
    while (G.state === 'play' && t < 400) {
      QB.bot(p); G.update(1 / 60); t += 1 / 60;
      if (!cut && HPK < 1) { const B = G.enemies.filter(e => e.t.boss && !e.share); if (B.length) { cut = true; for (const e of B) { e.maxHp *= HPK; e.hp = e.maxHp; } } }
      turrets = G.enemies.filter(e => e.t.turret && e.dead).length || turrets;
      for (const e of G.enemies) if (e.t.boss && !e.share) seenB.add(e);  // 打死後會從清單拿掉：先記住，算打王的傷害
    }
    const tk = G.runStats.taken, by = Object.entries(tk).map(([k, v]) => [k, v - (taken0[k] || 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = by.reduce((a, [, v]) => a + v, 0);
    const bossDmg = [...seenB].reduce((a, e) => a + e.maxHp - Math.max(0, e.dead ? 0 : e.hp), 0);
    const core = G.enemies.find(e => e.t.boss && !e.share && !e.dead), tl = G.enemies.filter(e => e.t.turret && !e.dead).length;
    rows.push(`${w} ${G.state === 'play' ? '超時' : '擊沉'} ${Math.round(t)}秒${core ? ` 王剩 ${Math.round(core.hp / core.maxHp * 100)}%` : ''}${G.bossId === 'boss5' ? ` 砲塔剩 ${tl}` : ''} 傷害 ${Math.round(G.totalDmg())}（打王 ${Math.round(bossDmg / Math.max(1, G.totalDmg()) * 100)}%） 掉血 ${Math.round(total)}｜${by.slice(0, 4).map(([k, v]) => `${k} ${Math.round(v)}`).join('、')}`);
  }
  console.log(`== ${T_.ENEMY_TYPES[id].name}（星區 ${SEC}，${N} 局，只拿武器、血量很厚）\n  ` + rows.join('\n  '));
}
