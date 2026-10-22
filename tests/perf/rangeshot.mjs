// 軍械庫靶場：站在標靶機左邊朝右射一陣子（看傷害數字、每秒傷害）→ art_lab/screenshots/靶場_*.png
//   用法：node perf/rangeshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Game.unlockFresh = []; Screen.title(); const T = HUB.targets[1], s = Hub.ship; s.x = T.x - 260; s.y = T.y; Input.mouseMoved = false; s.aim = 0; Input.down = true; });
for (let i = 0; i < 12; i++) { await p.evaluate(() => { const T = HUB.targets[Math.floor(Hub.t * 1.5) % 3], s = Hub.ship; s.aim = Math.atan2(T.y - s.y, T.x - s.x); }); await wait(120); }
await p.screenshot({ path: SHOTS + '靶場_射擊中.png' });
await p.evaluate(() => { Input.down = false; });
await b.close();
console.log('done');
