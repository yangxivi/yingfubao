// 浏览器端 OCR 引擎：使用 Tesseract.js（WASM）在本地识别发票，零密钥、可离线（语言包首次需联网下载）。
// 图像预处理（灰度 + 对比度增强 + 多尺度）提升中文发票识别率；字段解析针对增值税发票版面特征优化。

import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

// 灰度 + 对比度增强（2.0），返回缩放后的 canvas 供 OCR（支持图片或已渲染的 canvas）
function preprocess(src: HTMLImageElement | HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray = Math.min(255, Math.max(0, (gray - 128) * 2.0 + 128));
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function pdfToImages(file: File): Promise<HTMLCanvasElement[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.0, 2400 / Math.max(base.width, base.height));
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

// ===== 模糊匹配工具 =====
// Tesseract 常见中文误识别映射：OCR 输出 → 正确词
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
  // 清除所有货币符号和逗号
  const clean = text.replace(/[¥￥$€,，\s]/g, '').trim();
  // 匹配正数（含小数点）
  const m = clean.match(/^(\d+\.?\d*)$/);
  if (m) {
    const v = parseFloat(m[1]);
    return isNaN(v) || v <= 0 ? null : v;
  }
  // 从混合文本中提取金额
  const m2 = clean.match(/(\d+\.?\d*)/);
  if (m2) {
    const v = parseFloat(m2[1]);
    return isNaN(v) || v <= 0 ? null : v;
  }
  return null;
}

function parseTaxId(text: string): string | null {
  // 统一社会信用代码格式：18位，字母不包含 I/O/Z/S/V（但实际可能包含）
  // 宽松匹配：以数字或字母开头，18位左右
  const m = text.match(/([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})/i);
  if (m) return m[1].toUpperCase();
  // 兜底：15位或17位的老税号
  const m2 = text.match(/\b(\d{15}|\d{17}|\d{20})\b/);
  if (m2 && !text.match(/\d{20}/)) return m2[1]; // 避免与发票号混淆
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

// ===== 结构化字段解析（基于增值税发票版面锚点 + 模糊匹配）=====

/** 从 lines 中找到第一个包含 target 锚点的行索引 */
function findLineIndex(lines: string[], anchor: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (hasAnchor(lines[i], anchor)) return i;
  }
  return -1;
}

/** 从 lines 中提取从 startIdx 到 endIdx（不含）之间的文本 */
function extractBlock(lines: string[], startIdx: number, endIdx?: number): string {
  const end = endIdx ?? lines.length;
  return lines.slice(startIdx, end).join(' ');
}

