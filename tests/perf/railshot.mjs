// 軌道砲新終極升級的畫面截圖（2026-10-09）：碎甲（敵人身上的紅色準星）、導電（連鎖電弧）、靜電（左上小條，繞圈移動充電）
//   用法：node perf/railshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const [path, final, name, ms, move] of [['B', 1, '碎甲', 2500, false], ['C', 1, '導電', 900, false], ['C', 0, '靜電', 1200, true]]) {
  await p.evaluate((path, final, move) => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('run', 'vanguard', 'railgun');
    Game.node = { type: 'combat', L: 3, id: 'shot' };
    Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
    Game.weapon = { id: 'railgun', path, final }; Game.refreshWeapon(); Game.recalc();
    const P = Game.player; P.maxHp = P.hp = 1e6;
    Game.enemies = [[200, 0], [260, 0], [320, 0], [260, -110], [260, 110], [380, -90], [380, 90]].map(([dx, dy]) => {
      const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; return e;
    });
    Game.combat.waveT = 1e9;
    Input.down = !move; Input.keys.clear(); Input.mx = innerWidth / 2 + 220; Input.my = innerHeight / 2;
  }, path, final, move);
  if (move) for (const k of ['s', 'w', 's']) { await p.evaluate(k => { Input.keys.clear(); Input.keys.add(k); }, k); await wait(ms / 3); }
  else await wait(ms);
  await p.screenshot({ path: `${dir}/軌道_${name}.png` });
  console.log(name, await p.evaluate(() => `靜電 ${Game.player.staticK || 0} 格、第一隻破甲 ${Math.round((Game.enemies[0] && Game.enemies[0].shredAmt || 0) * 100)}%`));
}
await b.close();
