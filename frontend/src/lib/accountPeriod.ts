// 全局账期（会计账期天数）：付款日期 = 开票日期 + 账期天数。
// 默认 90 天。登录后从用户记录初始化，设置页可修改并触发重新计算。

let currentPeriod = 90;

export function getAccountPeriod(): number {
  return currentPeriod;
}

export function setAccountPeriod(p: number): void {
  const n = Math.max(1, Math.floor(Number(p) || 90));
  currentPeriod = n;
}

/** 从 localStorage 的会话用户初始化账期（刷新页面时调用） */
export function initAccountPeriodFromSession(): void {
  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u && typeof u.account_period === 'number') setAccountPeriod(u.account_period);
    }
  } catch {
    /* ignore */
  }
}
