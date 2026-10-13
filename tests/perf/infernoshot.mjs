// 業火爆燃的畫面截圖（2026-10-12）：前方擺一群不會動的靶，一直揮刀；抓到橘色爆炸光圈時拍
//   用法：node perf/infernoshot.mjs <輸出資料夾>
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
  Game.newRun('run', 'vanguard', 'blade');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'blade', path: 'C', final: 0 }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = [[90, 0], [100, -50], [100, 50], [150, -20], [150, 30], [60, -80], [60, 80]].map(([dx, dy]) => {
    const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.hp = e.maxHp = 5000; return e;
  });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 200; Input.my = innerHeight / 2;
});
const boom = () => p.evaluate(() => FX.rings.filter(r => r.color === '#ff9f1c' && !r.shrink).map(r => (r.life / r.max).toFixed(2)).join(','));
let saved = 0;
for (let i = 0; i < 200 && saved < 2; i++) {
  await wait(25);
  const s = await boom();
  if (s && +s.split(',')[0] > 0.6) { saved++; await p.screenshot({ path: `${dir}/相刃_業火爆燃${saved}.png` }); console.log('爆燃', saved, '光圈剩', s); await wait(700); }
}
if (!saved) console.log('沒抓到爆燃光圈');
console.log(await p.evaluate(() => `燒著的靶 ${Game.enemies.filter(e => e.burnL).map(e => e.burnL.length).join(',')} 層`));
await b.close();
