// 哨兵號・砲台的截圖 → art_lab/screenshots/
//   基地停機位的哨兵號說明（按 Shift 的詳細）、衝刺後留下的砲台朝敵人開火
//   用法：node perf/turretshot.mjs [武器 id，預設 laser]   → 哨兵號_說明.png、哨兵號_砲台開火_<武器簡稱>.png（等 2.5 秒再截一張 _久.png：看停在場上的飛輪、重力井有沒有超過上限）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const W = process.argv[2] || 'laser';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.title(); });
await wait(500);
await p.evaluate(() => { CFG.UNLOCK_ALL = true; const z = Hub.zone('pad:sentry'), s = Hub.ship;  // 乾淨存檔的哨兵號是鎖住的：全部開放才看得到說明
   s.x = z.x; s.y = z.y + 30; s.vx = s.vy = 0; Hub.update(0.016); Hub.follow(1); document.body.classList.add('detail'); });
await wait(450);
await p.screenshot({ path: SHOTS + '哨兵號_說明.png' });
const N = await p.evaluate(W => WEAPONS[W].short, W);
// 砲台：玩家往左衝刺，砲台留在原地朝右邊的靶開火
await p.evaluate(W => {
  document.body.classList.remove('detail');
  Game.newRun('sandbox', 'sentry', W);
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  Game.combat.pending = []; Game.combat.waveTimer = 1e9; Input.autoFire = false;
  const P = Game.player; P.hp = P.maxHp = 1e9;
  Game.objs = [];
  Game.enemies = [new Enemy('brute', P.x + 260, P.y - 60, 40), new Enemy('dummy', P.x + 220, P.y + 90, 40)];
  for (const e of Game.enemies) { e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.rollCd = Infinity; }
}, W);
await wait(400);
await p.evaluate(() => { Input.keys.add('a'); Input.dash = true; setTimeout(() => Input.keys.delete('a'), 250); });
await wait(700);
const clip = await p.evaluate(() => { const t = Game.turrets[0] || Game.player; return { x: Math.max(0, (t.x - Game.cam.x) * ZOOM - 300), y: Math.max(0, (t.y - Game.cam.y) * ZOOM - 170), width: 640, height: 340 }; });
const count = () => p.evaluate(() => `砲台 ${Game.turrets.length} 座；砲台子彈 ${Game.bullets.filter(b => b.turret && !b.dead).length} 發；你的停留彈 ${typeof ownShots === 'function' ? ownShots(Game.player, 'disc').length + ownShots(Game.player, 'well').length : '—'}`);
await p.screenshot({ path: SHOTS + `哨兵號_砲台開火_${N}.png`, clip });
console.log(await count());
await wait(1800);
await p.screenshot({ path: SHOTS + `哨兵號_砲台開火_${N}_久.png`, clip });
console.log('2.5 秒後：', await count());
await b.close();
console.log('done');
