// 基地（主畫面：js/game/hub.js、js/ui/gl/gl_hub.js、js/ui/base.js）截圖 → art_lab/screenshots/
//   假的進度（4 局、到過第 2 星區、雷射打倒星噬母艦）→ 全景、靠近停機坪（解鎖／鎖住）、門口、發射台，門後的面板，出發後的選武器，結算的新解鎖
//   用法：node perf/baseshot.mjs（用 puppeteer 自己的瀏覽器資料，不動到平常玩的存檔）；印出一幀基地畫面花幾 ms
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('renderer', 'gl'); });
await p.reload(); await wait(2000);
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  for (let i = 0; i < 3; i++) unlockAddRun({ sector: 1, bossIds: [], weapon: 'scatter', kills: 300, elites: 1, echoK: 20, play: { boomerang: 15, stand: 10, orbit: 22 } });
  Game.unlockFresh = unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 420, elites: 2, echoK: 40, play: { boomerang: 18, sticky: 30 } });
  Screen.title();
});
// 把飛船放到某個點旁邊（更新一幀讓「靠近」算出來）
const at = (id, dy = 0) => p.evaluate((id, dy) => { const z = Hub.zone(id), s = Hub.ship; s.x = z.x; s.y = z.y + dy; s.vx = s.vy = 0; Hub.update(0.016); Hub.follow(1); }, id, dy);
const shot = async name => { await wait(450); await p.screenshot({ path: SHOTS + `基地_${name}.png` }); };
await shot('全景');
await at('pad:wraith', 30); await shot('停機坪');
await at('pad:gate', 30); await shot('停機坪_鎖住');
await at('armory', 70); await shot('門口');
await at('launch', -40); await shot('發射台旁');
for (const id of ['armory', 'chips', 'stats', 'launch']) { await p.evaluate(id => Screen.basePanel(id), id); await shot('面板_' + { armory: '軍械庫', chips: '晶片庫', stats: '戰績', launch: '發射台' }[id]); }
await p.evaluate(() => Screen.depart()); await shot('出發_選武器');
const ms = await p.evaluate(() => { Screen.title(); const t = performance.now(); for (let i = 0; i < 20; i++) { GLR.render(); render(); } return (performance.now() - t) / 20; });
console.log('基地一幀', ms.toFixed(1), 'ms');
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser'); Game.runStats.kills = 120; Game.runStats.time = 300;
  Game.unlockFresh = [unlockEntry('ship', 'gate')];
  Screen.dead();
});
await shot('結算_新解鎖');
await b.close();
console.log('done');
