// 散彈新終極升級的畫面截圖（2026-10-09）：火毯（彈丸消失的地方留火）、逆襲（船身紅光＋小條）＋無傷連殺小條、群戰＋空格苦行小條
//   用法：node perf/scattershot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
const start = (path, final, chain, parts) => p.evaluate((path, final, chain, parts) => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'scatter');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'scatter', path, final }; Game.refreshWeapon();
  Game.parts = parts; Game.chain = chain; Game.socks = chain.map(() => []); Game.recalc();
  Game.player.hp = Game.player.maxHp = 1e9;
  Input.down = true; Input.keys.clear();
}, path, final, chain, parts);

// 1. 火毯：站著按住射擊 1.5 秒
await start('C', 0, ['weapon', null, null, null], {});
await wait(1500);
await p.screenshot({ path: `${dir}/散彈_火毯.png` });
console.log('火毯：地上的火', await p.evaluate(() => Game.flames.length), '團');

// 2. 逆襲＋輕裝甲 4 層：被打一下之後
await start('B', 0, ['weapon', null, null, null], { larmor: 4 });
await wait(1500);
await p.evaluate(() => { const P = Game.player; P.iframe = 0; P.streak = 7; Game.hurtPlayer(1, 'shot', P); });
await wait(400);
await p.screenshot({ path: `${dir}/散彈_逆襲.png` });
console.log('逆襲剩', await p.evaluate(() => Game.player.revengeT.toFixed(1)), '秒');

// 3. 群戰＋空格苦行的小條（群戰的層數照身邊的敵人）
await start('A', 0, ['weapon', null, null, null], {});
await wait(2500);
await p.screenshot({ path: `${dir}/散彈_群戰小條.png`, clip: { x: 0, y: 0, width: 760, height: 90 } });
await start('B', 1, ['weapon', 'rear', null, null], {});
await wait(800);
await p.screenshot({ path: `${dir}/散彈_空格苦行小條.png`, clip: { x: 0, y: 0, width: 760, height: 90 } });
await b.close();
