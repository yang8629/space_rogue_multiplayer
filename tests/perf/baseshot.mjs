// 基地（主畫面：js/game/hub.js、js/ui/gl/gl_hub.js、js/ui/base.js）截圖 → art_lab/screenshots/
//   假的進度（4 局、到過第 2 星區、雷射打倒星噬母艦）→ 全景、靠近停機坪（解鎖／鎖住）、門口、發射台，門後的面板，出發後的選武器，多人房間（共用的基地），結算的新解鎖
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
await at('rack:scatter', 20); await shot('武器架');
await at('rack:blade', 20); await shot('武器架_鎖住');
await at('armory', 30); await shot('操作台');
await at('chips', 60); await shot('晶片實驗室');
await at('stats', 60); await shot('戰績室');
await p.evaluate(() => { const d = HUB.rooms.deck, s = Hub.ship; s.x = d.x + d.w / 2; s.y = d.y + d.h / 2 + 40; Hub.update(0.016); }); await shot('觀景台');
await p.evaluate(() => { const h = HUB.rooms.hall, s = Hub.ship; s.x = h.x + h.w / 2; s.y = h.y + 60; Hub.update(0.016); }); await shot('大廳上方');
await at('launch', -40); await shot('發射台旁');
for (const id of ['armory', 'chips', 'stats', 'launch']) { await p.evaluate(id => Screen.basePanel(id), id); await shot('面板_' + { armory: '軍械庫', chips: '晶片庫', stats: '戰績', launch: '發射台' }[id]); }
await p.evaluate(() => Screen.depart()); await shot('出發_起始晶片');
const ms = await p.evaluate(() => { Screen.title(); const t = performance.now(); for (let i = 0; i < 20; i++) { GLR.render(); render(); } return (performance.now() - t) / 20; });
console.log('基地一幀', ms.toFixed(1), 'ms');
// 多人房間（共用的基地）：假的房主＋兩個隊友（2P 準備好了、3P 在看面板）
await p.evaluate(() => {
  Net.role = 'host'; Net.code = 'K7QX'; Net.ping = 42; Net.chapter = 1;
  Net.peers = [{ slot: 2, linked: true, inRoom: true, ready: true, pick: { ship: 'bulwark', weapon: 'laser', chip: null } }, { slot: 3, linked: true, inRoom: true, ready: false }];
  Net.refreshPeers(); Net.enterRoom();
  const L = Hub.zone('launch'); Net.roomMates = { 2: { x: L.x + 160, y: L.y - 40, a: 0.6, s: 'bulwark', m: true, r: true, b: false, at: 1e12 }, 3: { x: L.x - 60, y: L.y - 220, a: -1.2, s: 'wraith', m: false, r: false, b: true, at: 1e12 } };
});
await at('launch', -60); await shot('多人房間');
await p.evaluate(() => Screen.basePanel('launch')); await shot('多人房間_發射台');
await p.evaluate(() => { Net.peers = []; Net.role = null; Net.roomMates = {}; Game.state = 'title'; });
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser'); Game.runStats.kills = 120; Game.runStats.time = 300;
  Game.unlockFresh = [unlockEntry('ship', 'gate')];
  Screen.dead();
});
await shot('結算_新解鎖');
// 擴充測試：假的 8 艘飛船、7 把武器（重複用現有的）→ 基地變大，鏡頭停在最小縮放、跟著飛船捲動
await p.evaluate(() => {
  const sh = Object.keys(SHIPS), wp = Object.keys(WEAPONS);
  Object.assign(HUB, hubLayout(Array.from({ length: 8 }, (_, i) => sh[i % sh.length]), Array.from({ length: 7 }, (_, i) => wp[i % wp.length])));
  GLHub.built = false; Game.state = 'title'; Screen.title();
  const L = Hub.zone('launch'); Hub.ship.x = L.x - 150; Hub.ship.y = L.y;
});
await shot('擴充_下面');
await p.evaluate(() => { Hub.ship.x = 300; Hub.ship.y = 180; Hub.update(0.016); });
await shot('擴充_上面');
await b.close();
console.log('done');
