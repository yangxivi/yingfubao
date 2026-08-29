// 发票 OCR：统一使用百度高精度通用文字识别（accurate_basic）提取文字，
// 再用正则 + 版面锚点解析出结构化字段。
//
// 调用路径：
// - 桌面端且配置了自有百度 Key：主进程直连百度（规避 CORS、不占共享额度）。
// - 其它情况：通过 Supabase Edge Function（baidu-ocr）使用共享百度 Key，共享额度 800 次/月。
//
// 其它：
// - PDF 支持：pdfjs 渲染成图片后逐页送百度。
// - 字段提取逻辑（parseStructured 等）完全复用，这是核心资产，不动。
// - 注：早期版本内置过本机离线 RapidOCR（PP-OCRv4）引擎，现已移除。

import { supabase } from './supabase';
import { getAuthMode } from './auth';
import { isDesktop, electronAPI, getBaiduOcrConfig } from './desktop-env';
import { setOcrQuota } from './ocr-quota';

export interface OcrResult {
  invoice_no: string;
  invoice_date: string;
  seller_name: string;
  seller_tax_id: string;
  buyer_name: string;
  buyer_tax_id: string;
  amount_excluding_tax: number;
  tax_amount: number;
  total_amount: number;
  tax_rate: string;
  items: any[];
  raw_text: string;
}

export interface OcrQuota {
  used: number;
  total: number;
}

// ===== 图片/Canvas → base64（去 data: 前缀，百度要求纯 base64）=====
function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || '';
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

// 压缩图片到最长边 maxSide，转 jpeg base64（减小上传体积，百度对 base64 大小有限制）
async function imageToCompressedBase64(file: File, maxSide = 2000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToBase64(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PDF → 每页渲染成 canvas（百度 OCR 不直接收 PDF，需前端转图）
async function pdfToImages(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjsLib = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 1800 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas);
  }
  return out;
}

// ===== 调用 Supabase Edge Function（baidu-ocr）获取共享额度 =====
export async function fetchSharedOcrQuota(): Promise<OcrQuota | null> {
  // 桌面端优先走主进程代理，规避 app:// 协议下的 CORS 拦截
  const api = electronAPI();
  if (isDesktop() && api?.ocrShared) {
    try {
      const r = await api.ocrShared({ action: 'quota' });
      const q = r?.data?.quota as OcrQuota | null;
      if (q) {
        setOcrQuota(q);
        return q;
      }
    } catch (e: any) {
      console.warn('[ocr-quota] 主进程代理获取失败：', e?.message || e);
    }
  }

  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('baidu-ocr', {
      body: { action: 'quota' },
    });
    if (error) {
      console.warn('[ocr-quota] 获取失败：', error.message);
      return null;
    }
    const q = data?.quota as OcrQuota | null;
    if (q) setOcrQuota(q);
    return q;
  } catch (e: any) {
    console.warn('[ocr-quota] 获取失败：', e?.message || e);
    return null;
  }
}

