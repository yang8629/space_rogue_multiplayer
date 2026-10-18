// 新玩家開局會看到的畫面（不按 Shift）→ art_lab/screenshots/開局_*.png
//   標題、選飛船（＋按 Shift 的詳細說明）、選武器、起始晶片、第一次的航圖、第一場戰鬥
//   用法：node perf/startflowshot.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.clear(); localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); });
const shot = async name => { await wait(500); await p.screenshot({ path: SHOTS + `開局_${name}.png` }); };
await shot('1標題');
await p.evaluate(() => Screen.title()); await shot('2選飛船');
await p.evaluate(() => document.body.classList.add('detail')); await shot('2選飛船_詳細');
await p.evaluate(() => document.body.classList.remove('detail'));
await p.evaluate(() => Screen.chipPick('run', 'vanguard', 'laser')); await shot('4起始晶片');
await p.evaluate(() => Game.newRun('run', 'vanguard', 'laser', NORMAL_IDS[0])); await shot('5航圖');
await p.evaluate(() => { const n = Game.reachable()[0]; Game.enterNode(n); }); await wait(1500); await shot('6第一場戰鬥');
await b.close();
console.log('done');
