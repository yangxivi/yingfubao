// 浏览器端 OCR 引擎：使用 Tesseract.js（WASM）在本地识别发票，零密钥、可离线（语言包首次需联网下载）。
// 图像预处理（灰度 + 对比度增强 + 多尺度）提升中文发票识别率；字段解析逻辑移植自后端 ocr_service.py。

import Tesseract from 'tesseract.js';

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
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

// 灰度 + 对比度增强（2.0），返回缩放后的 canvas 供 OCR
function preprocess(img: HTMLImageElement, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
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

function parseDate(text: string): string | null {
  let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  return null;
}

function parseAmount(text: string): number | null {
  const clean = text.replace(/[¥￥,，]/g, '').trim();
  const m = clean.match(/(\d+\.?\d{0,2})/);
  if (m) {
    const v = parseFloat(m[1]);
    return isNaN(v) ? null : v;
  }
  return null;
}

function parseTaxId(text: string): string | null {
  const m = text.match(/([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})/);
  return m ? m[1] : null;
}

function companyNames(lines: string[]): string[] {
  const names: string[] = [];
  for (const s of lines) {
    if (
      (s.includes('公司') || s.includes('厂') || s.includes('有限') || s.includes('中心')) &&
      s.length >= 4 &&
      s.length <= 40
    ) {
      if (!/^[0-9\s年明月日]+$/.test(s)) names.push(s);
    }
  }
  return Array.from(new Set(names));
}

// ===== 结构化字段解析（基于增值税发票版面锚点）=====

/** 从文本中找到 target 锚点之后、下一个同级锚点之前的内容 */
function extractAfterAnchor(lines: string[], anchor: string, nextAnchors?: string[]): string {
  let found = false;
  const results: string[] = [];
  for (const line of lines) {
    if (!found) {
      if (line.includes(anchor)) { found = true; continue; }
    } else {
      if (nextAnchors?.some((a) => line.includes(a))) break;
      results.push(line);
    }
  }
  return results.join(' ');
}

/**
 * 解析增值税发票结构化字段。
 * 核心策略：用发票版面的锚点词（销售方/购买方/价税合计/小写 等）精确定位，
 * 而非盲目遍历所有行取最大值。
 */
function parseStructured(full: string, lines: string[]): OcrResult {
  // ---- 1. 发票号 ----
  let invoice_no = '';
  let m = full.match(/发票号码[：:\s]*(\d{8,20})/);
  if (m) invoice_no = m[1];
  else {
    m = full.match(/\b(\d{20})\b/);
    if (m) invoice_no = m[1];
  }

  // ---- 2. 开票日期 ----
  let invoice_date = '';
  for (const t of lines) {
    const d = parseDate(t);
    if (d) { invoice_date = d; break; }
  }

  // ---- 3. 价税合计（小写）——最高优先级锚点 ----
  // 增值税发票固定格式：「价税合计（大写）... （小写）¥19800.00」
  // 或在同一行：「（小写）¥19800,00」
  let total_amount = 0;
  let amount_excluding_tax = 0;
  let tax_amount = 0;

  // 3a. 精确匹配「（小写）」后的金额
  const smallWriteMatch = full.match(/(?:小写|小写\s*￥|小写\s*¥)\s*[￥¥]?\s*([\d,]+\.?\d*)/);
  if (smallWriteMatch) {
    total_amount = parseFloat(smallWriteMatch[1].replace(/,/g, '')) || 0;
  } else {
    // 3b. 匹配「价税合计」附近的金额
    const totalMatch = full.match(/价税合计[^￥¥]*?[￥¥]\s*([\d,]+\.?\d*)/);
    if (totalMatch) {
      total_amount = parseFloat(totalMatch[1].replace(/,/g, '')) || 0;
    } else {
      // 3c. 兜底：找含「合计」且带 ¥ 的行
      for (const t of lines) {
        if ((t.includes('合计') || t.includes('价税')) && t.includes('¥')) {
          const a = parseAmount(t);
          if (a && a > 1) { total_amount = a; break; }
        }
      }
    }
  }

  // 3d. 从表格行的「金额」列找不含税金额（通常小于价税合计）
  // 增值税发票表格中有「金额」和「税额」两列，金额 < 价税合计
  const tableAmounts: number[] = [];
  for (const t of lines) {
    // 跳过含「合计」「价税」「小写」的行（那些是汇总行）
    if (t.includes('合计') || t.includes('价税') || t.includes('小写')) continue;
    const a = parseAmount(t);
    if (a && a > 1 && a !== total_amount) tableAmounts.push(a);
  }
  const uniqTable = Array.from(new Set(tableAmounts.map((a) => Math.round(a * 100) / 100))).sort((a, b) => b - a);
  if (uniqTable.length >= 1 && uniqTable[0] < total_amount) {
    amount_excluding_tax = uniqTable[0];
    tax_amount = Math.round((total_amount - amount_excluding_tax) * 100) / 100;
  } else if (total_amount > 0) {
    // 无法分离时，反算不含税额（假设税率13%）
    amount_excluding_tax = Math.round(total_amount / 1.13 * 100) / 100;
    tax_amount = Math.round(total_amount - amount_excluding_tax);
  }

  // ---- 4. 税率 ----
  let tax_rate = '';
  const rm = full.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (rm) tax_rate = `${rm[1]}%`;

  // ---- 5. 销售方名称（精确锚点：销售方/销方 + 名称）----
  let seller_name = '';
  let buyer_name = '';

  // 方法A：找「名称:xxx公司」且附近有「销售方」或「销方」标记
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 检查是否在销售方区域内（前面几行有销售方标记）
    const contextBefore = lines.slice(Math.max(0, i - 4), i).join('');
    const isSellerZone = contextBefore.includes('销售方') || contextBefore.includes('销方');
    const isBuyerZone = contextBefore.includes('购买方') || contextBefore.includes('购方');

    // 匹配「名称: xxx公司」模式
    const nameMatch = line.match(/名称[：:\s]*(.+)$/);
    if (nameMatch) {
      const candidate = nameMatch[1].trim();
      if (candidate.length >= 4 && candidate.length <= 40 &&
          (candidate.includes('公司') || candidate.includes('厂') || candidate.includes('有限'))) {
        if (isSellerZone && !seller_name) seller_name = candidate;
        else if (isBuyerZone && !buyer_name) buyer_name = candidate;
      }
    }
  }

  // 方法B：如果方法A没找到，用「销售方」后紧跟的公司名
  if (!seller_name) {
    const sellerBlock = extractAfterAnchor(lines, '销售方', ['购买方', '购方', '项目', '货物']);
    const sm = sellerBlock.match(/名称[：:\s]*([^\n\r]{4,40}?)(?:\s|$)/);
    if (sm) seller_name = sm[1].trim();
  }
  if (!buyer_name) {
    const buyerBlock = extractAfterAnchor(lines, '购买方', ['销售方', '销方', '项目', '货物']);
    const bm = buyerBlock.match(/名称[：:\s]*([^\n\r]{4,40}?)(?:\s|$)/);
    if (bm) buyer_name = bm[1].trim();
  }

  // 方法C：兜底——从全文提取公司名列表，按位置判断
  if (!seller_name || !buyer_name) {
    const allCompanies = companyNames(lines);
    if (allCompanies.length >= 2 && !seller_name) {
      seller_name = allCompanies[1]; // 第二个通常是销售方
      buyer_name = allCompanies[0];
    } else if (allCompanies.length === 1) {
      if (!seller_name) seller_name = allCompanies[0];
      if (!buyer_name) buyer_name = allCompanies[0];
    }
  }

  // 如果 seller_name 包含购方关键字，交换
  if (seller_name && (seller_name.includes('三力') || seller_name.includes('购方'))) {
    [buyer_name, seller_name] = [seller_name, buyer_name];
  }

  // ---- 6. 税号（精确锚点：销售方/购买方区域内的纳税人识别号）----
  let seller_tax_id = '';
  let buyer_tax_id = '';

  // 方法A：在销售方/购买方区域内找税号
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const contextBefore = lines.slice(Math.max(0, i - 5), i).join('');
    const isSellerZone = contextBefore.includes('销售方') || contextBefore.includes('销方');
    const isBuyerZone = contextBefore.includes('购买方') || contextBefore.includes('购方');

    // 匹配纳税人识别号 / 统一社会信用代码
    const tidMatch = line.match(/(?:纳税人识别号|统一社会信用代码|纳税号)[号碼：:\s]*([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})/);
    if (tidMatch) {
      if (isSellerZone && !seller_tax_id) seller_tax_id = tidMatch[1];
      else if (isBuyerZone && !buyer_tax_id) buyer_tax_id = tidMatch[1];
    }
  }

  // 方法B：在销售方/购买方块内搜索任意税号格式
  if (!seller_tax_id) {
    const sellerBlock = extractAfterAnchor(lines, '销售方', ['购买方', '购方', '项目', '货物']);
    const stid = parseTaxId(sellerBlock);
    if (stid) seller_tax_id = stid;
  }
  if (!buyer_tax_id) {
    const buyerBlock = extractAfterAnchor(lines, '购买方', ['销售方', '销方', '项目', '货物']);
    const btid = parseTaxId(buyerBlock);
    if (btid) buyer_tax_id = btid;
  }

  // 方法C：兜底——全局取不重复的两个税号
  if (!seller_tax_id || !buyer_tax_id) {
    const globalTaxIds: string[] = [];
    for (const t of lines) {
      const tid = parseTaxId(t);
      if (tid) globalTaxIds.push(tid);
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
      (r.total_amount ? 1 : 0) +
      (r.invoice_no ? 1 : 0) +
      (r.invoice_date ? 1 : 0) +
      (r.seller_tax_id ? 1 : 0);
    const sb = score(best);
    const sc = score(c);
    if (sc > sb || (sc === sb && c.raw_text.length > best.raw_text.length)) return c;
    return best;
  });
}

export async function recognizeInvoice(
  file: File,
  onProgress?: (p: number) => void,
): Promise<OcrResult> {
  const img = await loadImage(file);
  const scales = [2.0, 1.0];
  const cands: OcrResult[] = [];
  for (const s of scales) {
    const canvas = preprocess(img, s);
    const res = await Tesseract.recognize(canvas, 'chi_sim+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      },
    });
    const lines = res.data.text
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    cands.push(parseStructured(res.data.text, lines));
  }
  return pickBest(cands);
}
