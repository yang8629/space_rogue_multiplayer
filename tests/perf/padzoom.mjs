// 機庫停機位特寫（看燈座有沒有被蓋住）→ art_lab/screenshots/基地_停機位特寫.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
const c = await p.evaluate(() => { const z = Hub.zone('pad:bulwark'), h = HUB.rooms.hangar, s = Hub.ship; s.x = h.cx; s.y = h.cy + 130; Hub.follow(); return [(z.x - Hub.cam.x) * Hub.k, (z.y - Hub.cam.y) * Hub.k]; });
await new Promise(r => setTimeout(r, 300));
await p.screenshot({ path: SHOTS + '基地_停機位特寫.png', clip: { x: c[0] - 110, y: c[1] - 110, width: 220, height: 220 } });
await b.close();
