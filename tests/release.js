'use strict';
// 上傳前檢查（雙人版）：只印摘要，失敗才印細節
//   node release.js               只檢查（不改檔、不提交）
//   node release.js 0.6.3         把版號改成 mp-0.6.3（今天日期＋時間）、README 目前版本、docs/版本紀錄.md「（下一版）」改名，然後檢查
//   node release.js 0.6.3 --push  同上，全部通過才提交並推上 GitHub
// 檢查項目：所有測試、機制檢查（含插座檢查）、要上傳的內容沒有私人資訊、版號跟 GitHub 上不同、README 目前版本、docs/版本紀錄.md
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// git：環境變數 GIT；Windows 預設 Program Files 裡的（不在 PATH）；其他系統用 PATH 上的 git
const GIT = process.env.GIT || (() => {
  const win = process.platform === 'win32' && path.join(process.env.ProgramFiles || '', 'Git', 'cmd', 'git.exe');
  return win && fs.existsSync(win) ? win : 'git';
})();
const REPO = path.join(__dirname, '..');
const TESTS = ['smoke.js', 'range.js', 'e2e.js', 'maptest.js', 'editortest.js', 'beamlag.js'];  // 插座檢查已經併進機制檢查（SockCheck）
const args = process.argv.slice(2);
const push = args.includes('--push');
const newVer = args.find(a => /^\d+(\.\d+)+$/.test(a));

let fails = 0;
// 完整結果另外存一份（沒過的項目附完整內容）：畫面上的輸出被截掉、被過濾時，還能回頭查是哪一項沒過
const LOG = path.join(__dirname, 'release_last.log');
fs.writeFileSync(LOG, `release.js ${args.join(' ')}　${new Date().toLocaleString()}\n`);
const ok = (c, msg, detail = '') => {
  console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`);
  fs.appendFileSync(LOG, `${c ? 'ok  ' : 'FAIL'} ${msg}\n`);
  if (!c) {
    fails++;
    if (detail) console.log(String(detail).trim().split('\n').slice(-15).map(l => '       ' + l).join('\n'));
    if (detail) fs.appendFileSync(LOG, String(detail).trim().split('\n').map(l => '       ' + l).join('\n') + '\n');
  }
};
const git = (...a) => {
  const r = spawnSync(GIT, a, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });  // 差異可能很大（圖集資料檔）
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}：${r.stderr}`);
  return r.stdout;
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const write = (f, t) => fs.writeFileSync(path.join(REPO, f), t);
const VLOG = 'docs/版本紀錄.md';  // 版本紀錄（README 只放目前版本＋連結）
const verOf = src => (src.match(/VERSION: *'([^']+)'/) || [])[1];

// ---- 1. 版號（有指定才改） ----
if (newVer) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;  // 版號戳記：日期＋時間
  const full = `mp-${newVer}（${day}）`, old = verOf(read('js/core/config.js'));
  write('js/core/config.js', read('js/core/config.js').replace(/VERSION: *'[^']+'/,`VERSION: '${full}'`));
  write('README.md', read('README.md').split(`**${old}**`).join(`**${full}**`));
  write(VLOG, read(VLOG).replace('| （下一版） |', `| mp-${newVer} |`));
  console.log(`版號 ${old} → ${full}`);
}

