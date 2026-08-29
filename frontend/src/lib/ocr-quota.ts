// 共享百度 OCR 额度状态（供 OCR 调用后刷新 + 顶栏 UI 订阅）
// 用户未配置自有百度 Key 时，默认使用服务端共享 Key，每月有固定免费额度。

export interface OcrQuota {
  used: number;
  total: number;
}

const QUOTA_STORAGE_KEY = 'yingfubao_ocr_quota_v1';

function readStoredQuota(): OcrQuota | null {
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj.used === 'number' && typeof obj.total === 'number') {
      return { used: obj.used, total: obj.total };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeStoredQuota(q: OcrQuota | null): void {
  try {
    if (q) localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(q));
    else localStorage.removeItem(QUOTA_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

let lastQuota: OcrQuota | null = readStoredQuota();
const listeners = new Set<(q: OcrQuota | null) => void>();

export function getOcrQuota(): OcrQuota | null {
  return lastQuota;
}

export function setOcrQuota(q: OcrQuota | null): void {
  lastQuota = q;
  writeStoredQuota(q);
  for (const fn of listeners) {
    try { fn(q); } catch { /* ignore */ }
  }
}

export function subscribeOcrQuota(fn: (q: OcrQuota | null) => void): () => void {
  listeners.add(fn);
  fn(lastQuota);
  return () => listeners.delete(fn);
}

export function isQuotaExhausted(q: OcrQuota | null): boolean {
  if (!q) return false;
  return q.used >= q.total && q.total > 0;
}

/** 清空本地额度缓存（例如切换账号或退出登录时调用） */
export function clearOcrQuota(): void {
  setOcrQuota(null);
}
