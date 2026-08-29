// 通过 Supabase Management API 部署 Edge Function
// 正确用法：multipart 中 `file` 为源文件数组（字段名固定为 file，filename 携带相对路径），
// `metadata` 为 JSON（entrypoint_path 相对 source 根目录）。
import fs from 'node:fs';
import path from 'node:path';

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const REF = 'dpbtqwfbprartiogydqg';
const SLUG = 'baidu-ocr';
const SRC = path.resolve('supabase/functions/baidu-ocr/index.ts');
const ENTRY = 'index.ts';

if (!PAT) {
  console.error('请设置 SUPABASE_ACCESS_TOKEN 环境变量');
  process.exit(1);
}

const form = new FormData();
const buf = fs.readFileSync(SRC);
// 字段名必须是 file，filename 使用 entrypoint 相对路径
form.append('file', new Blob([buf], { type: 'application/typescript' }), ENTRY);
form.append(
  'metadata',
  new Blob(
    [
      JSON.stringify({
        entrypoint_path: ENTRY,
        verify_jwt: false,
        name: SLUG,
      }),
    ],
    { type: 'application/json' },
  ),
  'metadata.json',
);

const url = `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${SLUG}`;

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}` },
  body: form,
});

const text = await res.text();
console.log('HTTP', res.status);
console.log(text.slice(0, 2000));
