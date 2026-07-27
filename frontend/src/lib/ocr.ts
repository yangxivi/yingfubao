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

function parseStructured(full: string, lines: string[]): OcrResult {
  let invoice_no = '';
  let m = full.match(/发票号码[：:\s]*(\d{8,20})/);
  if (m) invoice_no = m[1];
  else {
    m = full.match(/\b(\d{20})\b/);
    if (m) invoice_no = m[1];
  }

  let invoice_date = '';
  for (const t of lines) {
    const d = parseDate(t);
    if (d) {
      invoice_date = d;
      break;
    }
  }

  const amounts: number[] = [];
  for (const t of lines) {
    const a = parseAmount(t);
    if (a && a > 1) amounts.push(a);
  }
  const uniq = Array.from(new Set(amounts.map((a) => Math.round(a * 100) / 100))).sort((a, b) => b - a);

  let total_amount = 0;
  let amount_excluding_tax = 0;
  let tax_amount = 0;
  if (uniq.length >= 2) {
    total_amount = uniq[0];
    amount_excluding_tax = uniq[1];
    tax_amount = Math.round((total_amount - amount_excluding_tax) * 100) / 100;
    if (tax_amount < 0) {
      amount_excluding_tax = total_amount;
      total_amount = uniq[1];
      tax_amount = 0;
    }
  } else if (uniq.length === 1) {
    total_amount = uniq[0];
  }

  let tax_rate = '';
  const rm = full.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (rm) tax_rate = `${rm[1]}%`;

  const tax_ids: string[] = [];
  for (const t of lines) {
    const tid = parseTaxId(t);
    if (tid) tax_ids.push(tid);
  }
  const uniqTax = Array.from(new Set(tax_ids));

  const companies = companyNames(lines);
  let buyer_name = companies[0] || '';
  let seller_name = companies[1] || (companies[0] || '');
  let buyer_tax_id = uniqTax[0] || '';
  let seller_tax_id = uniqTax[1] || (uniqTax[0] || '');

  if (seller_name && (seller_name.includes('三力') || seller_name.includes('购方'))) {
    [buyer_name, seller_name] = [seller_name, buyer_name];
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
