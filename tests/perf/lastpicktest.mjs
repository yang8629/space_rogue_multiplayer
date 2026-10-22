// 記住上次的飛船和武器（真的 Chrome）：在基地換船、換武器 → 重新整理 → 進基地還是那組
//   用法：node perf/lastpicktest.mjs
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
const want = await p.evaluate(() => {
  const S = Object.keys(SHIPS).filter(id => isUnlocked('ship', id)), W = Object.keys(WEAPONS).filter(id => isUnlocked('weapon', id));
  const s = S.find(id => id !== Hub.shipId) || S[0], w = W.find(id => id !== Hub.weaponId) || W[0];
  Hub.pick(s); Hub.equip(w);
  return [s, w];
});
await p.reload(); await new Promise(r => setTimeout(r, 1500));
const got = await p.evaluate(() => [Hub.shipId, Hub.weaponId]);
const ok = got[0] === want[0] && got[1] === want[1];
console.log(`${ok ? 'ok  ' : 'FAIL'} 換成 ${want.join('＋')} → 重新整理後 ${got.join('＋')}`);
await b.close();
process.exitCode = ok ? 0 : 1;
