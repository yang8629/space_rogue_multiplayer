// 新玩家開局會看到的畫面（不按 Shift）→ art_lab/screenshots/開局_*.png
//   標題、選飛船（＋按 Shift 的詳細說明）、選武器、起始晶片、第一次的航圖、第一場戰鬥
//   新手教學：第一次開遊戲自動進（假裝不是自動化瀏覽器）、每一段、按住 Esc、大廳的終端機
//   用法：node perf/startflowshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.clear(); localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); });
const shot = async name => { await wait(500); await p.screenshot({ path: SHOTS + `開局_${name}.png` }); };
await shot('1標題');
await p.evaluate(() => Screen.title()); await shot('2選飛船');
await p.evaluate(() => document.body.classList.add('detail')); await shot('2選飛船_詳細');
await p.evaluate(() => document.body.classList.remove('detail'));
await p.evaluate(() => Screen.chipPick('run', 'vanguard', 'laser')); await shot('4起始晶片');
await p.evaluate(() => Game.newRun('run', 'vanguard', 'laser', NORMAL_IDS[0])); await shot('5航圖');
await p.evaluate(() => { const n = Game.reachable()[0]; Game.enterNode(n); }); await wait(1500); await shot('6第一場戰鬥');
// 新手教學：自動化瀏覽器（navigator.webdriver）平常不自動進，這裡假裝是一般瀏覽器、清掉存檔，看第一次開遊戲是不是直接進教學
const p2 = await b.newPage();
p2.on('pageerror', e => console.log('頁面錯誤', e.message));
await p2.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
await p2.goto(GAME + 'index.html');
await p2.evaluate(() => { try { localStorage.clear(); localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p2.reload(); await wait(1800);
const shot2 = async name => { await wait(500); await p2.screenshot({ path: SHOTS + `開局_${name}.png` }); };
console.log('第一次開遊戲：', await p2.evaluate(() => `${Game.mode} / ${Game.state}`));
await p2.evaluate(() => SFX.setMuted && SFX.setMuted(true));
await shot2('7教學1移動');
await p2.evaluate(() => Tutorial.go(1)); await wait(800); await shot2('7教學2射擊');
await p2.evaluate(() => Tutorial.go(2)); await wait(800); await shot2('7教學3排熱_熱度說明');
await p2.click('.bb-cover'); await shot2('7教學3排熱_包圍');
await p2.evaluate(() => { Game.player.hHeat = 0.3; Input.alt = true; }); await wait(250); await shot2('7教學3排熱_衝擊波');
// 三選一：泡泡框依序（點畫面換下一個），最後指定選晶片
await p2.evaluate(() => Tutorial.go(3)); await p2.screenshot({ path: SHOTS + '開局_7教學4三選一_0翻卡中.png' });  // 卡片還在翻：泡泡框不能出來
console.log('翻卡中泡泡框：', await p2.evaluate(() => document.querySelector('.bubble').classList.contains('hidden') ? '沒出來' : '出來了（錯）'));
await wait(1500); await shot2('7教學4三選一_1晶片');
for (const [k, name] of [[2, '插件'], [3, '零件'], [4, '選這張']]) { await p2.click('.bb-cover'); await shot2(`7教學4三選一_${k}${name}`); }
await p2.evaluate(() => Game.takeReward(Game.reward.only)); await wait(1500);
// 朝前排射，等到停下來說明（迴旋刃打到後排、後排燒起來）
const fireUntilHalt = async name => {
  await p2.evaluate(() => { const e = Game.enemies.find(q => q.immortal); Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM; Input.down = true; });
  await wait(1200); await shot2(name + '_射擊');
  for (let k = 0; k < 40 && !(await p2.evaluate(() => Tutorial.halted())); k++) await wait(100);
  await p2.evaluate(() => { Input.down = false; }); await shot2(name + '_停下來說明');
  await p2.click('.bb-cover');
};
await fireUntilHalt('7教學5迴旋');
await p2.evaluate(() => { Input.down = true; }); await wait(3000); await p2.evaluate(() => { Input.down = false; });
console.log('迴旋那步之後：', await p2.evaluate(() => `第 ${Tutorial.i} 步 ${(TUTORIAL[Tutorial.i] || {}).id}`));
await p2.evaluate(() => Tutorial.go(5)); await wait(300); await p2.evaluate(() => Game.toggleEditor()); await shot2('7教學6插件_1倉庫');
await p2.click('.bb-cover'); await shot2('7教學6插件_2插件');
await p2.click('.bb-cover'); await shot2('7教學6插件_3拖到這裡');
await p2.evaluate(() => Editor.plug(0, { from: 'inv', index: Game.inventory.indexOf(CFG.TUTORIAL.plug) })); await shot2('7教學6插件_4插飛船被擋');
await p2.evaluate(() => { const k = Game.inventory.indexOf(CFG.TUTORIAL.plug); Game.socks[Tutorial.chipAt()] = [CFG.TUTORIAL.plug]; Game.inventory[k] = null; Editor.changed(); Game.toggleEditor(); }); await wait(1600);
await fireUntilHalt('7教學7燃燒');
// 光束從旁邊直接打後排：無效（後排只有迴旋刃打得到）
await p2.evaluate(() => { Input.down = false; Tutorial.go(4); const e = Game.enemies.filter(q => q.hurtBy).pop(), P = Game.player; P.x = e.x; P.y = e.y + 220; P.vx = P.vy = 0; });
await wait(1000);  // 等鏡頭跟上（鏡頭還在動時設準星，準星會掃到前排）
await p2.evaluate(() => { const e = Game.enemies.filter(q => q.hurtBy).pop(); window.__aim = setInterval(() => { Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM; }, 10); Input.down = true; });  // 鏡頭會往準星偏：每一幀重新對準
await wait(1200); await shot2('7教學5迴旋_光束打後排無效');
console.log('光束直接打後排：', await p2.evaluate(() => { clearInterval(window.__aim); Input.down = false; return Game.enemies.filter(q => q.hurtBy).map(q => q.hp + '/' + q.maxHp).join(' '); }));
await p2.evaluate(() => { Tutorial.go(7); }); await wait(2500); await shot2('7教學8實戰');
await p2.evaluate(() => { Tutorial.go(8); }); await wait(1500); await shot2('7教學9精英');
await p2.evaluate(() => Tutorial.escDown()); await wait(400); await p2.screenshot({ path: SHOTS + '開局_7教學10按住Esc.png' });
await wait(1200); console.log('按住 Esc 之後：', await p2.evaluate(() => `${Game.mode} / ${Game.state}、看過 ${Save.flag('tutorial', false)}`));
for (let k = 0; k < 40 && await p2.evaluate(() => !!Hub.seq); k++) await wait(100);  // 等回航過場播完
await p2.evaluate(() => { const z = HUB.zones.find(q => q.id === 'tutorial'); Hub.build(z.x + 50, z.y, Math.PI); }); await wait(800); await shot2('8大廳_新手教學終端機');
await b.close();
console.log('done');
