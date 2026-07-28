// 鉴权：使用 Web Crypto (PBKDF2) 哈希密码，用户记录存于 Supabase users 表。
// 会话仍存于 localStorage（token / user），登录后预热云端缓存（initUserDB）。

import { supabase } from './supabase';
import { initUserDB, clearUserCache } from './db';
import type { User } from './db';
import { setAccountPeriod } from './accountPeriod';

const SESSION_KEY = 'token';
const USER_KEY = 'user';

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

export async function registerUser(data: {
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
  if (error) throw new Error(error.message || '注册失败');

  const user: User = {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    company_name: row.company_name,
    email: row.email,
    account_period: (row as any).account_period ?? 90,
    created_at: row.created_at,
  };
  setSession(user);
  setAccountPeriod(user.account_period);
  await initUserDB(user.id);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

export async function loginUser(data: {
  username: string;
  password: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const { data: row, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', data.username)
    .maybeSingle();
  if (error || !row) throw new Error('用户名或密码错误');

  const ok = await verifyPassword(data.password, row.password_hash);
  if (!ok) throw new Error('用户名或密码错误');

  const user: User = {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    company_name: row.company_name,
    email: row.email,
    account_period: (row as any).account_period ?? 90,
    created_at: row.created_at,
  };
  setSession(user);
  setAccountPeriod(user.account_period);
  await initUserDB(user.id);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

export async function getMe() {
  const id = getCurrentUserId();
  if (!id) throw new Error('未登录');
  const { data: row, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error || !row) throw new Error('未登录');
  return publicUser(row as User);
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

  // 2. 尝试同步到云端（表不存在时静默降级，不阻塞主流程）
  try {
    const { error } = await supabase
      .from('users')
      .update({ account_period: period })
      .eq('id', id);
    if (error) console.warn('账期云端同步跳过（表可能尚未创建）:', error.message);
  } catch (e: any) {
    console.warn('账期云端同步跳过:', e?.message || e);
  }
}
