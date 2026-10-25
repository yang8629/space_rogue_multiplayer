// 星環電路 多人版 · save.js：存檔（瀏覽器 localStorage）唯一的出入口：所有存檔的名稱、讀、寫、刪；舊存檔升級
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   其他檔案不直接碰 localStorage：換成 Godot／Steam 的存檔時只改這一檔。
//   瀏覽器擋存取（無痕、關掉網站資料）時讀到的是預設值、寫入直接略過，遊戲照常玩
'use strict';

const Save = {
  // 存檔名稱（改名要寫存檔升級，不然玩家的進度會不見）
  KEYS: {
    records: 'v2_runRecords',      // 遊玩紀錄（最新的在前，最多 CFG.MAX_RECORDS 筆）
    chapters: 'v2_chapters',       // 章節進度：{ cleared: [已通關的章號] }
    unlocks: 'v2_unlocks',         // 解鎖進度（跨局累計的成績，見 data/unlocks.js）
    unlockSeen: 'v2_unlock_seen',  // 基地「新」標記看過的：["種類:id", …]
    settings: 'v2_settings',       // 設定頁：音量、畫面震動、FPS、卡片說明
    lastPick: 'v2_lastPick',       // 上次選的飛船、武器：{ ship, weapon }
    tutorial: 'v2_tutorial',       // 新手教學看過了：'1'（看過就不再自動進）
    muted: 'muted', music: 'music', autoFire: 'autoFire',  // 開關：'1'／'0'
  },
  raw(k) { try { return localStorage.getItem(this.KEYS[k]); } catch (e) { return null; } },  // 原始字串（沒有 = null）
  setRaw(k, s) { try { localStorage.setItem(this.KEYS[k], s); } catch (e) {} },
  load(k, fallback) {  // JSON；沒有或壞掉 = fallback
    const s = this.raw(k);
    if (s == null) return fallback;
    try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return fallback; }
  },
  save(k, v) { this.setRaw(k, JSON.stringify(v)); },
  remove(k) { try { localStorage.removeItem(this.KEYS[k]); } catch (e) {} },
  // 只在這個分頁有效的（關掉分頁就沒了，用 sessionStorage）：多人重新整理後回到同一個位置
  seat() { try { const s = JSON.parse(sessionStorage.getItem('v2_seat') || 'null'); return s && typeof s === 'object' ? s : null; } catch (e) { return null; } },
  setSeat(v) { try { sessionStorage.setItem('v2_seat', JSON.stringify(v)); } catch (e) {} },
  flag(k, d) { const s = this.raw(k); return s == null ? d : s === '1'; },  // 開關
  setFlag(k, on) { this.setRaw(k, on ? '1' : '0'); },
};

// ---------- 存檔升級：解鎖進度（data/unlocks.js 的 unlockLoad 讀進度時呼叫；用到的表 UNLOCK_STATS、CHAPTERS… 在後面載入，執行時才查）----------
// 要升級就升級一次、存回去：還沒做過 mig 1，或有還沒記過的成績
function unlockMigrate(P) {
  if (P.mig && Object.keys(UNLOCK_STATS).every(k => P.stats.includes(k))) return;
  const { recs, ch } = unlockUpgrade(P, unlockRecords());
  Save.save('records', recs); if (ch) Save.save('chapters', { cleared: ch });
  unlockSave(P);
}
// 2.20.0 以前的遊玩紀錄（沒有版號的是更早的）
const UNLOCK_SINCE = [2, 20, 0];
function recordBefore(build) {
  const m = String(build || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return true;
  const v = m.slice(1).map(Number), i = v.findIndex((x, k) => x !== UNLOCK_SINCE[k]);
  return i >= 0 && v[i] < UNLOCK_SINCE[i];
}
// 遊玩紀錄 → 那一局的成績：紀錄有存 ulk 就用它；2.20.0 的紀錄還沒存，從紀錄的欄位換回來（精英、回響擊殺換不回來，當 0）
function recordRun(rec) {
  if (rec.ulk && typeof rec.ulk === 'object') return rec.ulk;
  const bossId = name => Object.keys(ENEMY_TYPES).find(k => ENEMY_TYPES[k].boss && ENEMY_TYPES[k].name === name);
  const chipByName = name => Object.keys(CHIPS).find(k => CHIPS[k].name === name);
  const play = {};
  for (const [name, v] of Object.entries((rec.mech && rec.mech.playKills) || {})) { const id = chipByName(name); if (id) play[id] = +v || 0; }
  return { sector: +rec.sector || 0, bossIds: (Array.isArray(rec.bosses) ? rec.bosses : []).map(bossId).filter(Boolean),
    weapon: Object.keys(WEAPONS).find(k => String(rec.weapon || '').split('・')[0] === WEAPONS[k].name) || null, kills: +rec.kills || 0, elites: 0, echoK: 0, play };
}
// 存檔升級（P 直接改；回傳要留下的遊玩紀錄、重來的章節進度）
//   mig 1（只做一次）：2.20.0 以前的遊玩紀錄刪掉；章節進度重來，只照留下的紀錄裡通關（或打到無盡）的章
//   沒記過的成績：用留下的紀錄（都是 2.20.0 以後的）補
function unlockUpgrade(P, recs) {
  let ch = null;
  if (!P.mig) {
    recs = recs.filter(r => !recordBefore(r.build));
    ch = [...new Set(recs.filter(r => r.result === 'cleared' || r.endless).map(r => r.chapter))].filter(id => CHAPTERS.some(c => c.id === id)).sort((a, b) => a - b);
    P.ch = ch; P.mig = 1;
  }
  for (const k of Object.keys(UNLOCK_STATS).filter(k => !P.stats.includes(k))) {
    for (const r of recs) UNLOCK_STATS[k](P, recordRun(r));
    P.stats.push(k);
  }
  return { recs, ch };
}
