// 靶場的電路編輯器：往下捲到晶片庫時電路還在上面；晶片庫點兩下直接裝上 → art_lab/screenshots/靶場編輯器_*.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => { Game.newRun('range', 'vanguard', 'laser'); Game.toggleEditor(); });
await new Promise(r => setTimeout(r, 400));
// 捲到晶片庫
await p.evaluate(() => { const P = document.getElementById('library').closest('.panel'); P.scrollTop = P.scrollHeight; });
await new Promise(r => setTimeout(r, 300));
const vis = await p.evaluate(() => { const r = document.getElementById('chain').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
console.log('捲到晶片庫時電路的位置', JSON.stringify(vis), vis.bottom > 0 ? '（看得到）' : '（看不到）');
// 點兩下：環繞（晶片）、分裂模組（組件）
for (const id of ['orbit', 'split', 'pierce']) {
  const box = await p.evaluate(id => { const el = Editor.libChips[id]; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  await p.mouse.click(box.x, box.y); await new Promise(r => setTimeout(r, 120)); await p.mouse.click(box.x, box.y);
  await new Promise(r => setTimeout(r, 200));
}
console.log('點兩下之後', await p.evaluate(() => JSON.stringify({ chain: Game.chain, socks: Game.socks })));
await p.screenshot({ path: OUT + '靶場編輯器_捲到晶片庫.png' });
await b.close();
