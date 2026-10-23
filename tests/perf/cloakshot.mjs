// 潛伏者隱形時的狀態圈截圖：三隻並排（左：完全隱形、中：半隱形、右：現形），都帶減速、標記、燃燒、黏著
//   用法：node perf/cloakshot.mjs   → art_lab/screenshots/潛伏者狀態圈_新畫面.png、潛伏者狀態圈_舊畫面.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
for (const [mode, name] of [['gl', '新畫面']]) {  // 舊畫面（2D）10-09 拿掉了
  await p.goto(url);
  await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, mode);
  await p.reload(); await new Promise(r => setTimeout(r, 2000));
  await p.evaluate(() => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'laser');
    Game.node = { type: 'combat', L: 1, id: 'shot' };
    Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
    const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9;
    Input.autoFire = false;
    Game.combat.pending = []; Game.enemies = [];
    const L = [];
    [1, 0.5, 0].forEach((c, i) => {
      const e = new Enemy('lurker', P.x - 160 + i * 160, P.y - 150, 1);
      e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; e.cloak = c; e.mode = 'stalk';
      e.stuck = [1, 2, 3, 4, 5].map(() => ({ dmg: 1, att: { src: 'weapon' }, lv: 1 }));
      Game.enemies.push(e); L.push(e);
    });
    // 狀態每幀重設（不讓它們過期、黏著不爆）
    setInterval(() => { for (const e of L) { e.slowT = e.markT = e.burnT = e.shredT = 99; e.stickT = 99; e.hp = e.maxHp * 0.6; } Game.player.x = Arena.start.x; }, 16);
  });
  await new Promise(r => setTimeout(r, 1500));
  const box = await p.evaluate(() => { const e = Game.enemies[0], c = Game.cam; return { x: (e.x - c.x) * ZOOM - 80, y: (e.y - c.y) * ZOOM - 80 }; });
  await p.screenshot({ path: OUT + `潛伏者狀態圈_${name}.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: 480, height: 160 } });
  console.log('存好', name);
}
await b.close();
