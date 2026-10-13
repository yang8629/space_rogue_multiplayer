// 左上角小條截圖（蓄力、超頻熱度、架設）：裝上這三個，站著不動按住射擊幾秒後截左上角
//   用法：node perf/hudbarshot.mjs <輸出檔> <gl|2d>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const out = process.argv[2], mode = process.argv[3] || 'gl', url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url);
await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, mode);
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 3, elites: 0 });
  Game.wSock = 3;
  const r = splitChain(['weapon', 'overclock', 'focus', fullChip('stand'), fullChip('charge')].map(fullChip));
  Game.chain = r.chain; Game.socks = r.socks; Game.recalc();
  Game.player.hp = Game.player.maxHp = 1e9;
  Game.player.wantFire = true; Input.down = true;
});
await new Promise(r => setTimeout(r, 2600));
await p.screenshot({ path: out, clip: { x: 0, y: 0, width: 760, height: 90 } });
await b.close();
