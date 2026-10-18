// 介面巡覽：主要畫面各截一張，看介面風格統不統一 → art_lab/screenshots/風格_*.png
//   基地、發射台、軍械庫、選武器、起始晶片、航圖、三選一、補給站、軍械台、？事件、電路編輯器、戰鬥（HUD）、暫停選單、結算、多人連線、電路總覽
//   用法：node perf/styletour.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('renderer', 'gl'); });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 400, play: { boomerang: 40 } }); Game.unlockFresh = []; Screen.title(); });
const shot = async (name, fn, ms = 450) => { if (fn) await p.evaluate(fn); await wait(ms); await p.screenshot({ path: SHOTS + `風格_${name}.png` }); };
await shot('01基地');
await shot('02發射台', () => Screen.basePanel('launch'));
await shot('03軍械庫', () => Screen.basePanel('armory'));
await shot('04選武器', () => Screen.depart());
await shot('05起始晶片', () => Screen.chipPick('run', 'vanguard', 'laser'));
await shot('06航圖', () => { Game.newRun('run', 'vanguard', 'laser', 'boomerang'); });
await shot('07三選一', () => { Game.openReward('combat'); Game.view(); }, 1200);
await shot('08補給站', () => { Game.credits = 200; Game.openShop(); });
await shot('09軍械台', () => { Game.state = 'armory'; Game.view(); });
await shot('10事件', () => { const id = EVENT_IDS[1]; Game.openEvent({ id: 'x', type: 'event', L: 2, ev: id, evArg: null }); });
await shot('11電路編輯器', () => { Game.showMap(); Game.toggleEditor(); });
await p.evaluate(() => { Game.toggleEditor(); Game.node = { type: 'combat', L: 1, id: 'st' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0 }); });
await shot('12戰鬥', null, 3500);
await shot('13暫停選單', () => Game.togglePauseMenu(true));
await shot('14結算', () => { Game.togglePauseMenu(false); Game.runStats.kills = 80; Game.state = 'dead'; Game.inArena = false; Screen.dead(); });
await shot('15多人連線', () => { Game.state = 'title'; Net.lobby(); });
await shot('16電路總覽', () => { Screen.title(); Codex.open('rules'); });
await b.close();
console.log('done');
