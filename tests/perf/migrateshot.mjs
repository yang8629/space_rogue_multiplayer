// 存檔升級（js/data/unlocks.js 的 unlockUpgrade）在真的瀏覽器裡：放一份老玩家的存檔 → 重新整理 → 看紀錄、章節、選章畫面
//   老玩家：2.19 的紀錄 2 筆（通關第一、二章）、2.20.0 的紀錄 1 筆（通關第一章）、2.20.0 的解鎖進度、章節進度 [1, 2]
//   用法：node perf/migrateshot.mjs（用 puppeteer 自己的瀏覽器資料，不動到平常玩的存檔）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => {
  const rec = (build, chapter, o) => ({ v: 2, build, at: '2026-10-17T00:00:00Z', result: 'cleared', chapter, ship: '先鋒號', weapon: '散彈砲', sector: 3, endless: false, bosses: [], kills: 500, mech: { playKills: {} }, ...o });
  localStorage.setItem('renderer', 'gl');
  localStorage.setItem(RECORDS_KEY, JSON.stringify([rec('mp-2.20.0（2026-10-18 03:59）', 1, { kills: 700 }), rec('mp-2.19.3（2026-10-17 10:00）', 2), rec('mp-2.19.0（2026-10-16 10:00）', 1)]));
  localStorage.setItem(CHAPTER_KEY, JSON.stringify({ cleared: [1, 2] }));
  localStorage.setItem(UNLOCK_KEY, JSON.stringify({ runs: 1, kills: 700, elites: 0, echoK: 0, sector: 3, boss: { boss: 1, boss2: 1, boss3: 1 }, bossW: { scatter: 3 }, play: {}, ch: [1, 2] }));
});
await p.reload(); await wait(1500);
const r = await p.evaluate(() => {
  const recs = JSON.parse(localStorage.getItem(RECORDS_KEY)), P = JSON.parse(localStorage.getItem(UNLOCK_KEY));
  return { recs: recs.map(x => x.build.slice(0, 9)), ch: chapterProgress(), runs: P.runs, kills: P.kills, mig: P.mig, stats: P.stats.join(','),
    sentry: isUnlocked('ship', 'sentry'), ch2: chapterUnlocked(2), ch3: chapterUnlocked(3) };
});
console.log(JSON.stringify(r));
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.basePanel('launch'); }); await wait(400);
await p.screenshot({ path: SHOTS + '存檔升級_發射台.png' });
await b.close();
