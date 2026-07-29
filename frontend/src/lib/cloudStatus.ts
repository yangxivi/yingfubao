// 云端同步状态的全局可读存储（模块级单例）
// 由 App 在启动时调用 setCloudStatus 写入，Layout 等组件通过 getCloudStatus 读取显示。
import type { SupabaseStatus } from './supabase-init';

let status: SupabaseStatus | null = null;

export function setCloudStatus(s: SupabaseStatus | null): void {
  status = s;
}

export function getCloudStatus(): SupabaseStatus | null {
  return status;
}
