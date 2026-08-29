// 用户名首字头像生成器：蓝色背景 + 白色首字

const BLUE_BACKGROUNDS = [
  '#1677ff',
  '#0958d9',
  '#2563eb',
  '#1d4ed8',
  '#3b82f6',
  '#0369a1',
  '#0ea5e9',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickBackground(username: string): string {
  const idx = hashString(username) % BLUE_BACKGROUNDS.length;
  return BLUE_BACKGROUNDS[idx];
}

function getInitial(username: string): string {
  if (!username) return '?';
  // 取第一个非空字符，优先中文字符；如果是英文取大写首字母
  const trimmed = username.trim();
  if (!trimmed) return '?';
  const first = trimmed[0];
  // 匹配中文字符
  if (/[\u4e00-\u9fa5]/.test(first)) return first;
  return first.toUpperCase();
}

/**
 * 根据用户名生成首字头像的 data URL（PNG base64）。
 * 默认 128x128，蓝色背景，白色粗体首字。
 */
export function generateAvatar(username: string, size = 128): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const bg = pickBackground(username);
  const initial = getInitial(username);

  // 圆形蓝色背景
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // 白色首字居中
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(size * 0.5)}px sans-serif`;
  ctx.fillText(initial, size / 2, size / 2 + size * 0.05);

  return canvas.toDataURL('image/png');
}
