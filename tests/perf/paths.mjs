// 截圖、效能腳本共用的路徑（照這個檔案的位置算，換電腦也能用）
//   ROOT：遊戲資料夾（repo 根目錄，結尾有 /）；GAME：同一個資料夾的 file:// 網址；SHOTS：截圖存放處（跟遊戲資料夾同一層的 art_lab/screenshots）
//   CHROME：Chrome 執行檔（環境變數 CHROME_PATH 優先，沒有就照作業系統找常見位置）
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
export const GAME = pathToFileURL(ROOT).href;
export const SHOTS = path.resolve(ROOT, '..', 'art_lab', 'screenshots') + path.sep;
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
const CHROME_AT = { win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'] };
export const CHROME = process.env.CHROME_PATH || (CHROME_AT[process.platform] || []).find(p => fs.existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome：設環境變數 CHROME_PATH 指到 Chrome 執行檔');
