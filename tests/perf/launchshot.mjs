// 出發動畫：發射台選好起始晶片後，每隔一段時間截一張 → art_lab/screenshots/出發動畫_*.png；最後確認到了航圖
//   回航的過場：從靶場離開回到基地，同樣每隔一段截一張 → 回航過場_*.png；最後確認交還操作
//   用法：node perf/launchshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Game.unlockFresh = []; Screen.title(); const L = Hub.zone('launch'), s = Hub.ship; s.x = L.x - 120; s.y = L.y - 60; s.aim = -0.5; Input.mouseMoved = false; });
await wait(300);
await p.evaluate(() => Screen.depart()); await wait(200);
await p.click('[data-act="startchip"]');
const t0 = Date.now();
for (const ms of [250, 800, 1150, 1450, 1650, 1850]) {
  await wait(ms - (Date.now() - t0));
  await p.screenshot({ path: SHOTS + `出發動畫_${ms}ms.png` });
}
await wait(1200);
console.log('動畫完：', await p.evaluate(() => Game.state), '（要是 map）');
// 回航：進靶場再離開（quitRun 回基地）
await p.evaluate(() => { Game.newRun('range', Hub.shipId, Hub.weaponId); }); await wait(800);
await p.evaluate(() => Game.quitRun());
const t1 = Date.now();
for (const ms of [100, 400, 700, 1000, 1300, 1700, 2100]) {
  await wait(ms - (Date.now() - t1));
  await p.screenshot({ path: SHOTS + `回航過場_${ms}ms.png` });
}
console.log('回航完：', await p.evaluate(() => `${Hub.seq ? '還在播（錯）' : '交還操作'}、飛船在 ${Math.round(Hub.ship.x)},${Math.round(Hub.ship.y)}（大廳正中 ${HUB.spawn.x},${HUB.spawn.y}）`));
await b.close();
