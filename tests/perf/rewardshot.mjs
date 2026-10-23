// 三選一獎勵（縮起來的樣子）截圖：產物要看得到 → art_lab/screenshots/三選一獎勵.png；另外檢查靶場離開直接回標題
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', id: 'c', L: 1 }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 }); Game.combatWon();
  Game.reward.options = [chipId('vortex', 2), chipId('boomerang', 1), 'amp']; Game.view();
});
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '三選一獎勵.png' });
const after = await p.evaluate(() => {
  Game.newRun('range', 'vanguard', 'laser'); Game.togglePauseMenu(true);
  const menu = Screen.el.innerText.replace(/\s+/g, ' ').slice(0, 60);
  Game.quitRun();
  return { menu, state: Game.state, title: Screen.el.innerText.slice(0, 20) };
});
console.log('靶場 Esc 選單：', after.menu, '→ 離開後 state =', after.state, '｜畫面開頭：', after.title.replace(/\s+/g, ' '));
await b.close();
