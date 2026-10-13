'use strict';
const { loadGame } = require('./load_game');
const T = loadGame();
const { Game, Net, Player, SHIPS, render } = T;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };

// ---- 房主：假連線，攔截送出的訊息 ----
let sent = [];
Net.role = 'host'; Net.linked = true; Net.resetStats();
// 房主這邊每個隊友一筆（Net.peers）；這裡只有一個 2P
const q2 = { conn: { open: true, send: m => sent.push(JSON.parse(JSON.stringify(m))), close() {} }, slot: 2, linked: true, inRoom: true, cleared: [] };
Net.peers = [q2]; Net.refreshPeers();
Net.myPick = { ship: 'bulwark', weapon: 'plasma', chip: 'amp' }; q2.pick = Net.cleanPick({ ship: 'wraith', weapon: 'railgun', chip: 'weapon' }); Net.startHost(); const packedMap = Net.packMap(Game.map), mapBoss = Game.bossId; Game.startCombat({ sandbox: true, level: 0 });
assert(Game.inventory[0] === 'amp' && Game.chain[1] === null && Game.mates[0].L.chain[1] === null && Game.mates[0].L.inventory[0] === null, 'start chips: host amp (component -> inventory), mate invalid chip rejected');
assert(Game.state === 'play' && Game.mode === 'coop', 'host started coop combat');
assert(Game.mates[0] && Game.mates[0].L.weapon.id === 'railgun' && Game.weapon.id === 'plasma', 'separate loadouts');
assert(sent.some(m => m.t === 'start' && m.ship === 'bulwark'), 'start message sent');

// 隊友持續開火、衝刺，房主自己也開火；跑 90 秒遊戲時間
Game.player.hp = Game.player.maxHp = 1e6; Game.mates[0].hp = Game.mates[0].maxHp = 1e6;
T.Input = undefined;
let frames = 0, maxBytes = 0, mateBullets = 0, railSnap = false;  // railSnap：整段期間有沒有同步過隊友的軌道砲子彈（最後一份可能已經打完、沒有子彈）
// 雙人敵人數量 ×2.5 之後，150 秒有時第 1 波還打不完（偶爾失敗）：最多等 300 秒，打完第 1 波（且跑滿 60 秒）就停
for (let i = 0; i < 300 * 60 && !(Game.combat.wave >= 2 && i >= 60 * 60); i++) {
  Net.applyInput({ t: 'i', x: 1300 + Math.sin(i / 50) * 200, y: 800, vx: 0, vy: 0, a: i / 30, mv: 1, dT: 0, ds: Math.floor(i / 120), f: 1 }, q2);
  Game.update(1 / 60);
  frames++;
  mateBullets = Math.max(mateBullets, Game.bullets.filter(b => b.owner).length);
  for (const m of sent) if (m.t === 's') {
    maxBytes = Math.max(maxBytes, JSON.stringify(m).length);
    if (m.pal && m.pal.length >= 1 && m.b.some(b => b[6] === 'rail')) railSnap = true;
  }
  if (sent.length > 50) sent = sent.slice(-5);
}
assert(Game.combat.wave >= 2, `waves progressed (wave ${Game.combat.wave}, kills ${Game.kills})`);
if (Game.combat.wave < 2) console.error('  沒打完第 1 波：剩下的敵人 ' + Game.enemies.filter(e => !e.dead).map(e => `${e.type}@${Math.round(e.x)},${Math.round(e.y)} HP${Math.round(e.hp)} 模式${e.mode} 速度${Math.round(Math.hypot(e.vx, e.vy))}`).join(' ') + '；待生 ' + Game.combat.pending.length + '；物件 ' + Game.objs.map(o => `${o.type}@${Math.round(o.x)},${Math.round(o.y)} r${Math.round(o.r || 0)}`).join(' ') + '；房主 ' + Math.round(Game.player.x) + ',' + Math.round(Game.player.y) + ' 隊友 ' + Math.round(Game.mates[0].x) + ',' + Math.round(Game.mates[0].y) + '；大地圖 ' + !Arena.rect);  // 偶爾失敗時看卡在哪
assert(mateBullets > 0, `teammate bullets exist (max ${mateBullets})`);
assert(Game.weapon.id === 'plasma' && Game.wp.shape === 'orb', 'host loadout restored after withLoadout');
console.log('     largest snapshot', (maxBytes / 1024).toFixed(1), 'KB');

// 傷害歸屬：房主沒開火 → 傷害全在隊友身上
const sumD = R => Object.values(R.dmg).reduce((a, b) => a + b, 0);
assert(sumD(Game.mates[0].L.R) > 0 && sumD(Game.runStats) === 0 && Game.mates[0].L.R.kills > 0 && Game.runStats.kills === 0,
  `damage attributed to shooter (mate ${Math.round(sumD(Game.mates[0].L.R))}, host ${Math.round(sumD(Game.runStats))}, mate kills ${Game.mates[0].L.R.kills})`);
