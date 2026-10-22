// 操作台放大看：三個操作台（軍械庫、晶片實驗室、戰績室；飛船停在旁邊 = 靠近變亮）＋戰績室的獎盃牆 → art_lab/screenshots/操作台_*.png
//   用法：node perf/consolezoom.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 400, play: {} }); Game.unlockFresh = []; Screen.title(); });
const names = { armory: '軍械庫', chips: '晶片庫', stats: '戰績' };
for (const id of Object.keys(names)) {
  const box = await p.evaluate(id => {
    const z = HUB.zones.find(z => z.kind === 'console' && z.id === id), s = Hub.ship;
    s.x = z.x + 70; s.y = z.y + 40; s.aim = Math.PI; Input.mouseMoved = false; Hub.update(0.016);
    const sx = x => (x - Hub.cam.x) * Hub.k, sy = y => (y - Hub.cam.y) * Hub.k;
    return { x: sx(z.x - 90), y: sy(z.y - 70), width: 200 * Hub.k, height: 170 * Hub.k };
  }, id);
  await wait(400);
  await p.screenshot({ path: SHOTS + '操作台_' + names[id] + '.png', clip: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])) });
}
// 戰績室上牆的獎盃
const box = await p.evaluate(() => {
  const R = HUB.rooms.records, s = Hub.ship; s.x = R.x + R.w / 2; s.y = R.y + 200; Hub.update(0.016);
  const sx = x => (x - Hub.cam.x) * Hub.k, sy = y => (y - Hub.cam.y) * Hub.k;
  return { x: sx(R.x + R.w / 2 - 200), y: sy(R.y - 20), width: 400 * Hub.k, height: 120 * Hub.k };
});
await wait(400);
await p.screenshot({ path: SHOTS + '操作台_獎盃.png', clip: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])) });
await b.close();
console.log('done');
