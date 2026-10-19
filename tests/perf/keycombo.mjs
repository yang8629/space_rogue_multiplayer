// 空白鍵＋方向鍵一起按：基地、戰鬥中都要衝得出去（衝刺方向照方向鍵）。用法：node perf/keycombo.mjs
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage(); await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
const w = ms => new Promise(r => setTimeout(r, ms));
for (const combo of [['ArrowUp'], ['ArrowUp', 'ArrowLeft'], ['ArrowDown', 'ArrowRight'], ['w', 'a']]) {
  await p.evaluate(() => { Hub.ship.dashCd = 0; Hub.ship.dashT = 0; Hub.dfx = []; const P = HUB.spawn; Hub.ship.x = P.x; Hub.ship.y = P.y; });
  for (const k of combo) await p.keyboard.down(k);
  await w(150); const x0 = await p.evaluate(() => [Hub.ship.x, Hub.ship.y]);
  await p.keyboard.press(' '); await w(250);
  const r = await p.evaluate(() => ({ puffs: Hub.puffs.length, a: Math.round(Hub.ship.dashA * 180 / Math.PI) }));
  for (const k of combo) await p.keyboard.up(k);
  console.log('基地', combo.join('+'), '＋空白：衝刺方向', r.a, '度、粒子', r.puffs);
}
// 按住空白再按方向鍵：冷卻一好就再衝（不靠系統的按鍵重複）；冷卻照飛船（先鋒號 1.8 秒）。鏡頭平滑跟上（瞬移那一幀不跳）
{
  await p.evaluate(() => { Hub.setShip('vanguard'); Hub.ship.dashCd = 0; Hub.ship.dashT = 0; const P = HUB.spawn; Hub.ship.x = P.x; Hub.ship.y = P.y; Hub.follow(); window.__n = 0; window.__cam = []; if (!window.__hd) { window.__hd = 1; Events.on('hubDash', () => { window.__n++; window.__cam.push(Math.round(Hub.cam.x)); }); } });
  await p.keyboard.down(' '); await w(100); await p.keyboard.down('ArrowLeft'); await w(4000);
  const r = await p.evaluate(() => ({ n: window.__n, camJump: window.__cam }));
  await p.keyboard.up('ArrowLeft'); await p.keyboard.up(' ');
  console.log('基地 按住空白＋←（4 秒）：衝了', r.n, '次（冷卻 1.8 秒 → 應為 3）');
  const jump = await p.evaluate(async () => { Hub.ship.dashCd = 0; Hub.ship.dashT = 0; const P = HUB.spawn; Hub.ship.x = P.x; Hub.ship.y = P.y; Hub.follow(); const c0 = Hub.cam.x; Input.dash = true; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { ship: Math.round(Hub.ship.x - P.x), cam: Math.round(Hub.cam.x - c0) }; });
  console.log('先鋒號瞬移後兩幀：飛船移了', jump.ship, '、鏡頭移了', jump.cam, '（鏡頭要比飛船少，慢慢跟上）');
}
// 戰鬥中
await p.evaluate(() => { Game.newRun('sandbox', 'bulwark', 'laser'); });
await w(500);
for (const combo of [['ArrowUp', 'ArrowLeft'], ['ArrowDown', 'ArrowRight']]) {
  await p.evaluate(() => { Game.player.dashCd = 0; Game.__d = 0; });
  await p.evaluate(() => { if (!window.__hook) { window.__hook = 1; Events.on('dash', () => Game.__d++); } });
  for (const k of combo) await p.keyboard.down(k);
  await w(150); await p.keyboard.press(' '); await w(250);
  const r = await p.evaluate(() => ({ d: Game.__d, a: Math.round(Game.player.dashA * 180 / Math.PI) }));
  for (const k of combo) await p.keyboard.up(k);
  console.log('戰鬥', combo.join('+'), '＋空白：衝刺次數', r.d, '方向', r.a, '度');
}
await b.close();
