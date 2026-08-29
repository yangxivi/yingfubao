// 桌面端运行环境探测与 IPC 便捷封装。
// 该模块在浏览器/网站端也会被 import，但不能在模块顶层触碰任何 Node / Electron API，
// 否则 Vite 网站构建会报错。所有 Node 能力都通过 window.electronAPI（由 preload 注入）访问。

import type { ElectronAPI } from '../electron';

/** 是否在 Electron 桌面端运行（window.electronAPI 由 preload.js 注入）。 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

/** 类型安全的 electronAPI 访问（非桌面端返回 undefined）。 */
export function electronAPI(): ElectronAPI | undefined {
  return isDesktop() ? (window as any).electronAPI : undefined;
}

/** 桌面端是否配置了用户自有的百度 OCR Key（设置页写入 localStorage）。 */
export interface BaiduOcrConfig {
  apiKey: string;
  secretKey: string;
}
const BAIDU_KEY_STORE = 'yingfubao_baidu_ocr';

export function getBaiduOcrConfig(): BaiduOcrConfig | null {
  try {
    const raw = localStorage.getItem(BAIDU_KEY_STORE);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj?.apiKey && obj?.secretKey) return obj as BaiduOcrConfig;
  } catch {
    /* ignore */
  }
  return null;
}

export function setBaiduOcrConfig(cfg: BaiduOcrConfig | null): void {
  if (cfg) localStorage.setItem(BAIDU_KEY_STORE, JSON.stringify(cfg));
  else localStorage.removeItem(BAIDU_KEY_STORE);
}

export function hasBaiduOcrConfig(): boolean {
  return getBaiduOcrConfig() !== null;
}
