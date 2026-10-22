// ？事件節點截圖：航圖（？節點、寶藏星域金框）、事件畫面（黑市 4 個選項、拆反應爐的揭曉）、戰鬥開場（寶藏星域＋追兵橫幅、終焉護殼的血條金框）
//   用法：node perf/eventshot.mjs
//   → art_lab/screenshots/事件_航圖.png、事件_黑市.png、事件_揭曉.png、事件_星圖情報.png、事件_寶藏星域開場.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
const wait = ms => new Promise(r => setTimeout(r, ms));

// 航圖：找一張有星圖情報的圖、標好 2 個寶藏星域；裝上終焉護殼、回應了求救訊號（狀態列「免死」、航圖下方「追兵」）
const info = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  let m, e;
  for (let i = 0; i < 80 && !e; i++) { m = genMap(); e = m.flat().find(n => n.type === 'event' && n.ev === 'chart'); }
  Game.map = m; Game.markHoard(hoardIds(e));
  Game.boons.ward = 1; Game.boons.taken = 1; Game.recalc();
  Game.addSos('full');
  Game.showMap('✦ 破解成功！標出 2 個寶藏星域');
  return `事件 ${m.flat().filter(n => n.type === 'event').map(n => n.ev).join('、')}`;
});
await wait(400);
await p.screenshot({ path: SHOTS + '事件_航圖.png' });
console.log('存好 事件_航圖', info);

await p.evaluate(() => { Game.credits = 120; Game.openEvent({ id: 'shot', L: 2, k: 0, n: 1, type: 'event', next: [], ev: 'market' }); });
await wait(300);
await p.screenshot({ path: SHOTS + '事件_黑市.png' });
console.log('存好 事件_黑市');

await p.evaluate(() => {  // 拆反應爐：固定失敗，看揭曉畫面
  Game.openEvent({ id: 'shot', L: 2, k: 0, n: 1, type: 'event', next: [], ev: 'wreck' });
  const r = Math.random; Math.random = () => 0.99; try { Game.evChoose(1); } finally { Math.random = r; }
});
await wait(500);
await p.screenshot({ path: SHOTS + '事件_揭曉.png' });
console.log('存好 事件_揭曉');

await p.evaluate(() => { const e = Game.map.flat().find(n => n.ev === 'chart'); Game.openEvent(e); });
await wait(300);
await p.screenshot({ path: SHOTS + '事件_星圖情報.png' });
console.log('存好 事件_星圖情報');

// 寶藏星域＋追兵：第 1 區開場橫幅；血條金框＋⛨（還有終焉護殼）
await p.evaluate(() => {
  Game.node = { type: 'combat', L: 3, id: 'shot', next: [] };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, hoard: true, ...Game.takeSos() });
  const P = Game.player; P.hp = P.maxHp * 0.35; P.iframe = 1e9;
  Input.autoFire = false;
});
await wait(1700);
await p.screenshot({ path: SHOTS + '事件_寶藏星域開場.png' });
console.log('存好 事件_寶藏星域開場');
await b.close();
