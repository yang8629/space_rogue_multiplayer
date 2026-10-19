// 星環電路 雙人版 · chapters.js：章節（每章重複使用星區，換王、換強度）與章節進度
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CHAPTERS — 一章 = 一趟遠征：從 sectors[0] 打到 sectors[1]，打完可以繼續無盡模式
//   sector 是真正的星區編號（難度、主題小兵、商店價格都照它算），章節只決定從哪打到哪、每個星區的王
//   hp：敵人血量再 ×；dmg：飛船受到的傷害再 ×（都乘在原本的難度上）
//   start：從星區 2 以後開始的章節，補上前面星區大概會拿到的東西（晶體、武器插座、電路格、幾次三選一）
//   eliteW：精英池的權重再乘（CFG.ELITE_POOL；沒寫的 ×1）：照章節的故事偏向某幾種精英
//   每章最後一個星區的王是那章專屬的（第一章終焉核心、第二章雙子獵艦、第三章星環守門者）
// =====================================================================
const CHAPTERS = [
  { id: 1, name: '第一章　突破封鎖', sectors: [1, 3], bosses: { 1: 'boss', 2: 'boss2', 3: 'boss3' }, hp: 1, dmg: 1, start: null,
    intro: '星環邊境被封鎖了。一路往內打，找出封鎖的源頭。',
    outro: '終焉核心停止運轉，封鎖解除了。但獵艦的殘骸不見了——它們還會回來。' },
  { id: 2, name: '第二章　獵艦反撲', sectors: [1, 3], bosses: { 1: 'boss2', 2: 'boss', 3: 'boss4' }, hp: 1.15, dmg: 1.1, start: null, eliteW: { wing: 2 },  // 獵艦的艦隊：多出三艦編隊
    intro: '裂界獵艦帶著更強的艦隊回來了，這次它們搶先一步守在入口。',
    outro: '雙子獵艦沉沒了，獵艦的反撲到此為止。殘骸裡的訊號指向星環更深處。' },
  { id: 3, name: '第三章　深入星環', sectors: [2, 3], bosses: { 2: 'boss', 3: 'boss5' }, hp: 1.25, dmg: 1.15, eliteW: { tractor: 1.5, artillery: 1.5 },  // 星環內側的守備：多出拖曳艦、砲艦
    start: { credits: 60, wSock: 1, slots: 1, picks: 3 },
    intro: '直接跳進星環內側。外圍已經打通，沒有時間慢慢準備了。',
    outro: '守門者倒下，星環內側的門打開了。訊號的源頭就在更深處……（待續）' },
];
const CHAPTER_KEY = 'v2_chapters';  // 章節進度存在瀏覽器的名稱：{ cleared: [已通關的章號] }

function chapterById(id) { return CHAPTERS.find(c => c.id === id) || CHAPTERS[0]; }
// 已通關的章號；存檔壞掉（不是 JSON、格式不對）就當成都沒通關
function chapterProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(CHAPTER_KEY) || '{}');
    return p && Array.isArray(p.cleared) ? p.cleared.filter(n => CHAPTERS.some(c => c.id === n)) : [];
  } catch (e) { return []; }
}
// 第一章一開始就能玩；之後每章要先通關前一章
function chapterUnlocked(id) { return id === CHAPTERS[0].id || chapterProgress().includes(id - 1); }
function markChapterCleared(id) {
  const c = chapterProgress();
  if (c.includes(id)) return;
  c.push(id);
  try { localStorage.setItem(CHAPTER_KEY, JSON.stringify({ cleared: c })); } catch (e) {}
}
