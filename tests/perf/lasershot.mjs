// 雷射新終極升級的左上小條截圖（2026-10-09）：專注、分散（右邊擺靶）、擦彈、狂怒（各打 3 秒）
//   用法：node perf/lasershot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const [path, final, name] of [['A', 0, '專注'], ['A', 1, '分散'], ['B', 0, '擦彈'], ['B', 1, '狂怒']]) {
  await p.evaluate((path, final) => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('run', 'vanguard', 'laser');
    Game.node = { type: 'combat', L: 3, id: 'shot' };
    Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
    Game.weapon = { id: 'laser', path, final }; Game.refreshWeapon(); Game.recalc();
    const P = Game.player; P.maxHp = 1e6; P.hp = path === 'B' && final === 1 ? 4e5 : 1e6;
    Input.down = true; Input.keys.clear();
    // 專注、分散：飛船右邊擺幾隻不會動的靶，滑鼠瞄著它們
    if (path === 'A') {
      Game.enemies = [[220, 0], [360, -70], [380, 0], [360, 70]].slice(0, final === 0 ? 1 : 4).map(([dx, dy]) => {
        const e = new Enemy('brute', P.x + dx, P.y + dy, 200); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; return e;
      });
      Game.combat.waveT = 1e9;
    }
    Input.mx = innerWidth / 2 + 220; Input.my = innerHeight / 2;
  }, path, final);
  await wait(3000);
  await p.screenshot({ path: `${dir}/雷射_${name}小條.png`, clip: { x: 0, y: 0, width: 760, height: 90 } });
  console.log(name, await p.evaluate(() => { const P = Game.player; return `專注 ${P.focusK} 分散 ${P.spreadK} 擦彈 ${P.grazeK}`; }));
}
await b.close();
