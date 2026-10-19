// 三選一翻牌截圖：剛出來（卡片還在等）、翻到一半、翻完 → art_lab/screenshots/三選一翻牌_*.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', id: 'c', L: 1 }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 });
  const orig = Game.rewardOptions; Game.rewardOptions = () => [chipId('boomerang', 1), 'split', chipId('orbit', 2, { k: 'aftershock', lv: 2 })];
  Game.combatWon(); Game.rewardOptions = orig;
});
for (const [ms, name] of [[150, '1剛出來'], [550, '2翻到一半'], [1300, '3稀有還蓋著'], [2600, '4全部翻開']]) {
  await p.evaluate(ms => new Promise(r => setTimeout(r, ms - (performance.now() - (window.__t0 ??= performance.now())))), ms);
  await p.screenshot({ path: SHOTS + `三選一翻牌_${name}.png` });
}
await b.close();