// ---- 2. 測試 ----
for (const t of TESTS) {
  const r = spawnSync(process.execPath, [t], { cwd: __dirname, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  ok(r.status === 0 && /ALL PASSED/.test(out), `測試 ${t}`, out);
}
{
  const r = spawnSync(process.execPath, ['-e',
    "const T=require('./load_game').loadGame();const r=T.MechCheck.runAll();const f=r.list.filter(x=>!x.ok);" +
    "console.log(f.length+'/'+r.list.length);f.forEach(x=>console.log(JSON.stringify(x)))"], { cwd: __dirname, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  ok(r.status === 0 && /^0\/\d+/.test(out.trim()), `機制檢查 ${out.trim().split('\n')[0]}`, out);
}

// ---- 2a. 用了不存在的名字（undefcheck.js：照 index.html 順序解析遊戲、模擬電腦，跑到那一行才會當掉的錯先抓出來）----
{
  const r = spawnSync(process.execPath, ['undefcheck.js'], { cwd: __dirname, encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  ok(r.status === 0, `名字檢查（${out.split('\n')[0]}）`, out);
}

// ---- 2b. 升級健檢（只提醒，不算沒通過）：武器升級價值表過期、第一段太弱、終極偏離、很少升滿（upcheck.js） ----
{
  const r = spawnSync(process.execPath, ['upcheck.js', '--brief'], { cwd: __dirname, encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const msg = r.status === 0 ? out : `升級健檢跑不起來：\n${out.split('\n').slice(-5).join('\n')}`;
  console.log('提醒 ' + msg.split('\n').join('\n     ') + (/沒有警告/.test(msg) ? '' : '\n     （細節：node upcheck.js；只提醒、不擋上傳）'));
  fs.appendFileSync(LOG, '提醒 ' + msg + '\n');
}

// ---- 3. 要上傳的內容（和 GitHub 上的差異＋提交訊息）沒有私人資訊 ----
try { git('fetch', '-q', 'origin'); } catch (e) { console.log('（無法連線 GitHub，用本機記錄的 origin/main 比較）'); }
git('add', '-A');
const diff = git('diff', '--cached', 'origin/main', '--', '.', ':(exclude)assets/atlas_data.js', ':(exclude)assets/*.png');  // 圖集（自動產生的圖片編碼）不用掃
const added = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
const msgs = git('log', 'origin/main..HEAD', '--format=%B').split('\n');
const PRIVATE = [
  [/[\w.+-]+@(?!anthropic\.com|users\.noreply\.github\.com|\d+\.\d)[\w-]+\.[\w.]+/i, 'email'],
  [/[A-Za-z]:\\\\?[\w$]/, '磁碟路徑'],
  [/[\\/]Users[\\/]/i, '使用者資料夾'],
];
// 電腦名稱、帳號這類字詞寫在本機的 private_words.txt（一行一個，不上傳；每台電腦自己建）
try {
  for (const w of fs.readFileSync(path.join(__dirname, 'private_words.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))
    PRIVATE.push([new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '電腦名稱／帳號']);
} catch (e) { console.log('（沒有 private_words.txt：只掃 email、磁碟路徑、使用者資料夾）'); }
const hits = [];
for (const [src, lines] of [['差異', added], ['提交訊息', msgs]])
  for (const l of lines) for (const [re, label] of PRIVATE)
    if (re.test(l) && !/^\+?\s*(Co-Authored-By|Claude-Session):/.test(l)) hits.push(`${src}（${label}）：${l.trim().slice(0, 120)}`);
ok(!hits.length, `私人資訊掃描（${added.length} 行新增）`, hits.slice(0, 15).join('\n'));

// ---- 4. 版號與 README ----
const verLocal = verOf(read('js/core/config.js'));
let verRemote = '';
try { verRemote = verOf(git('show', 'origin/main:js/core/config.js')); } catch (e) {}
const hasChanges = added.length > 0 || git('rev-list', '--count', 'origin/main..HEAD').trim() !== '0';
ok(!hasChanges || verLocal !== verRemote, `版號 ${verLocal}（GitHub 上是 ${verRemote || '？'}）`,
  '有改動但版號沒變：用 node release.js <新版號>');
const readme = read('README.md');
ok(readme.includes(`**${verLocal}**`), 'README 目前版本和 VERSION 一致');
const vlog = read(VLOG);
ok(!vlog.includes('| （下一版） |'), '版本紀錄沒有未命名的「（下一版）」');
const tag = (verLocal || '').split('（')[0];
ok(new RegExp(`\\| ${tag.replace(/\./g, '\\.')} \\|`).test(vlog), `版本紀錄有 ${tag} 這一行`);

// ---- 5. 提交＋上傳 ----
console.log(fails ? `\n${fails} 項沒通過，不上傳` : '\n全部通過');
if (fails) { git('reset', '-q'); process.exit(1); }
if (!push) { git('reset', '-q'); console.log('（只檢查；加 --push 才會提交並上傳）'); process.exit(0); }
if (git('diff', '--cached', '--name-only').trim())
  git('commit', '-q', '-m', `${tag}：版號更新`, '-m', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>');
git('push', '-q');
console.log(`已上傳：${git('log', '--oneline', '-1').trim()}`);
