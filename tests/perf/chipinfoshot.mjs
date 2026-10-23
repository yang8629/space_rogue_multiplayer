// 電路編輯器（遠征中）的晶片說明框截圖：有插座的 Lv1 晶片也要看得到各等級效果 → art_lab/screenshots/包包晶片說明.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
// 包包裡放 7 種晶片（有插座的 Lv1），每種的說明框文字都印出來；截圖停在第一種（迴旋）
const txt = await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  const ids = NORMAL_IDS.filter(id => CHIPS[id].type === 'chip');
  ids.forEach((id, i) => { Game.inventory[i] = chipId(id, 2); }); Game.recalc();
  Game.toggleEditor();
  const out = ids.map((id, i) => { Editor.showInfo(Game.inventory[i]); return `── ${CHIPS[id].name}\n${Editor.infoEl.innerText}`; });
  Editor.showInfo(Game.inventory[0]); Editor.infoEl.scrollIntoView({ block: 'center' });
  return out.join('\n');
});
console.log(txt);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '包包晶片說明.png' });
await b.close();
