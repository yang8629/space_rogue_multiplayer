// 基地房間截圖：飛船停在指定房間，拍一張 → art_lab/screenshots/基地_<房間>.png
//   用法：node perf/hubroomshot.mjs [機庫中間|戰績室|觀景台|中央大廳|軍械庫|晶片實驗室|發射甲板]（不給 = 全部）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
// 每個房間：飛船停的位置（照 HUB 的配置算）
const SPOTS = {
  機庫中間: 'const h = HUB.rooms.hangar; return [h.cx || h.x + h.w / 2, (h.cy || h.y + h.h / 2) + 130];',
  戰績室: 'const r = HUB.rooms.records; return [r.x + r.w / 2, r.y + r.h - 60];',
  觀景台: 'const r = HUB.rooms.deck; return [r.x + r.w / 2, r.y + r.h - 60];',
  中央大廳: 'const r = HUB.rooms.hall; return [r.x + r.w / 2, r.y + r.h / 2];',
  軍械庫: 'const r = HUB.rooms.armory; return [r.x + r.w / 2, r.y + r.h / 2];',
  晶片實驗室: 'const r = HUB.rooms.lab; return [r.x + r.w / 2, r.y + r.h - 60];',
  發射甲板: 'const r = HUB.rooms.bay; return [r.x + r.w / 2, r.y + r.h / 2];',
};
const want = process.argv[2] ? [process.argv[2]] : Object.keys(SPOTS);
for (const name of want) {
  const ok = await p.evaluate(code => {
    const [x, y] = new Function(code)(), s = Hub.ship;
    if (!isFinite(x)) return false;
    s.x = x; s.y = y; s.vx = s.vy = 0; Hub.follow(); return true;
  }, SPOTS[name]);
  if (!ok) { console.log(name, '找不到房間'); continue; }
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: SHOTS + `基地_${name}.png` });
  if (name === '機庫中間') { const c = await p.evaluate(() => { const h = HUB.rooms.hangar; return [(h.cx - Hub.cam.x) * Hub.k, (h.cy - Hub.cam.y) * Hub.k]; }); await p.screenshot({ path: SHOTS + '基地_機庫轉盤特寫.png', clip: { x: c[0] - 160, y: c[1] - 160, width: 320, height: 320 } }); }
  console.log('拍好', name);
}
await b.close();
