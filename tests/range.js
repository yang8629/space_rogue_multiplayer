'use strict';
// 靶場：標靶打不死、不動、會回原位；DPS 與估算接近；換標靶、清數據、慢動作
const { loadGame } = require('./load_game');
const T = loadGame();
const G = T.Game;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else console.log('ok  ', m); };
const R = vm => vm;  // eslint 用不到
const Range = require('vm').runInThisContext('Range');
const Input = require('vm').runInThisContext('Input');

G.newRun('range', 'vanguard', 'laser');
ok(G.state === 'play' && G.combat.range && G.enemies.length === 1 && G.chain.length === 6, 'range starts with 1 dummy and 6 empty slots');
// 瞄準標靶開火 10 秒
const e = G.enemies[0];
Input.down = true;
const aimAt = () => { const p = G.player; Input.mx = (e.x - G.cam.x) * 1; Input.my = (e.y - G.cam.y) * 1; };
for (let i = 0; i < 600; i++) { aimAt(); G.player.aim = Math.atan2(e.y - G.player.y, e.x - G.player.x); G.update(1 / 60); }
ok(!e.dead && G.enemies.length === 1 && Range.total > 0, `dummy survives (total ${Math.round(Range.total)}, hits ${Range.hits})`);
const d = Range.dps(), est = G.stats.dpsEst;
ok(Math.abs(d - est) / est < 0.25, `measured DPS ${Math.round(d)} ≈ estimate ${Math.round(est)}`);
ok(Math.hypot(e.x - e.hx, e.y - e.hy) < 30, 'dummy stays near its home');
Range.key('2');
ok(G.enemies.length === 8 && Range.total === 0, 'key 2: line of 8, stats cleared');
Range.key('3'); ok(G.enemies.length === 19, `key 3: pack of ${G.enemies.length}`);
Range.key('5'); for (let i = 0; i < 600; i++) G.update(1 / 60);
ok(Range.live && G.combat.wave >= 1 && (G.kills > 0 || G.enemies.some(x => !x.t.dummy)), `key 5: live waves (wave ${G.combat.wave}, ${G.enemies.length} enemies, ${G.kills} kills)`);
G.player.iframe = 0; G.player.dashT = 0; G.hurtPlayer(9999);  // 先清掉衝刺無敵（實戰的敵人會打到飛船）
 ok(!G.player.dead && G.player.hp === G.player.maxHp && G.state === 'play', 'live: ship does not die in range');
Range.key('2'); ok(!Range.live && G.enemies.length === 8 && G.enemies.every(x => x.t.dummy), 'key 2 after live: back to dummies');
Range.key('t'); ok(Range.slow, 'key t: slow motion on');
Range.key('r'); ok(Range.total === 0, 'key r: clear');
// 觸發＋分裂：開火的片數帶觸發，命中後展開 3 倍
G.weapon = { id: 'blade', path: 'B', final: null }; G.refreshWeapon();
G.chain = ['weapon', T.chipId('trigger', 1, 1), null, null, null, null]; G.socks = [[], ['split']]; G.recalc();  // 分裂插在觸發器上 = 作用在回響
const bc = WEAPONS.blade.base.count;  // 相刃基礎型的片數（分裂後 ×3）
ok(G.stats.count === bc && G.stats.layers[0] && G.stats.layers[0].count === bc * 3, `blade+trigger+split: fire ${G.stats.count}, on-hit ${G.stats.layers[0] && G.stats.layers[0].count}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
