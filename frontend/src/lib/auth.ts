// 鉴权：双模式运行
//   - 云端优先：用户记录存于 Supabase users 表（跨浏览器同步）
//   - 本地降级：Supabase 未初始化时自动降级到 localStorage（单浏览器可用）
// 会话仍存于 localStorage（token / user），登录后预热云端缓存（initUserDB）。

import { supabase } from './supabase';
import { initUserDB, clearUserCache, initLocalCache } from './db';
import type { User } from './db';
import { setAccountPeriod } from './accountPeriod';
import { probeSupabase, type SupabaseStatus } from './supabase-init';

const SESSION_KEY = 'token';
const USER_KEY = 'user';

// 运行模式：云端 / 本地
let authMode: 'cloud' | 'local' = 'cloud';

/** 检查本地模式是否有已注册的用户（供登录页显示引导） */
export function hasLocalUsers(): boolean {
  const users = readLocalUsers();
  return users.length > 0;
}

/** 获取当前鉴权模式 */
export function getAuthMode(): 'cloud' | 'local' {
  return authMode;
}

/** 供外部（如 SetupWizard）在建表完成后切换到云端模式 */
export function setAuthMode(mode: 'cloud' | 'local'): void {
  authMode = mode;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const hash = toHex(bits);
  const saltHex = toHex(salt.buffer);
  return `pbkdf2:${saltHex}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, saltHex, hash] = parts;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(bits) === hash;
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    company_name: u.company_name,
    email: u.email,
    account_period: u.account_period ?? 90,
  };
}

function makeToken(userId: string): string {
  return btoa(`${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
}

export function setSession(user: User): void {
  localStorage.setItem(SESSION_KEY, makeToken(user.id));
  localStorage.setItem(USER_KEY, JSON.stringify(publicUser(user)));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
  clearUserCache();
}

export function getCurrentUserId(): string | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw).id;
  } catch {
    return null;
  }
}

// ===== 云端模式：原逻辑不变 =====

async function cloudRegister(data: {
  username: string;
  password: string;
  company_name?: string;
  email?: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', data.username)
    .maybeSingle();
  if (existing) throw new Error('用户名已存在');

  const { data: row, error } = await supabase
    .from('users')
    .insert({
      username: data.username,
      password_hash: await hashPassword(data.password),
      company_name: data.company_name || '',
      email: data.email || '',
    })
    .select()
    .single();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('row-level security') || msg.includes('rls')) {
      throw new Error('数据库安全策略未配置，请在 Supabase SQL Editor 执行：ALTER TABLE public.users DISABLE ROW LEVEL SECURITY');
    }
    throw new Error(error.message || '注册失败');
  }

  const user = rowToUser(row);
  setSession(user);
  setAccountPeriod(user.account_period);
  await initUserDB(user.id);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

async function cloudLogin(data: {
  username: string;
  password: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const { data: row, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', data.username)
    .maybeSingle();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('row-level security') || msg.includes('rls')) {
      throw new Error('数据库安全策略未配置，请在 Supabase SQL Editor 执行：ALTER TABLE public.users DISABLE ROW LEVEL SECURITY');
    }
    throw new Error('用户名或密码错误');
  }
  if (!row) throw new Error('用户名或密码错误');

  const ok = await verifyPassword(data.password, row.password_hash);
  if (!ok) throw new Error('用户名或密码错误');

  const user = rowToUser(row);
  setSession(user);
  setAccountPeriod(user.account_period);
  await initUserDB(user.id);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

// ===== 本地降级模式：数据存 localStorage =====

const LOCAL_USERS_KEY = 'yingfubao_local_users';
const LEGACY_DB_KEY = 'yingfubao_db_v1'; // 旧版 localStorage 库（含 users）

function readLocalUsers(): User[] {
  let users: User[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    users = raw ? JSON.parse(raw) : [];
  } catch {
    users = [];
  }
  // 合并旧版 localStorage 中的用户，避免老账号（如已存在的 vivi）无法登录
  try {
    const legacy = localStorage.getItem(LEGACY_DB_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      const legacyUsers: User[] = (old.users || []).map((u: any) => ({
        id: String(u.id),
        username: u.username,
        passwordHash: u.passwordHash,
        company_name: u.company_name || '',
        email: u.email || '',
        account_period: u.account_period ?? 90,
        created_at: u.created_at || new Date().toISOString(),
      }));
      const seen = new Set(users.map((u) => u.username));
      let added = false;
      for (const lu of legacyUsers) {
        if (!seen.has(lu.username)) {
          users.push(lu);
          seen.add(lu.username);
          added = true;
        }
      }
      // 把合并后的老账号持久化到新 key，避免下次重复合并
      if (added) writeLocalUsers(users);
    }
  } catch {
    /* ignore */
  }
  return users;
}

function writeLocalUsers(users: User[]): void {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    company_name: row.company_name,
    email: row.email,
    account_period: (row as any).account_period ?? 90,
    created_at: row.created_at,
  };
}

