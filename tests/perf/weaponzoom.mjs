// 武器模型放大看：軍械庫的武器架（裝走的、鎖住的、新的）＋裝在船頭的武器（只截那一塊）→ art_lab/screenshots/武器_*.png
//   用法：node perf/weaponzoom.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 400, play: {} }); Game.unlockFresh = []; Screen.title(); });
// 飛船停在軍械庫中間（武器架下面），船頭朝上
const box = await p.evaluate(() => {
  const A = HUB.rooms.armory, s = Hub.ship; s.x = A.x + A.w / 2; s.y = A.y + 260; s.aim = -Math.PI / 2; Input.mouseMoved = false; Hub.update(0.016);
  const sx = x => (x - Hub.cam.x) * Hub.k, sy = y => (y - Hub.cam.y) * Hub.k, racks = HUB.zones.filter(z => z.kind === 'rack');
  return { x: sx(Math.min(...racks.map(z => z.x)) - 80), y: sy(racks[0].y - 60), width: (Math.max(...racks.map(z => z.x)) - Math.min(...racks.map(z => z.x)) + 160) * Hub.k, height: 300 * Hub.k };
});
await wait(500);
const clip = Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)]));
await p.screenshot({ path: SHOTS + '武器_架子和船.png', clip });
await p.evaluate(() => Hub.equip('plasma')); await wait(400);
await p.screenshot({ path: SHOTS + '武器_架子和船_電漿.png', clip });
await b.close();
console.log('done');
