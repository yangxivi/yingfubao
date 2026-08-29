// 共享百度 OCR 额度状态（供 OCR 调用后刷新 + 顶栏 UI 订阅）
// 用户未配置自有百度 Key 时，默认使用服务端共享 Key，每月有固定免费额度。

export interface OcrQuota {
  used: number;
  total: number;
}

let lastQuota: OcrQuota | null = null;
const listeners = new Set<(q: OcrQuota | null) => void>();

export function getOcrQuota(): OcrQuota | null {
  return lastQuota;
}

export function setOcrQuota(q: OcrQuota | null): void {
  lastQuota = q;
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
