// 局外成長（解鎖）的畫面截圖 → art_lab/screenshots/
//   標題（🔓 解鎖按鈕＋新達成）、解鎖一覽（假的進度）、選飛船／選武器（鎖住的卡片）、起始晶片（只有解鎖了的）、結算的新達成
//   用法：node perf/unlockshot.mjs（用 puppeteer 自己的瀏覽器資料，不動到平常玩的進度）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1500);
// 假的進度：打過 4 局、到過第 2 星區、打倒星噬母艦一次（雷射）、迴旋 63 次玩法擊殺
const t0 = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  localStorage.removeItem(UNLOCK_KEY);
  for (let i = 0; i < 3; i++) unlockAddRun({ sector: 1, bossIds: [], weapon: 'scatter', kills: 300, elites: 1, echoK: 20, play: { boomerang: 15, stand: 10 } });
  Game.unlockFresh = unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 420, elites: 2, echoK: 40, play: { boomerang: 18, sticky: 30 } });
  Screen.title();
  const t = performance.now(); Screen.unlocks(); const dt = performance.now() - t;
  Game.unlockFresh = unlockAddRun({ sector: 0, bossIds: [], weapon: 'laser', kills: 0, play: {} });  // 先清空新達成，再拍標題
  return dt;
});
await p.evaluate(() => { Game.unlockFresh = [unlockEntry('ship', 'wraith'), unlockEntry('weapon', 'railgun')]; Screen.title(); });
await wait(300);
await p.screenshot({ path: SHOTS + '解鎖_標題.png' });
await p.evaluate(() => Screen.unlocks()); await wait(300);
await p.screenshot({ path: SHOTS + '解鎖_一覽.png', fullPage: true });
await p.evaluate(() => { Screen.select('run'); }); await wait(400);
await p.screenshot({ path: SHOTS + '解鎖_選飛船_上鎖.png' });
await p.evaluate(() => { Screen.weaponSelect('run', 'vanguard'); }); await wait(300);
await p.screenshot({ path: SHOTS + '解鎖_選武器_上鎖.png' });
const picks = await p.evaluate(() => { Screen.chipPick('run', 'vanguard', 'laser'); return [...document.querySelectorAll('[data-act=startchip]')].map(x => x.dataset.arg.split(':')[3]); }); await wait(300);
await p.screenshot({ path: SHOTS + '解鎖_起始晶片.png' });
console.log('起始晶片', picks.join(','));
// 結算：飛船已毀的畫面＋新達成
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  Game.runStats.kills = 120; Game.runStats.time = 300;
  Game.unlockFresh = [unlockEntry('ship', 'gate')];
  Screen.dead();
});
await wait(300);
await p.screenshot({ path: SHOTS + '解鎖_結算.png' });
console.log('解鎖一覽畫面', Math.round(t0), 'ms');
await p.evaluate(() => localStorage.removeItem(UNLOCK_KEY));
await b.close();
console.log('done');
