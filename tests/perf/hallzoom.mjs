// 中央大廳放大看：能量導管（機庫、軍械庫 → 發射台）、跑道、終端機 → art_lab/screenshots/大廳_*.png
//   用法：node perf/hallzoom.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Game.unlockFresh = []; Screen.title(); });
const box = await p.evaluate(() => {
  const H = HUB.rooms.hall, s = Hub.ship; s.x = H.x + H.w / 2; s.y = H.y + H.h / 2; s.aim = -Math.PI / 2; Input.mouseMoved = false; Hub.update(0.016);
  const sx = x => (x - Hub.cam.x) * Hub.k, sy = y => (y - Hub.cam.y) * Hub.k;
  return { x: Math.max(0, sx(H.x - 80)), y: Math.max(0, sy(H.y)), width: (H.w + 160) * Hub.k, height: Math.min(1000 - Math.max(0, sy(H.y)), H.h * Hub.k) };
});
for (const k of [0, 1]) { await wait(700); await p.screenshot({ path: SHOTS + '大廳_' + k + '.png', clip: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])) }); }
await b.close();
console.log('done');
