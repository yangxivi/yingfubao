// 本地鉴权：使用 Web Crypto (PBKDF2) 哈希密码，会话存于 localStorage。
// 兼容页面代码读取的 `token` / `user` 键。纯前端，无后端参与。

import { readDB, writeDB } from './db';
import type { User } from './db';

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
  return { id: u.id, username: u.username, company_name: u.company_name, email: u.email };
}

function makeToken(userId: number): string {
  return btoa(`${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
}

export function setSession(user: User): void {
  localStorage.setItem(SESSION_KEY, makeToken(user.id));
  localStorage.setItem(USER_KEY, JSON.stringify(publicUser(user)));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCurrentUserId(): number | null {
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
  const db = readDB();
  if (db.users.some((u) => u.username === data.username)) {
    throw new Error('用户名已存在');
  }
  const id = db.seq.users;
  db.seq.users += 1;
  const user: User = {
    id,
    username: data.username,
    passwordHash: await hashPassword(data.password),
    company_name: data.company_name || '',
    email: data.email || '',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  writeDB(db);
  setSession(user);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

export async function loginUser(data: {
  username: string;
  password: string;
}): Promise<{ access_token: string; user: ReturnType<typeof publicUser> }> {
  const db = readDB();
  const user = db.users.find((u) => u.username === data.username);
  if (!user) throw new Error('用户名或密码错误');
  const ok = await verifyPassword(data.password, user.passwordHash);
  if (!ok) throw new Error('用户名或密码错误');
  setSession(user);
  return { access_token: makeToken(user.id), user: publicUser(user) };
}

export async function getMe() {
  const id = getCurrentUserId();
  if (!id) throw new Error('未登录');
  const db = readDB();
  const user = db.users.find((u) => u.id === id);
  if (!user) throw new Error('未登录');
  return publicUser(user);
}
