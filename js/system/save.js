// 星環電路 多人版 · save.js：存檔（瀏覽器 localStorage）唯一的出入口：所有存檔的名稱、讀、寫、刪
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
