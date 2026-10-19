// 三選一翻牌動畫逐幀量：每一幀記下各卡片的透明度（w = 稀有那格還蓋著）、卡片是不是還在等（hold），和卡住主執行緒的長工作
// 用法：node perf/flipcheck.mjs（真的 Chrome 視窗，GPU 照實際）
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2000));
await p.evaluate(() => { Game.newRun('run', 'vanguard', 'laser'); Game.credits = 999; });

// 量一段：act = 'win'（開戰鬥跑一下再打贏）／'reroll'（刷新）／'redraw'（同一組重畫）；rare：有沒有稀有
async function trial(label, rare, act = 'win') {
  if (act === 'win') {
    await p.evaluate(() => { Game.node = { type: 'combat', id: 'c', L: 1 }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 }); });
    await new Promise(r => setTimeout(r, 1500));  // 戰鬥畫面畫一陣子
  }
  const res = await p.evaluate((rare, act) => new Promise(done => {
    const opts = [chipId('boomerang', 1), 'split', rare ? chipId('orbit', 2, { k: 'aftershock', lv: 2 }) : chipId('orbit', 2)];
    const orig = Game.rewardOptions; Game.rewardOptions = () => opts.slice();
    const long = [], frames = [];
    const po = new PerformanceObserver(l => l.getEntries().forEach(e => long.push([Math.round(e.startTime - t0), Math.round(e.duration)])));
    po.observe({ type: 'longtask', buffered: false });
    const t0 = performance.now();
    if (act === 'win') Game.combatWon(); else if (act === 'reroll') Game.rerollReward(); else Game.view();
    Game.rewardOptions = orig;
    const tick = () => {
      const t = performance.now() - t0;
      const hold = document.querySelector('#screen .cards.flip-hold') ? 'hold ' : '     ';
      const cs = [...document.querySelectorAll('#screen .card')].map(c => `${(+getComputedStyle(c).opacity).toFixed(2)}${c.classList.contains('rare-wait') ? 'w' : ''}`);
      frames.push([Math.round(t), hold + cs.join(' ')]);
      if (t < 2600) requestAnimationFrame(tick); else { po.disconnect(); done({ long, frames }); }
    };
    requestAnimationFrame(tick);
  }), rare, act);
  console.log(`\n== ${label}`);
  console.log('長工作 [開始ms, 持續ms]：', JSON.stringify(res.long));
  let prev = '', pt = 0;  // 只印有變化的幀；幀間隔 > 50ms 標出來
  for (const [t, s] of res.frames) { if (s !== prev || t - pt > 50) console.log(String(t).padStart(5), (t - pt > 50 ? `(+${t - pt})` : '').padEnd(8), s); prev = s; pt = t; }
}
await trial('第 1 場 有稀有', true);
await trial('同一組重畫（不該再翻）', true, 'redraw');
await trial('刷新（要再翻）', false, 'reroll');
await p.evaluate(() => { Game.reward = null; Game.state = 'map'; });
await trial('第 2 場 沒有稀有', false);
await b.close();
