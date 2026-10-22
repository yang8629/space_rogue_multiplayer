// 電路編輯器「傷害統計」分頁截圖（2026-10-13 分裂改成分出來的子彈算分裂）：消失觸發器插 2 個分裂，打一陣子
//   用法：node perf/dmgtabshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  MechCheck.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'split', 'split']);
  MechCheck.targets([[150, -40], [170, 0], [190, 40], [210, -80], [230, 80]], 'brute', true, 60);
  MechCheck.run(240);
  Game.state = 'play'; Game.inArena = true; Game.node = { type: 'combat', L: 2, id: 'x' };
  Editor.open(); Editor.setTab('dmg');
});
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: `${dir}/傷害統計_分裂.png` });
console.log(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(Game.runStats.chips).map(([k, v]) => [k, Math.round(v)])))));
await b.close();
