// 供電制（2026-10-10）的電路編輯器截圖：斷在晶片（容量 7）、斷在組件（容量 6）→ art_lab/screenshots/供電_斷在晶片.png、供電_斷在組件.png
//   用法：node perf/powershot.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const shot = async (cap, name) => {
  const info = await p.evaluate(cap => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('run', 'vanguard', 'laser');
    Game.wSock = 1; Game.cap = cap;
    // 武器［分裂 2］→ 迴旋 2［倍增 3］→ 反向 2 → 黏著 1 → 環繞 2
    Game.chain = ['weapon', chipId('boomerang', 1, 2), chipId('rear', 1, 1), chipId('sticky', 1, 1), chipId('orbit', 1, 1)];
    Game.socks = [['split'], ['amp'], [], [], []];
    Game.recalc(); Game.state = 'map'; Game.toggleEditor();
    const s = Game.stats;
    return `容量 ${s.cap}、用掉 ${s.used}、全部要 ${s.heat}、沒電 ${s.off}；斷電線 ${document.querySelectorAll('.hgroup.cut, .cutmark').length} 條`;
  }, cap);
  console.log(name, info);
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: `${OUT}${name}.png` });
  await p.evaluate(() => Game.toggleEditor());
};
await shot(7, '供電_斷在晶片');
await shot(6, '供電_斷在組件');
await b.close();
console.log('done');
