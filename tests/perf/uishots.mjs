// 介面截圖：改裝廠（零件卡）、精英獎勵（模組卡）、電路編輯器的機體分頁 → art_lab/screenshots/介面_*.png
//   用法：node perf/uishots.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
const shot = async (name, fn, detail = false) => {
  await p.evaluate(fn); await p.evaluate(d => document.body.classList.toggle('detail', d), detail);
  await new Promise(r => setTimeout(r, 400)); await p.screenshot({ path: OUT + `介面_${name}.png` });
};
await shot('改裝廠', () => { Game.newRun('run', 'wraith', 'railgun'); Game.openWorkshop(); });
await shot('改裝廠_詳細', () => {}, true);
await shot('精英獎勵', () => { Game.node = { type: 'elite', id: 'e', L: 3 }; Game.startCombat({ level: 3, wavesTotal: 1, elites: 1 }); Game.combatWon(); });
await shot('精英獎勵_詳細', () => {}, true);
await shot('機體分頁', () => {
  Game.node = null; Game.showMap();
  Game.parts.armor = 2; Game.parts.sink = 1; Game.recalc();
  Game.toggleEditor(); Editor.setTab('ship');
});
await b.close();
