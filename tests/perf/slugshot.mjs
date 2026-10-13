// 獨頭彈的畫面截圖（2026-10-12，半徑 7 → 12）：前方幾隻不會動的靶，一直開火
//   用法：node perf/slugshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'scatter');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'scatter', path: 'B', final: null }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = [[330, 0], [380, -60], [420, 50]].map(([dx, dy]) => {
    const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.hp = e.maxHp = 5000; return e;
  });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 200; Input.my = innerHeight / 2;
});
await wait(600);
for (let i = 1; i <= 2; i++) {
  await p.screenshot({ path: `${dir}/散彈_獨頭彈${i}.png` });
  console.log(i, await p.evaluate(() => `子彈半徑 ${Game.bullets.map(q => q.r).join(',')}`));
  await wait(130);
}
await b.close();