async function localRegister(data: {
  username: string;
  password: string;
  company_name?: string;
  email?: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const users = readLocalUsers();
  if (users.find((u) => u.username === data.username)) throw new Error('用户名已存在');

  const user: User = {
    id: crypto.randomUUID(),
    username: data.username,
    passwordHash: await hashPassword(data.password),
    company_name: data.company_name || '',
    email: data.email || '',
    account_period: 90,
    created_at: new Date().toISOString(),
  };
  users.push(user);
  writeLocalUsers(users);

  setSession(user);
  setAccountPeriod(90);
  // 本地模式：初始化空 DB（从 localStorage 旧格式迁移 + 空库兜底）
  await initLocalDB(user.id);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

async function localLogin(data: {
  username: string;
  password: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const users = readLocalUsers();
  const found = users.find((u) => u.username === data.username);
  if (!found) throw new Error('用户名或密码错误');

  const ok = await verifyPassword(data.password, found.passwordHash);
  if (!ok) throw new Error('用户名或密码错误');

  setSession(found);
  setAccountPeriod(found.account_period);
  await initLocalDB(found.id);
  return { access_token: makeToken(found.id), user: publicUser(found) };
}

/** 本地模式初始化：尝试加载 localStorage 旧数据，否则用空库 */
async function initLocalDB(userId: string): Promise<void> {
  // 复用 db.ts 的本地迁移逻辑
  const LOCAL_KEY = 'yingfubao_db_v1';
  let raw: string | null = null;
  try { raw = localStorage.getItem(LOCAL_KEY); } catch { /* ignore */ }
  if (raw) {
    let old: any;
    try { old = JSON.parse(raw); } catch { return; }
    // 用旧数据的结构初始化 cache
    const suppliers = (old.suppliers || []).filter((s: any) => String(s.userId) === String(userId));
    const invoices = (old.invoices || []).filter((i: any) => String(i.userId) === String(userId));
    initLocalCache(suppliers, invoices);
  }
}

// ===== 统一入口（自动选择模式）=====

/**
 * 探测并锁定鉴权模式。
 * 应在 App 启动时调用一次，之后 getAuthMode() 返回锁定结果。
 * 返回探测状态供 UI 决定是否显示 SetupWizard。
 */
export async function detectAndLockAuthMode(): Promise<SupabaseStatus> {
  const result = await probeSupabase();
  if (result.status === 'ready') {
    authMode = 'cloud';
  } else {
    authMode = 'local';
  }
  return result.status;
}

/**
 * 将当前本地登录的用户同步到云端 users 表（保留原 id / passwordHash / account_period）。
 * 用于「本地模式 → 云端模式」切换时，确保账号记录存在于云端，
 * 否则发票/供应商迁移会因外键约束失败。幂等：已存在则跳过。
 */
export async function syncCurrentUserToCloud(): Promise<void> {
  const id = getCurrentUserId();
  if (!id) return;
  const localUsers = readLocalUsers();
  const me = localUsers.find((u) => u.id === id);
  if (!me) return;

  // 检查云端是否已有该用户
  const { data } = await supabase.from('users').select('id').eq('id', id).maybeSingle();
  if (data) return; // 已存在，跳过

  // 插入到云端（保留原 id，确保外键一致）
  const { error } = await supabase.from('users').insert({
    id: me.id,
    username: me.username,
    password_hash: me.passwordHash,
    company_name: me.company_name,
    email: me.email,
    account_period: me.account_period,
  });
  if (error) console.warn('同步账号到云端失败:', error.message);
}

export async function registerUser(data: {
  username: string;
  password: string;
  company_name?: string;
  email?: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  if (authMode === 'cloud') {
    return cloudRegister(data);
  }
  return localRegister(data);
}

export async function loginUser(data: {
  username: string;
  password: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  if (authMode === 'cloud') {
    // 云端模式下如果表突然不可用，自动降级
    try {
      return await cloudLogin(data);
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('table')) {
        console.warn('云端 users 表不可用，降级到本地模式');
        authMode = 'local';
        return localLogin(data);
      }
      // 云端无此账号，但本地（localStorage）有 → 自动把本地账号迁入云端并重试登录，
      // 之后 initUserDB 内的 migrateLocalIfNeeded 会把本地发票/供应商一并同步上云。
      if (msg.includes('用户名或密码错误')) {
        const local = readLocalUsers().find((u) => u.username === data.username);
        if (local && (await verifyPassword(data.password, local.passwordHash))) {
          try {
            const { error } = await supabase.from('users').insert({
              id: local.id,
              username: local.username,
              password_hash: local.passwordHash,
              company_name: local.company_name,
              email: local.email,
              account_period: local.account_period,
            });
            if (!error) {
              return await cloudLogin(data);
            }
          } catch {
            /* 落到下方继续抛错 */
          }
        }
      }
      throw e;
    }
  }
  return localLogin(data);
}

export async function getMe() {
  const id = getCurrentUserId();
  if (!id) throw new Error('未登录');
  if (authMode === 'cloud') {
    const { data: row, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (error || !row) throw new Error('未登录');
    return publicUser(row as User);
  }
  // 本地模式
  const users = readLocalUsers();
  const found = users.find((u) => u.id === id);
  if (!found) throw new Error('未登录');
  return publicUser(found);
}

/** 返回当前会话用户（含 account_period），未登录返回 null */
export function getCurrentUser(): ReturnType<typeof publicUser> | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 更新当前用户的账期天数，并同步本地会话；云端同步尽力而为 */
export async function updateAccountPeriod(period: number): Promise<void> {
  const id = getCurrentUserId();
  if (!id) throw new Error('未登录');

  // 1. 先更新本地会话（始终生效）
  const raw = localStorage.getItem(USER_KEY);
  if (raw) {
    try {
      const u = JSON.parse(raw);
      u.account_period = period;
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  }
  setAccountPeriod(period);

  // 2. 云端模式：同步到 Supabase users 表
  if (authMode === 'cloud') {
    try {
      const { error } = await supabase
        .from('users')
        .update({ account_period: period })
        .eq('id', id);
      if (error) console.warn('账期云端同步跳过:', error.message);
    } catch (e: any) {
      console.warn('账期云端同步跳过:', e?.message || e);
    }
  }

  // 3. 本地模式：更新本地用户记录
  if (authMode === 'local') {
    const users = readLocalUsers();
    const idx = users.findIndex((u) => u.id === id);
    if (idx >= 0) {
      users[idx].account_period = period;
      writeLocalUsers(users);
    }
  }
}
