// 軍械台截圖（軌道砲・攻城砲 的最後二選一）→ art_lab/screenshots/軍械台_攻城砲.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => { Game.newRun('run', 'bulwark', 'railgun'); Game.weapon.path = 'B'; Game.refreshWeapon(); Game.state = 'armory'; Game.armorySource = 'armory'; Game.view(); });
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: SHOTS + '軍械台_攻城砲.png' });
await b.close();
