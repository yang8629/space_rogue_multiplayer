// 截圖、效能腳本共用的路徑（照這個檔案的位置算，換電腦也能用）
//   ROOT：遊戲資料夾（repo 根目錄，結尾有 /）；GAME：同一個資料夾的 file:// 網址；SHOTS：截圖存放處（跟遊戲資料夾同一層的 art_lab/screenshots）
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
export const GAME = pathToFileURL(ROOT).href;
export const SHOTS = path.resolve(ROOT, '..', 'art_lab', 'screenshots') + path.sep;
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