// ===== 调用百度 OCR =====
async function callBaiduOcr(base64: string): Promise<string> {
  // 桌面端且用户配置了自有百度 Key：主进程直连百度，规避 CORS、不占共享额度
  if (isDesktop()) {
    const cfg = getBaiduOcrConfig();
    if (cfg) {
      const api = electronAPI();
      if (api?.baiduOcr) {
        return (await api.baiduOcr(base64, cfg.apiKey, cfg.secretKey)) || '';
      }
    }

    // 桌面端未配自有 Key：走主进程代理调用共享 baidu-ocr（规避渲染进程 CORS）
    const api = electronAPI();
    if (api?.ocrShared) {
      try {
        const r = await api.ocrShared({ image: base64 });
        const d = r?.data;
        if (d?.quota) setOcrQuota(d.quota);
        if (d?.error) {
          throw new Error(d.error);
        }
        if (r?.status && r.status >= 400) {
          throw new Error(d?.error || `共享 OCR 调用失败（HTTP ${r.status}）`);
        }
        return d?.raw_text || '';
      } catch (e: any) {
        // 代理失败回退到下方 supabase 直连（若可用）
        console.warn('[ocr] 主进程代理失败，回退：', e?.message || e);
      }
    }
  }

  if (!supabase) {
    throw new Error(
      '未配置 Supabase（百度 OCR 不可用）。请在 frontend/.env 填写 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY',
    );
  }

  const { data, error } = await supabase.functions.invoke('baidu-ocr', {
    body: { image: base64 },
  });

  if (error) {
    throw new Error('调用百度 OCR 失败：' + (error.message || '网络错误'));
  }
  if (data?.error) {
    // 共享额度用完时，Edge Function 返回 429 + quota
    if (data.quota) setOcrQuota(data.quota);
    throw new Error(data.error);
  }
  if (data?.quota) setOcrQuota(data.quota);
  return data?.raw_text || '';
}

/**
 * 单页识别路由（仅桌面端使用）：
 * - 桌面端若用户配置了自有百度 Key，主进程直连百度。
 * - 否则通过 Supabase Edge Function 使用共享百度 Key（受 800 次/月配额限制）。
 */
async function ocrPage(b64: string): Promise<string> {
  const text = await callBaiduOcr(b64);
  return text || '';
}

// ===== 模糊匹配工具（百度也可能误识别个别锚点词，容错）=====
const FUZZY_MAP: Record<string, string[]> = {
  '销售方': ['销方', '销 售方', '销售 方', '销舊方', '銷售方', '销舊'],
  '购买方': ['购方', '购 买方', '购买 方', '購買方', '購方'],
  '名称': ['名 称', '名称:', '名称：', '称:'],
  '纳税人识别号': ['纳税人识别号码', '纳税号', '纳税人号', '统一社会信用代码', '信用代码', '纳税人识别',
                   '纳稅人识别号', '納稅人識別號', '识别号', '税号'],
  '价税合计': ['价税合計', '价 税合计', '价税 合计', '價稅合計', '合计'],
  '小写': ['小写)', '(小写', '小写）', '（小写', '小写 ', '小写)'],
  '开票日期': ['开票日期:', '开票日期：', '开票曰期', '开票日期 '],
  '发票号码': ['发票号码:', '发票号码：', '发票号码 ', '发票号码)'],
};

/** 检查文本是否包含目标锚点（支持模糊匹配常见 OCR 误识别） */
function hasAnchor(text: string, anchor: string): boolean {
  if (text.includes(anchor)) return true;
  const alts = FUZZY_MAP[anchor];
  if (alts) {
    for (const alt of alts) {
      if (text.includes(alt)) return true;
    }
  }
  return false;
}

function parseDate(text: string): string | null {
  let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  return null;
}

function parseAmount(text: string): number | null {
  const clean = text.replace(/[¥￥$€,，\s]/g, '').trim();
  const m = clean.match(/^(\d+\.?\d*)$/);
  if (m) {
    const v = parseFloat(m[1]);
    return isNaN(v) || v <= 0 ? null : v;
  }
  const m2 = clean.match(/(\d+\.?\d*)/);
  if (m2) {
    const v = parseFloat(m2[1]);
    return isNaN(v) || v <= 0 ? null : v;
  }
  return null;
}

function parseTaxId(text: string): string | null {
  const m = text.match(/([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})/i);
  if (m) return m[1].toUpperCase();
  const m2 = text.match(/\b(\d{15}|\d{17}|\d{20})\b/);
  if (m2 && !text.match(/\d{20}/)) return m2[1];
  return null;
}

function companyNames(lines: string[]): string[] {
  const names: string[] = [];
  for (const s of lines) {
    if (
      (s.includes('公司') || s.includes('厂') || s.includes('有限') || s.includes('中心')) &&
      s.length >= 4 &&
      s.length <= 40 &&
      !/^[0-9\s年明月日¥￥]+$/ .test(s)
    ) {
      names.push(s.trim());
    }
  }
  return Array.from(new Set(names));
}

