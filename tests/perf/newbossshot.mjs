// 章節專屬王的截圖：真的開一場王戰（雙子獵艦、星環守門者），飛船無敵、不開火，等幾秒讓招式出來
//   守門者等到光束開著時拍；另外各拍一張美術放大圖（tools/art 的畫法）
//   用法：node perf/newbossshot.mjs   → art_lab/screenshots/王_雙子獵艦.png、王_星環守門者.png、王_美術.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
const fight = async (id, wait, until) => {
  await p.evaluate(id => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('run', 'vanguard', 'laser');
    Game.sector = 3; Game.bossId = id; Game.node = { type: 'boss', L: 6, id: 'shot', next: [] };
    Game.startCombat({ level: 20, wavesTotal: 1, elites: 0, boss: true });
    const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9; Input.autoFire = false;
  }, id);
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 1800));  // 王出場（1.6 秒）之後，把飛船移到王附近（看得到整隻王）
  await p.evaluate(() => {
    const P = Game.player, B = Game.enemies.find(e => e.t.boss && !e.share);
    if (!B) return;
    const c = B.pair ? B.pair : B, [x, y] = Arena.clampIn(c.x, c.y + (B.pair ? 330 : 360), 40);
    P.x = x; P.y = y; Game.cam.x = P.x - ZW / 2; Game.cam.y = P.y - ZH / 2;
  });
  await new Promise(r => setTimeout(r, Math.max(0, wait - 1800)));
  if (until) while (Date.now() - t0 < wait + 8000 && !(await p.evaluate(until))) await new Promise(r => setTimeout(r, 100));
};
await fight('boss4', 5500);
await p.screenshot({ path: SHOTS + '王_雙子獵艦.png' });
console.log('存好 王_雙子獵艦.png');
await fight('boss5', 3000, () => Game.bossBeams().some(b => !b.warn));
await new Promise(r => setTimeout(r, 600));
await p.screenshot({ path: SHOTS + '王_星環守門者.png' });
console.log('存好 王_星環守門者.png');
// 美術放大
await p.goto(GAME + 'tools/art/build.html');
await p.setViewport({ width: 1000, height: 420 });
await p.evaluate(() => {
  document.body.innerHTML = ''; document.body.style.margin = '0';
  const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 420; document.body.appendChild(cv);
  const c = cv.getContext('2d'); c.fillStyle = '#05070f'; c.fillRect(0, 0, 1000, 420);
  const E = id => ENEMIES.find(e => e.id === id), at = (x, y, k, f) => { c.save(); c.translate(x, y); c.scale(k, k); f(c); c.restore(); };
  at(170, 210, 2.6, c => drawTwin(c, E('boss4').col, E('boss4').r, 0));
  at(520, 210, 2, c => drawWardenCore(c, E('boss5').col, E('boss5').r, 1));
  [['wt_aim', 'aim'], ['wt_ring', 'ring'], ['wt_bomb', 'bomb'], ['wt_call', 'call']].forEach(([id, role], i) => at(800 + (i % 2) * 120, 120 + Math.floor(i / 2) * 170, 2.4, c => drawWardenTurret(c, WT_COL[id], 20, role)));
});
await p.screenshot({ path: SHOTS + '王_美術.png' });
console.log('存好 王_美術.png');
await b.close();
