// 數值圖表的兩張模擬表截圖（2026-10-13）：武器升級價值（電漿分頁）、路線價值（相位刃分頁）
//   用法：node perf/simvalueshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1400, height: 1000 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => Codex.open('charts'));
await new Promise(r => setTimeout(r, 400));
for (const [title, tab, name] of [['武器升級價值', 'sv-up-plasma', '電漿'], ['路線價值', 'sv-rv-blade', '相位刃']]) {
  const box = await p.evaluateHandle((title, tab) => {
    const h = [...document.querySelectorAll('.viz h4')].find(x => x.textContent.startsWith(title)), v = h.closest('.viz');
    v.querySelector(`[data-pane="${tab}"]`).click(); v.scrollIntoView(); return v;
  }, title, tab);
  await new Promise(r => setTimeout(r, 300));
  await box.screenshot({ path: `${dir}/數值圖表_${title}_${name}.png` });
}
await b.close();