function findLineIndex(lines: string[], anchor: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (hasAnchor(lines[i], anchor)) return i;
  }
  return -1;
}

function extractBlock(lines: string[], startIdx: number, endIdx?: number): string {
  const end = endIdx ?? lines.length;
  return lines.slice(startIdx, end).join(' ');
}

/**
 * 解析增值税发票结构化字段（基于版面锚点 + 模糊匹配）。
 * 1. 锚点匹配使用 hasAnchor() 容错
 * 2. 价税合计：多级回退，确保不为 0
 * 3. 销售方名称/税号：区域定位 + 全文兜底双重保障
 */
function parseStructured(full: string, lines: string[]): OcrResult {
  // ---- 1. 发票号 ----
  let invoice_no = '';
  let m = full.match(/发票号码[：:\s]*(\d{8,20})/);
  if (!m) m = full.match(/发票号码[号码碼：:\s]*(\d{8,20})/);
  if (m) invoice_no = m[1].trim();
  else {
    const m2 = full.match(/\b(\d{20})\b/);
    if (m2) invoice_no = m2[1];
    else {
      const nums = full.match(/\b(\d{8,20})\b/g);
      if (nums && nums.length > 0) invoice_no = nums[0];
    }
  }

  // ---- 2. 开票日期 ----
  let invoice_date = '';
  for (const t of lines) {
    const d = parseDate(t);
    if (d) { invoice_date = d; break; }
  }

  // ---- 3. 价税合计（多级回退，确保不为 0）----
  let total_amount = 0;

  const patterns_small = [
    /(?:小写|小写\s*[)）]|（\s*小写\s*[)）])[^\d]*?[￥¥]\s*([\d,]+\.?\d*)/i,
    /[￥¥]\s*([\d,]+\.?\d*)\s*\(.*?小.*?\)/i,
  ];
  for (const pat of patterns_small) {
    const sm = full.match(pat);
    if (sm) {
      total_amount = parseFloat(sm[1].replace(/,/g, '')) || 0;
      if (total_amount > 0) break;
    }
  }

  if (total_amount <= 0) {
    const totalPatterns = [
      /价税合计[^￥¥\d]*(?:￥|¥)\s*([\d,]+\.?\d*)/i,
      /价税合计[^(]*?[￥¥]?\s*([\d,]+\.?\d*)/i,
      /合计[^￥¥\d]*(?:￥|¥)\s*([\d,]+\.?\d*)/i,
    ];
    for (const pat of totalPatterns) {
      const tm = full.match(pat);
      if (tm) {
        total_amount = parseFloat(tm[1].replace(/,/g, '')) || 0;
        if (total_amount > 0) break;
      }
    }
  }

  if (total_amount <= 0) {
    const amounts: number[] = [];
    for (const t of lines) {
      if (t.includes('¥') || t.includes('￥')) {
        const a = parseAmount(t);
        if (a && a >= 1 && a < 1e10) amounts.push(a);
      }
    }
    amounts.sort((a, b) => b - a);
    if (amounts.length > 0) total_amount = amounts[0];
  }

  if (total_amount <= 0) {
    const allAmounts: number[] = [];
    for (const t of lines) {
      const a = parseAmount(t);
      if (a && a >= 1 && a < 1e10) allAmounts.push(a);
    }
    allAmounts.sort((a, b) => b - a);
    if (allAmounts.length > 0) total_amount = allAmounts[0];
  }

  // ---- 不含税金额与税额 ----
  let amount_excluding_tax = 0;
  let tax_amount = 0;

  const tableAmounts: number[] = [];
  for (const t of lines) {
    if (hasAnchor(t, '合计') || hasAnchor(t, '价税合计') || hasAnchor(t, '小写')) continue;
    const a = parseAmount(t);
    if (a && a >= 1 && a !== total_amount && a < 1e10) tableAmounts.push(a);
  }
  const uniqTable = Array.from(new Set(tableAmounts.map((a) => Math.round(a * 100) / 100))).sort((a, b) => b - a);

  if (uniqTable.length >= 1 && uniqTable[0] < total_amount) {
    amount_excluding_tax = uniqTable[0];
    tax_amount = Math.round((total_amount - amount_excluding_tax) * 100) / 100;
  } else if (total_amount > 0) {
    amount_excluding_tax = Math.round(total_amount / 1.13 * 100) / 100;
    tax_amount = Math.round(total_amount - amount_excluding_tax);
  }

  // ---- 4. 税率 ----
  let tax_rate = '';
  const rm = full.match(/(\d{1,2}(?:\.\d+)?)\s*[%％]/);
  if (rm) tax_rate = `${rm[1]}%`;

  // ---- 5. 销售方名称 ----
  let seller_name = '';
  let buyer_name = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const contextBefore = lines.slice(Math.max(0, i - 5), i).join(' ');
    const isSellerZone = hasAnchor(contextBefore, '销售方');
    const isBuyerZone = hasAnchor(contextBefore, '购买方');

    const nameMatch = line.match(/名称[：:\s]*([^\n\r]{4,40}?)/);
    if (nameMatch) {
      const candidate = nameMatch[1].trim().replace(/[：:\s]+$/, '');
      if (candidate.length >= 4 && candidate.length <= 40 &&
          (candidate.includes('公司') || candidate.includes('厂') || candidate.includes('有限') || candidate.includes('中心'))) {
        if (isSellerZone && !seller_name) seller_name = candidate;
        else if (isBuyerZone && !buyer_name) buyer_name = candidate;
      }
    }
  }

  if (!seller_name) {
    const sellerIdx = findLineIndex(lines, '销售方');
    if (sellerIdx >= 0) {
      const buyerIdx = findLineIndex(lines, '购买方');
      const blockEnd = buyerIdx > sellerIdx ? buyerIdx : lines.length;
      const block = extractBlock(lines, sellerIdx + 1, blockEnd);
      const companiesInBlock = companyNames(block.split(' ').filter(Boolean));
      if (companiesInBlock.length > 0) seller_name = companiesInBlock[0];
    }
  }
  if (!buyer_name) {
    const buyerIdx = findLineIndex(lines, '购买方');
    if (buyerIdx >= 0) {
      const sellerIdx = findLineIndex(lines, '销售方');
      const blockStart = sellerIdx >= 0 && sellerIdx < buyerIdx ? buyerIdx : 0;
      const block = extractBlock(lines, buyerIdx + 1);
      const companiesInBlock = companyNames(block.split(' ').filter(Boolean));
      if (companiesInBlock.length > 0) buyer_name = companiesInBlock[0];
    }
  }

  if (!seller_name || !buyer_name) {
    const allCompanies = companyNames(lines);
    if (allCompanies.length >= 2) {
      if (!seller_name) seller_name = allCompanies[1];
      if (!buyer_name) buyer_name = allCompanies[0];
    } else if (allCompanies.length === 1) {
      if (!seller_name) seller_name = allCompanies[0];
      if (!buyer_name) buyer_name = allCompanies[0];
    }
  }

  if (seller_name && (seller_name.includes('三力') || seller_name.includes('购方'))) {
    [buyer_name, seller_name] = [seller_name, buyer_name];
  }

  // ---- 6. 税号（v4: 同行/近行列位置顺序配对）----
  let seller_tax_id = '';
  let buyer_tax_id = '';

  interface NameEntry { name: string; lineIdx: number; colPos: number }
  const nameEntries: NameEntry[] = [];
  const nameRe = /名称[：:\s]*([^\n\r：:]{4,40})/gi;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(lines[i])) !== null) {
      const candidate = m[1].trim().replace(/[：:\s]+$/, '');
      if (candidate.length >= 4 && candidate.length <= 40) {
        nameEntries.push({ name: candidate, lineIdx: i, colPos: m.index });
      }
    }
  }

  interface TaxEntry { id: string; lineIdx: number; colPos: number }
  const taxEntries: TaxEntry[] = [];
  const taxRe = /(?:纳税人识别号|纳税人识别号码|统一社会信用代码|信用代码|纳税号|识别号)[号碼：:\s]*([0-9A-HJ-NPQRTUWXY]{18})/gi;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    while ((m = taxRe.exec(lines[i])) !== null) {
      taxEntries.push({ id: m[1].toUpperCase(), lineIdx: i, colPos: m.index });
    }
  }

  if (nameEntries.length >= 2 && taxEntries.length >= 2) {
    const nameLineIdxs = nameEntries.map(e => e.lineIdx);
    const nameMinLine = Math.min(...nameLineIdxs);
    const nameMaxLine = Math.max(...nameLineIdxs);
    const nameRegion = nameEntries.filter(e => e.lineIdx >= nameMinLine && e.lineIdx <= nameMaxLine + 1);

    const taxLineIdxs = taxEntries.map(e => e.lineIdx);
    const taxMinLine = Math.min(...taxLineIdxs);
    const taxMaxLine = Math.max(...taxLineIdxs);
    const taxRegion = taxEntries.filter(e => e.lineIdx >= taxMinLine && e.lineIdx <= taxMaxLine + 1);

    const sortedNames = [...nameRegion].sort((a, b) => a.colPos - b.colPos);
    const sortedTaxes = [...taxRegion].sort((a, b) => a.colPos - b.colPos);

    const pairCount = Math.min(sortedNames.length, sortedTaxes.length);
    for (let p = 0; p < pairCount; p++) {
      const n = sortedNames[p].name;
      const t = sortedTaxes[p].id;

      if (n === seller_name && !seller_tax_id) { seller_tax_id = t; continue; }
      if (n === buyer_name && !buyer_tax_id) { buyer_tax_id = t; continue; }

      const matchSeller = seller_name && (
        n.includes(seller_name) || seller_name.includes(n)
      ) && Math.abs(n.length - seller_name.length) <= 4;
      const matchBuyer = buyer_name && (
        n.includes(buyer_name) || buyer_name.includes(n)
      ) && Math.abs(n.length - buyer_name.length) <= 4;

      if (matchSeller && !seller_tax_id) { seller_tax_id = t; }
      else if (matchBuyer && !buyer_tax_id) { buyer_tax_id = t; }
    }
  }

  if ((!seller_tax_id || !buyer_tax_id) && taxEntries.length > 0) {
    const sIdx = findLineIndex(lines, '销售方');
    const bIdx = findLineIndex(lines, '购买方');

    if (sIdx >= 0 && bIdx >= 0) {
      const firstIdx = Math.min(sIdx, bIdx);
      const secondIdx = Math.max(sIdx, bIdx);
      const firstIsSeller = sIdx < bIdx;

      for (const t of taxEntries) {
        if (t.lineIdx > firstIdx && t.lineIdx < secondIdx) {
          if (firstIsSeller && !seller_tax_id) seller_tax_id = t.id;
          else if (!firstIsSeller && !buyer_tax_id) buyer_tax_id = t.id;
        } else if (t.lineIdx > secondIdx) {
          if (!firstIsSeller && !seller_tax_id) seller_tax_id = t.id;
          else if (firstIsSeller && !buyer_tax_id) buyer_tax_id = t.id;
        }
      }
    }

    if (!seller_tax_id && sIdx >= 0) {
      const blockEnd = bIdx > sIdx ? bIdx : lines.length;
      const stid = parseTaxId(extractBlock(lines, sIdx + 1, blockEnd));
      if (stid) seller_tax_id = stid;
    }
    if (!buyer_tax_id && bIdx >= 0) {
      const blockStart = sIdx >= 0 && sIdx < bIdx ? bIdx : 0;
      const btid = parseTaxId(extractBlock(lines, blockStart));
      if (btid) buyer_tax_id = btid;
    }
  }

  if (!seller_tax_id || !buyer_tax_id) {
    const uniqGlobal = Array.from(new Set(taxEntries.map((t) => t.id)));
    if (!buyer_tax_id && uniqGlobal[0]) buyer_tax_id = uniqGlobal[0];
    if (!seller_tax_id && uniqGlobal[1]) seller_tax_id = uniqGlobal[1];
    else if (!seller_tax_id && uniqGlobal[0]) seller_tax_id = uniqGlobal[0];
  }
  return {
    invoice_no,
    invoice_date,
    seller_name,
    seller_tax_id,
    buyer_name,
    buyer_tax_id,
    amount_excluding_tax: Math.round(amount_excluding_tax * 100) / 100,
    tax_amount: Math.round(tax_amount * 100) / 100,
    total_amount: Math.round(total_amount * 100) / 100,
    tax_rate,
    items: [],
    raw_text: full.slice(0, 2000),
  };
}

