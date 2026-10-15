// ？事件節點截圖：航圖（？節點、寶藏星域金框）、事件畫面（黑市、星圖情報）、寶藏星域＋求救訊號的開場橫幅
//   用法：node perf/eventshot.mjs   → art_lab/screenshots/事件_航圖.png、事件_黑市.png、事件_星圖情報.png、事件_寶藏星域開場.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
const wait = ms => new Promise(r => setTimeout(r, ms));

// 航圖：找一張有星圖情報的圖，走到它前面、標好寶藏星域；另外裝上終焉護殼（狀態列顯示免死）
const info = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  let m, e;
  for (let i = 0; i < 80 && !e; i++) { m = genMap(); e = m.flat().find(n => n.type === 'event' && n.ev === 'chart'); }
  Game.map = m; Game.nodeById(e.evArg).hoard = true;
  Game.boons.ward = 1; Game.boons.taken = 1; Game.recalc();
  Game.showMap('已在航圖上標出寶藏星域（金色 ✦）');
  return `事件 ${m.flat().filter(n => n.type === 'event').map(n => n.ev).join('、')}，寶藏星域在第 ${Game.nodeById(e.evArg).L + 1} 層`;
});
await wait(400);
await p.screenshot({ path: SHOTS + '事件_航圖.png' });
console.log('存好 事件_航圖', info);

await p.evaluate(() => { Game.credits = 120; Game.openEvent({ id: 'shot', L: 2, k: 0, n: 1, type: 'event', next: [], ev: 'market' }); });
await wait(300);
await p.screenshot({ path: SHOTS + '事件_黑市.png' });
console.log('存好 事件_黑市');

await p.evaluate(() => { const e = Game.map.flat().find(n => n.ev === 'chart'); Game.openEvent(e); });
await wait(300);
await p.screenshot({ path: SHOTS + '事件_星圖情報.png' });
console.log('存好 事件_星圖情報');

// 寶藏星域＋求救訊號：第 1 區開場橫幅
await p.evaluate(() => {
  Game.node = { type: 'combat', L: 3, id: 'shot', next: [] };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, hoard: true, sos: true });
  const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9;
  Input.autoFire = false;
});
await wait(1700);
await p.screenshot({ path: SHOTS + '事件_寶藏星域開場.png' });
console.log('存好 事件_寶藏星域開場', await p.evaluate(() => `出場名單寶藏無人機 ${Game.combat.pending.filter(k => k === 'treasure').length}（場上 ${Game.enemies.filter(e => e.t.treasure).length}）`));
await b.close();
