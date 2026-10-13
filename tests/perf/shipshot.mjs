// 飛船外觀截圖：四艘船在靶場（移動中、裝零件、衝刺中）各截一張放大圖，再截選飛船畫面
// 用法：node perf/shipshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '.';
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const page = await b.newPage();
page.on('pageerror', e => console.log('頁面錯誤', e.message));
await page.goto(url); await new Promise(r => setTimeout(r, 1200));
const shots = [];
for (const [id, setup] of [['vanguard', ''], ['bulwark', 'armor'], ['wraith', 'booster'], ['gate', 'hot']]) {
  const pos = await page.evaluate((id, setup) => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('range', id, 'laser');
    const p = Game.player;
    if (setup === 'armor') Game.parts = { armor: 3, sink: 2 };
    if (setup === 'booster') { Game.parts = { booster: 3, sensor: 2 }; Game.setModule('drone'); }
    Game.recalc && Game.recalc();
    Input.joy = { bx: 0, by: 0, x: -60, y: 0 };  // 搖桿往左推：移動中（噴焰）
    window.__keep = setInterval(() => { p.x = Arena.start.x; p.y = Arena.start.y; if (setup === 'hot') p.dashT = 0.2; }, 5);
    return { x: (p.x - Game.cam.x) * ZOOM, y: (p.y - Game.cam.y) * ZOOM };
  }, id, setup);
  await new Promise(r => setTimeout(r, 400));
  const p2 = await page.evaluate(() => { const p = Game.player; return { x: (p.x - Game.cam.x) * ZOOM, y: (p.y - Game.cam.y) * ZOOM }; });
  const f = `${out}/ship_${id}.png`;
  await page.screenshot({ path: f, clip: { x: p2.x - 60, y: p2.y - 60, width: 120, height: 120 } });
  await page.evaluate(() => { clearInterval(window.__keep); Input.joy = null; });
  shots.push(f);
}
await page.evaluate(() => { Game.state = 'title'; Screen.select('run'); });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${out}/ship_select.png` });
console.log(shots.join('\n'));
await b.close();
