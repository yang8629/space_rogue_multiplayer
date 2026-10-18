// 基地（主畫面，js/ui/base.js）截圖 → art_lab/screenshots/
//   假的進度（4 局、到過第 2 星區、雷射打倒星噬母艦）→ 機庫（選中已解鎖／鎖住的飛船）、軍械庫、晶片庫、戰績、結算的新解鎖、出發後的選武器
//   用法：node perf/baseshot.mjs（用 puppeteer 自己的瀏覽器資料，不動到平常玩的存檔）；印出每一頁畫出來花幾 ms
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('renderer', 'gl'); });
await p.reload(); await wait(1500);
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  for (let i = 0; i < 3; i++) unlockAddRun({ sector: 1, bossIds: [], weapon: 'scatter', kills: 300, elites: 1, echoK: 20, play: { boomerang: 15, stand: 10, orbit: 22 } });
  Game.unlockFresh = unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 420, elites: 2, echoK: 40, play: { boomerang: 18, sticky: 30 } });
});
const time = async (name, fn) => { const ms = await p.evaluate(fn); await wait(350); await p.screenshot({ path: SHOTS + `基地_${name}.png` }); console.log(name, Math.round(ms), 'ms'); };
await time('機庫', () => { const t = performance.now(); Screen.title('hangar'); return performance.now() - t; });
await time('機庫_鎖住', () => { const t = performance.now(); Screen.hgShip = 'gate'; Screen.title('hangar'); return performance.now() - t; });
await time('軍械庫', () => { const t = performance.now(); Screen.title('armory'); return performance.now() - t; });
await time('晶片庫', () => { const t = performance.now(); Screen.title('chips'); return performance.now() - t; });
await time('戰績', () => { const t = performance.now(); Screen.title('stats'); return performance.now() - t; });
await time('機庫_第二次', () => { const t = performance.now(); Screen.hgShip = 'wraith'; Screen.title('hangar'); return performance.now() - t; });
await time('出發_選武器', () => { const t = performance.now(); Screen.depart(); return performance.now() - t; });
await time('結算_新解鎖', () => {
  Game.newRun('run', 'vanguard', 'laser'); Game.runStats.kills = 120; Game.runStats.time = 300;
  Game.unlockFresh = [unlockEntry('ship', 'gate')];
  const t = performance.now(); Screen.dead(); return performance.now() - t;
});
await b.close();
console.log('done');