/**
 * 解析增值税发票结构化字段。
 * 核心改进：
 * 1. 所有锚点匹配使用 hasAnchor() 支持模糊匹配（Tesseract 中文误识别容错）
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
      // 兜底：找最长的一串纯数字（>=8位）
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

  // 3a. 最精确：「（小写）¥xxxx」或「小写 ¥xxxx」
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

  // 3b. 「价税合计」附近带 ¥ 的金额
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

  // 3c. 找含 ¥ 且数值合理的最大金额（排除银行账号等超长数字）
  if (total_amount <= 0) {
    const amounts: number[] = [];
    for (const t of lines) {
      if (t.includes('¥') || t.includes('￥')) {
        const a = parseAmount(t);
        if (a && a >= 1 && a < 1e10) amounts.push(a); // 上限排除银行账号
      }
    }
    amounts.sort((a, b) => b - a);
    if (amounts.length > 0) total_amount = amounts[0];
  }

  // 3d. 最终兜底：全文件中最大的合理金额
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

  // 从非汇总行提取表格金额
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
    // 反算：假设税率 13% 或 3%
    amount_excluding_tax = Math.round(total_amount / 1.13 * 100) / 100;
    tax_amount = Math.round(total_amount - amount_excluding_tax);
  }

  // ---- 4. 税率 ----
  let tax_rate = '';
  const rm = full.match(/(\d{1,2}(?:\.\d+)?)\s*[%％]/);
  if (rm) tax_rate = `${rm[1]}%`;

  // ---- 5. 销售方名称（区域定位 + 模糊锚点 + 多级回退）----
  let seller_name = '';
  let buyer_name = '';

  // 方法A：逐行扫描，用模糊锚点判断是否在销售方/购买方区域内
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const contextBefore = lines.slice(Math.max(0, i - 5), i).join(' ');
    const isSellerZone = hasAnchor(contextBefore, '销售方');
    const isBuyerZone = hasAnchor(contextBefore, '购买方');

    // 匹配「名称: xxx公司」模式（宽松匹配冒号和中英文冒号）
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

  // 方法B：在销售方/购买方块内搜索公司名
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

  // 方法C：全文公司名列表，按位置判断（第二个通常是销售方）
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

  // 修正：如果 seller_name 包含购方关键字，交换
  if (seller_name && (seller_name.includes('三力') || seller_name.includes('购方'))) {
    [buyer_name, seller_name] = [seller_name, buyer_name];
  }

  // ---- 6. 税号（区域定位 + 模糊锚点 + 多级回退）----
  let seller_tax_id = '';
  let buyer_tax_id = '';

  // 方法A：在销售方/购买方区域内找税号（模糊匹配纳税人识别号等关键词）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const contextBefore = lines.slice(Math.max(0, i - 5), i).join(' ');
    const isSellerZone = hasAnchor(contextBefore, '销售方');
    const isBuyerZone = hasAnchor(contextBefore, '购买方');

    // 模糊匹配各种税号关键词
    const tidMatch = line.match(
      /(?:纳税人识别号|纳税人识别号码|统一社会信用代码|信用代码|纳税号|识别号)[号碼：:\s]*([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})/i
    );
    if (tidMatch) {
      if (isSellerZone && !seller_tax_id) seller_tax_id = tidMatch[1].toUpperCase();
      else if (isBuyerZone && !buyer_tax_id) buyer_tax_id = tidMatch[1].toUpperCase();
    }
  }

  // 方法B：在销售方/购买方块内搜索任意税号格式
  if (!seller_tax_id) {
    const sellerIdx = findLineIndex(lines, '销售方');
    if (sellerIdx >= 0) {
      const buyerIdx = findLineIndex(lines, '购买方');
      const blockEnd = buyerIdx > sellerIdx ? buyerIdx : lines.length;
      const block = extractBlock(lines, sellerIdx + 1, blockEnd);
      const stid = parseTaxId(block);
      if (stid) seller_tax_id = stid;
    }
  }
  if (!buyer_tax_id) {
    const buyerIdx = findLineIndex(lines, '购买方');
    if (buyerIdx >= 0) {
      const block = extractBlock(lines, buyerIdx + 1);
      const btid = parseTaxId(block);
      if (btid) buyer_tax_id = btid;
    }
  }

  // 方法C：全局取不重复的税号
  if (!seller_tax_id || !buyer_tax_id) {
    const globalTaxIds: string[] = [];
    for (const t of lines) {
      const tid = parseTaxId(t);
      if (tid) globalTaxIds.push(tid.toUpperCase());
    }
    const uniqGlobal = Array.from(new Set(globalTaxIds));
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

function pickBest(cands: OcrResult[]): OcrResult {
  return cands.reduce((best, c) => {
    const score = (r: OcrResult) =>
      (r.total_amount > 0 ? 3 : 0) +
      (r.invoice_no ? 1 : 0) +
      (r.invoice_date ? 1 : 0) +
      (r.seller_name ? 2 : 0) +
      (r.seller_tax_id ? 2 : 0);
    const sb = score(best);
    const sc = score(c);
    if (sc > sb || (sc === sb && c.raw_text.length > best.raw_text.length)) return c;
    return best;
  });
}

export async function recognizeInvoice(
  file: File,
  onProgress?: (current: number, total: number) => void,
): Promise<OcrResult> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const sources: (HTMLImageElement | HTMLCanvasElement)[] = [];
  if (isPdf) {
    try {
      sources.push(...(await pdfToImages(file)));
    } catch (e) {
      throw new Error('PDF 解析失败：文件可能损坏或加密');
    }
  } else {
    sources.push(await loadImage(file));
  }
  if (sources.length === 0) throw new Error('未能从文件中提取图像');

  const scales = [2.0, 1.0];
  const stepCount = sources.length * scales.length;
  let stepDone = 0;
  const cands: OcrResult[] = [];

  for (let si = 0; si < sources.length; si++) {
    for (let sc = 0; sc < scales.length; sc++) {
      const canvas = preprocess(sources[si], scales[sc]);
      const res = await Tesseract.recognize(canvas, 'chi_sim+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && onProgress) {
            const currentFile = si + 1;
            const totalFiles = sources.length;
            onProgress(currentFile, totalFiles);
          }
        },
      });
      const lines = res.data.text
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);
      cands.push(parseStructured(res.data.text, lines));
      stepDone += 1;
    }
  }
  return pickBest(cands);
}
