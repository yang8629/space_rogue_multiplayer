// 拿掉背包模組＋飛船能力的截圖（2026-10-14）→ art_lab/screenshots/
//   選飛船畫面（堡壘號灰血、幻影號殘影的說明）、堡壘號被打後的灰血血條、幻影號衝刺留下的殘影（附近敵人追殘影）、精英獎勵（三選一＋電路擴充）、旗艦勝利畫面（沒有模組）
//   用法：node perf/shipabilityshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.title(); document.body.classList.add('detail'); });
await wait(500);
await p.screenshot({ path: SHOTS + '選飛船畫面_飛船能力.png' });
// 堡壘號：被打兩下，血條上的灰血
await p.evaluate(() => {
  Game.newRun('sandbox', 'bulwark', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  Game.combat.pending = []; Game.enemies = []; Game.combat.waveTimer = 1e9; Input.autoFire = false;
  const P = Game.player; P.iframe = 0; Game.hurtPlayer(30, 'shot', P); P.iframe = 0; Game.hurtPlayer(25, 'shot', P);
});
await wait(400);
await p.screenshot({ path: SHOTS + '堡壘號_灰血.png', clip: { x: 0, y: 0, width: 420, height: 110 } });
// 幻影號：衝刺留下殘影，附近的刺殼追殘影
await p.evaluate(() => {
  Game.newRun('sandbox', 'wraith', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  Game.combat.pending = []; Game.enemies = []; Game.combat.waveTimer = 1e9; Input.autoFire = false;
  const P = Game.player; P.hp = P.maxHp = 1e9;
  P.dashSX = P.x; P.dashSY = P.y; P.aim = 0; P.onDash();
  Game.decoys[0].t = 99;
  for (const [dx, dy] of [[-220, -120], [-260, 80], [-150, 160]]) { const e = new Enemy('brute', P.x + dx, P.y + dy, 1); e.spawnT = 0; e.rollCd = 99; Game.enemies.push(e); }
  P.x += 260; P.y -= 40;
  window.__hold = setInterval(() => { if (Game.decoys[0]) Game.decoys[0].t = 99; }, 50);
});
await wait(900);
const pos = await p.evaluate(() => { const d = Game.decoys[0]; return { x: (d.x - Game.cam.x) * ZOOM, y: (d.y - Game.cam.y) * ZOOM }; });
await p.screenshot({ path: SHOTS + '幻影號_殘影.png', clip: { x: Math.max(0, pos.x - 380), y: Math.max(0, pos.y - 240), width: 760, height: 480 } });
// 精英獎勵：一般三選一＋電路擴充
await p.evaluate(() => {
  clearInterval(window.__hold);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'elite', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 2, elites: 1 });
  Game.combatWon(); Screen.clickLock = 0;
});
await wait(500);
await p.screenshot({ path: SHOTS + '精英獎勵.png' });
// 旗艦勝利畫面：沒有模組
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'boss', L: 6, id: 'shot' };
  Game.startCombat({ level: 4, wavesTotal: 1, elites: 0, boss: true });
  Game.combatWon(); Screen.clickLock = 0;
});
await wait(500);
await p.screenshot({ path: SHOTS + '勝利畫面_還沒選.png' });
await b.close();
console.log('存好：選飛船畫面_飛船能力、堡壘號_灰血、幻影號_殘影、精英獎勵、勝利畫面_還沒選');
