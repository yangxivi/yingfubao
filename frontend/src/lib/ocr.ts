// 发票 OCR：前端把图片/PDF 发给 Supabase Edge Function（baidu-ocr），
// 由函数调用「百度高精度通用文字识别（accurate_basic）」，返回文字后前端用正则+锚点提取字段。
//
// 与历史版本的区别：
// - 移除 Tesseract.js（浏览器本地 OCR），完全改用百度高精度，识别率更高
// - 保留 PDF 支持（pdfjs 渲染成图片逐页发百度）
// - 字段提取逻辑（parseStructured 等）完全复用，这是核心资产，不动

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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

// ===== 调用 Supabase Edge Function（baidu-ocr）=====
async function callBaiduOcr(base64: string): Promise<string> {
  if (!supabase) {
    throw new Error(
      '未配置 Supabase（百度 OCR 不可用）。请在 frontend/.env 填写 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY',
    );
  }
  const { data, error } = await supabase.functions.invoke('baidu-ocr', {
    body: { image: base64 },
  });
  if (error) throw new Error('调用百度 OCR 失败：' + (error.message || '网络错误'));
  if (data?.error) throw new Error('百度 OCR 返回错误：' + data.error);
  return data?.raw_text || '';
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
      !/^[0-9\s年明月日¥￥]+$/.test(s)
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

  // ---- 6. 税号（基于锚点行索引精确定位区域）----
  // 增值税发票上"销售方"和"购买方"是左右并排的，OCR 行序会交叉。
  // 因此不能用"往前看N行找销售方/购买方关键词"的方式判断区域（旧逻辑的 contextBefore），
  // 必须用锚点行索引 + 税号所在行的位置来判定归属。
  let seller_tax_id = '';
  let buyer_tax_id = '';

  const sellerIdx = findLineIndex(lines, '销售方');
  const buyerIdx = findLineIndex(lines, '购买方');

  // 收集所有税号及其行索引
  const allTaxIds: { id: string; lineIdx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tid = parseTaxId(lines[i]);
    if (tid) allTaxIds.push({ id: tid.toUpperCase(), lineIdx: i });
  }

  if (sellerIdx >= 0 && buyerIdx >= 0 && allTaxIds.length > 0) {
    // 根据两个锚点的先后顺序确定区域边界
    const [firstAnchor, secondAnchor] = sellerIdx < buyerIdx
      ? ['seller' as const, 'buyer' as const]
      : ['buyer' as const, 'seller' as const];
    const firstIdx = Math.min(sellerIdx, buyerIdx);
    const secondIdx = Math.max(sellerIdx, buyerIdx);

    for (const t of allTaxIds) {
      // 在两个锚点之间的税号 → 属于先出现的那个区域（通常是销售方）
      if (t.lineIdx > firstIdx && t.lineIdx < secondIdx) {
        if (firstAnchor === 'seller' && !seller_tax_id) seller_tax_id = t.id;
        else if (firstAnchor === 'buyer' && !buyer_tax_id) buyer_tax_id = t.id;
      }
      // 在第二个锚点之后的税号 → 属于后出现的区域
      else if (t.lineIdx > secondIdx) {
        if (secondAnchor === 'seller' && !seller_tax_id) seller_tax_id = t.id;
        else if (secondAnchor === 'buyer' && !buyer_tax_id) buyer_tax_id = t.id;
      }
    }
  }

  // 兜底：如果上述位置匹配没找到，尝试在各自区域内全文搜索
  if (!seller_tax_id && sellerIdx >= 0) {
    const blockEnd = buyerIdx > sellerIdx ? buyerIdx : lines.length;
    const block = extractBlock(lines, sellerIdx + 1, blockEnd);
    const stid = parseTaxId(block);
    if (stid) seller_tax_id = stid;
  }
  if (!buyer_tax_id && buyerIdx >= 0) {
    const blockStart = sellerIdx >= 0 && sellerIdx < buyerIdx ? buyerIdx : 0;
    const block = extractBlock(lines, blockStart);
    const btid = parseTaxId(block);
    if (btid) buyer_tax_id = btid;
  }

  // 最终兜底：全局所有税号按出现顺序分配（第一个给购买方，第二个给销售方）
  if (!seller_tax_id || !buyer_tax_id) {
    const uniqGlobal = Array.from(new Set(allTaxIds.map((t) => t.id)));
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
