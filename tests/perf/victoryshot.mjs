// 擊沉旗艦後的勝利畫面（二選一的獎勵）：上面有狀態列和「整理電路 (Tab)」，可以打開電路與倉庫
//   用法：node perf/victoryshot.mjs   → art_lab/screenshots/勝利畫面.png、勝利畫面_開電路.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.inArena = false; Game.state = 'victory'; Game.victory = { slot: true, boss: Game.bossId, pick: null };
  Screen.victory();
});
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '勝利畫面.png' });
await p.keyboard.press('Tab'); await new Promise(r => setTimeout(r, 500));
const st = await p.evaluate(() => Game.state);
await p.screenshot({ path: SHOTS + '勝利畫面_開電路.png' });
await p.keyboard.press('Tab'); await new Promise(r => setTimeout(r, 400));
const back = await p.evaluate(() => [Game.state, !!Screen.el.querySelector('[data-act="bossslot"]')]);
console.log(`按 Tab：${st}；再按一次：${back[0]}（二選一還在 ${back[1]}）`);
await b.close();