Net.sendDmg(); const dmgMsg = sent.filter(m => m.t === 'dmg').pop();
assert(dmgMsg && dmgMsg.team[2].kills === Game.mates[0].L.R.kills, 'dmg sync message');
// 隊友的子彈用隊友武器（軌道砲 rail）
const snap = sent.filter(m => m.t === 's').pop();  // 最後一份同步資料（下面測隊友套用快照用）
assert(railSnap, 'snapshot carries teammate rail bullets');

// 擊墜：隊友被打到 0
Game.mates[0].hp = 1; Game.mates[0].iframe = 0; Game.mates[0].dashT = 0;
Game.hurtPlayer(999, 'test', Game.mates[0]);
assert(Game.mates[0].dead && Game.state === 'play', 'mate down, game continues');
Game.player.hp = 1; Game.player.iframe = 0; Game.player.dashT = 0;
Game.hurtPlayer(999, 'test', Game.player);
assert(Game.state === 'dead' && sent.some(m => m.t === 'over'), 'both down -> over sent');

// ---- 隊友：吃房主的快照 ----
Net.close();

Net.role = 'client'; Net.linked = true; Net.slot = 2; Net.myPick = { ship: 'wraith', weapon: 'railgun', chip: 'boomerang' };
sent = [];
Net.conn = { open: true, send: m => sent.push(m), close() {} };
Net.startClient({ ship: 'bulwark', map: packedMap, bossId: mapBoss }); Game.startCombat({ sandbox: true, level: 0 });
assert(Game.state === 'play' && Game.mates[0].ship === SHIPS.bulwark, 'client started');
Net.applySnap(snap);
assert(Game.enemies.length === snap.e.length && Game.bullets.length === snap.b.length, `client applied snapshot (${Game.enemies.length} enemies, ${Game.bullets.length} bullets)`);
for (let i = 0; i < 120; i++) { Game.update(1 / 60); render(); }
Net.onDmg(dmgMsg);
assert(Object.values(Game.runStats.dmg).reduce((a, b) => a + b, 0) > 0 && Game.runStats.kills === dmgMsg.team[2].kills, 'client got its own damage from host');
// 盾衛：隊友被夾在牆和盾中間（飛船推不出去，改推盾衛）。隊友這邊的敵人是房主傳來的普通物件（沒有 push），不能當掉
{
  const P = Game.player, ST = T.ENEMY_TYPES.shield, rect = T.Arena.rect;
  T.Arena.rect = rect || true;  // 方形場地：場地邊緣就是牆
  P.x = P.r; P.y = 500; P.dashT = 0;
  const e = { id: 9999, type: 'shield', t: ST, r: ST.radius, x: P.r + 30, y: 500, vx: 0, vy: 0, shieldA: Math.PI, spawnT: 0, dead: false };
  let err = null, x0 = e.x;
  try { Game.shieldBlock(e, P); } catch (ex) { err = ex.message; }
  T.Arena.rect = rect;
  assert(!err && e.x > x0, `client pinned by shield guard against wall: no crash, guard pushed back (${err || `${Math.round(x0)} → ${Math.round(e.x)}`})`);
}
const rows = Net.teamRows(); assert(rows[1].me && rows[1].dmg > 0 && rows[0].dmg === 0, 'team rows: 2P is me with damage');
assert(Net.teamSummaryHtml().includes('多人傷害結算'), 'team summary html');
assert(sent.some(m => m.t === 'i'), 'client sends input');
const rec = Net.buildRecord('dead'); assert(rec.coop && rec.coop.role === '隊友' && String(rec.chain[1]).startsWith('迴旋'), 'coop record built: ' + JSON.stringify(rec.coop).slice(0, 160));
// 結束訊息帶擊毀原因；回到房間
Game.player.hp = 37; Game.player.dead = false; Game.state = 'play';
Net.onData({ t: 'over', wave: 5, cause: '蟲群（撞擊）' });
assert(Game.player.dead && Game.player.hp === 0 && Game.lastHit === '蟲群（撞擊）' && Game.state === 'dead', 'over message: client marked dead with cause');
const rec2 = Net.buildRecord('dead'); assert(rec2.hp === 0 && rec2.cause === '蟲群（撞擊）', 'record has hp 0 and cause');
sent = [];
Net.backToRoom();
assert(Game.state === 'lobby' && Net.linked && sent.some(m => m.t === 'room'), 'back to room keeps connection');
Net.onData({ t: 'pick' });
assert(Game.state === 'pick', 'host start pulls client into pick');
Net.onData({ t: 'hello', v: 'old' });  // 版號檢查（房主端才處理，這裡只確認不當掉）
// 房主：隊友沒回房間不能開始
Net.close(); Net.role = 'host'; sent = [];
const q3 = { conn: { open: true, send: m => sent.push(m), close() {} }, slot: 2, linked: true, inRoom: false, cleared: [] };
Net.peers = [q3]; Net.refreshPeers();
Net.renderLobby(); Net.beginPick();
assert(Game.state === 'lobby' && !sent.some(m => m.t === 'pick'), 'host cannot start before mate returns');
Net.onData({ t: 'room' }, q3); Net.beginPick();
assert(Game.state === 'pick' && sent.some(m => m.t === 'pick'), 'host starts after mate returns');
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASSED');
