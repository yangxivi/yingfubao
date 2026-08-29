// 共享百度 OCR 额度状态（供 OCR 调用后刷新 + 顶栏 UI 订阅）
// 用户未配置自有百度 Key 时，默认使用服务端共享 Key，每月有固定免费额度。

export interface OcrQuota {
  used: number;
  total: number;
}

const QUOTA_STORAGE_KEY = 'yingfubao_ocr_quota_v1';
const PERSONAL_COUNT_KEY = 'yingfubao_ocr_personal_count_v1';

// 个人 OCR 调用计数（按用户 ID），无论走自有 Key 还是共享 Key，每次成功识别 +1，
// 用于在自有 Key 账号顶栏给出「已调用 X 次」的反馈。
function readPersonalCounts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PERSONAL_COUNT_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as Record<string, number>;
  } catch {
    /* ignore */
  }
  return {};
}

function writePersonalCounts(map: Record<string, number>): void {
  try {
    localStorage.setItem(PERSONAL_COUNT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getPersonalOcrUsed(userId: string | null): number {
  if (!userId) return 0;
  const counts = readPersonalCounts();
  return typeof counts[userId] === 'number' ? counts[userId] : 0;
}

export function incrementPersonalOcrUsed(userId: string | null): number {
  if (!userId) return 0;
  const counts = readPersonalCounts();
  counts[userId] = (counts[userId] || 0) + 1;
  writePersonalCounts(counts);
  notifyPersonalListeners(userId);
  return counts[userId];
}

const personalListeners = new Set<(userId: string, used: number) => void>();

function notifyPersonalListeners(userId: string): void {
  const used = getPersonalOcrUsed(userId);
  for (const fn of personalListeners) {
    try { fn(userId, used); } catch { /* ignore */ }
  }
}

export function subscribePersonalOcrUsed(fn: (userId: string, used: number) => void): () => void {
  personalListeners.add(fn);
  return () => personalListeners.delete(fn);
}

export function resetPersonalOcrUsed(userId: string | null): void {
  if (!userId) return;
  const counts = readPersonalCounts();
  delete counts[userId];
  writePersonalCounts(counts);
}

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
