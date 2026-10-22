// 電路擴充圖示（2026-10-13 ⚡ → ⊞，⚡ 只給能量）：補給站、精英獎勵、擊沉旗艦二選一
//   用法：node perf/sloticonshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Game.newRun('run', 'vanguard', 'laser'); Game.credits = 300; Game.node = { type: 'shop', L: 2, id: 's' }; Game.openShop(); });
await wait(400); await p.screenshot({ path: `${dir}/圖示_補給站.png` });
await p.evaluate(() => { Game.node = { type: 'elite', L: 3, id: 'x' }; Game.startCombat({ level: 3, wavesTotal: 1, elites: 1 }); Game.enemies = []; Game.combatWon(); });
await wait(400); await p.screenshot({ path: `${dir}/圖示_精英獎勵.png` });
await p.evaluate(() => { Game.node = { type: 'boss', L: 6, id: 'y' }; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true }); Game.enemies = []; Game.combatWon(); });
await wait(400); await p.screenshot({ path: `${dir}/圖示_旗艦二選一.png` });
console.log(await p.evaluate(() => [...document.body.innerText.matchAll(/[⊞⚡][^\n]{0,20}/g)].map(m => m[0]).join('｜')));
await b.close();