export async function recognizeInvoice(
  file: File,
  onProgress?: (current: number, total: number) => void,
): Promise<OcrResult> {
  // ===== 桌面端：自有百度 Key 直连；否则走 Supabase Edge Function 共享 Key =====
  if (isDesktop()) {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    const pagesText: string[] = [];

    if (isPdf) {
      try {
        const canvases = await pdfToImages(file);
        for (let i = 0; i < canvases.length; i++) {
          const b64 = canvasToBase64(canvases[i]);
          pagesText.push(await ocrPage(b64));
          onProgress?.(i + 1, canvases.length);
        }
      } catch (e: any) {
        throw new Error('PDF 解析失败：' + (e.message || '文件可能损坏或加密'));
      }
    } else {
      const b64 = await imageToCompressedBase64(file);
      pagesText.push(await ocrPage(b64));
      onProgress?.(1, 1);
    }

    const full = pagesText.join('\n');
    const lines = full
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error(
        '百度 OCR 未能识别出文字。请检查图片是否清晰、完整，或换一张图片重试。',
      );
    }

    return parseStructured(full, lines);
  }

  // ===== 非桌面（网站端）：原云端逻辑 =====
  // 本地模式（未配置/未连接 Supabase）下没有云端百度 OCR 能力。
  // 优雅降级：返回空结果，上传流程据此创建空白发票供用户手动填写，
  // 避免本地模式下「上传发票」直接崩溃（此前会抛「未配置 Supabase」）。
  if (getAuthMode() === 'local') {
    console.warn('[ocr] 本地模式未配置 Supabase，跳过云端 OCR，将创建空白发票供手动填写');
    return {
      invoice_no: '',
      invoice_date: '',
      seller_name: '',
      seller_tax_id: '',
      buyer_name: '',
      buyer_tax_id: '',
      amount_excluding_tax: 0,
      tax_amount: 0,
      total_amount: 0,
      tax_rate: '',
      items: [],
      raw_text: '',
    };
  }

  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  const pagesText: string[] = [];

  if (isPdf) {
    try {
      const canvases = await pdfToImages(file);
      for (let i = 0; i < canvases.length; i++) {
        const b64 = canvasToBase64(canvases[i]);
        const text = await callBaiduOcr(b64);
        pagesText.push(text);
        onProgress?.(i + 1, canvases.length);
      }
    } catch (e: any) {
      throw new Error('PDF 解析失败：' + (e.message || '文件可能损坏或加密'));
    }
  } else {
    const b64 = await imageToCompressedBase64(file);
    const text = await callBaiduOcr(b64);
    pagesText.push(text);
    onProgress?.(1, 1);
  }

  const full = pagesText.join('\n');
  const lines = full
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return parseStructured(full, lines);
}
