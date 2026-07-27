"""
Invoice OCR Service - 增值税发票自动识别

识别引擎：本地 Tesseract（pytesseract），零密钥、可离线、完全免费。
  对上传图片 / PDF 首页做图像预处理（灰度、对比度 / 锐度增强、中值去噪、多尺度放大），
  显著提升中文发票的识别率；解析失败时不抛异常，返回空结构交由前端人工补录。

支持图片（PNG/JPG/BMP/TIFF）与 PDF（使用 pymupdf 渲染首页）。
"""
import os
import re
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 工具：PDF / 图片预处理
# ---------------------------------------------------------------------------
def _pdf_to_image(path: str) -> Optional[str]:
    """将 PDF 首页渲染为 PNG 临时文件，返回图片路径；失败返回 None。"""
    try:
        import fitz  # pymupdf
        doc = fitz.open(path)
        if doc.page_count == 0:
            return None
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        out = path + ".page0.png"
        pix.save(out)
        return out
    except Exception as e:  # noqa
        logger.warning(f"PDF 渲染失败: {e}")
        return None


def _to_image_path(path: str) -> str:
    """若为 PDF 则转图片，否则原样返回。"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        img = _pdf_to_image(path)
        return img if img else path
    return path


# ---------------------------------------------------------------------------
# 字段解析（基于 OCR 文本，引擎无关）
# ---------------------------------------------------------------------------
def _parse_date(text: str) -> Optional[str]:
    m = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def _parse_amount(text: str) -> Optional[float]:
    clean = text.replace('¥', '').replace('￥', '').replace(',', '').replace('，', '').strip()
    m = re.search(r'(\d+\.?\d{0,2})', clean)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def _parse_tax_id(text: str) -> Optional[str]:
    # 统一社会信用代码：18 位，排除易混淆字符 I O S V Z
    m = re.search(r'([0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10})', text)
    if m:
        return m.group(1)
    return None


def _company_names(texts: List[str]) -> List[str]:
    names = []
    for t in texts:
        s = t.strip()
        if ("公司" in s or "厂" in s or "有限" in s or "中心" in s) and 4 <= len(s) <= 40:
            if not re.fullmatch(r'[\d\s年明月日]+', s):
                names.append(s)
    # 去重保序
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _parse_structured(text: str, texts: List[str]) -> Dict[str, Any]:
    """通用文本解析（适用于 Tesseract 返回的全文）。"""
    full = text

    # 发票号码：20 位或 8-20 位数字，常跟在“发票号码”后
    invoice_no = ""
    m = re.search(r'发票号码[：:\s]*(\d{8,20})', full)
    if m:
        invoice_no = m.group(1)
    else:
        m = re.search(r'\b(\d{20})\b', full)
        if m:
            invoice_no = m.group(1)

    # 开票日期
    invoice_date = ""
    for t in texts:
        d = _parse_date(t)
        if d:
            invoice_date = d
            break

    # 金额：收集所有金额，最大为价税合计，次大为不含税金额
    amounts: List[float] = []
    for t in texts:
        amt = _parse_amount(t)
        if amt and amt > 1:
            amounts.append(amt)
    amounts = sorted(set(round(a, 2) for a in amounts), reverse=True)

    total_amount = 0.0
    amount_excluding_tax = 0.0
    tax_amount = 0.0
    if len(amounts) >= 2:
        total_amount = amounts[0]
        amount_excluding_tax = amounts[1]
        tax_amount = round(total_amount - amount_excluding_tax, 2)
        if tax_amount < 0:
            amount_excluding_tax, total_amount = total_amount, amount_excluding_tax
            tax_amount = round(total_amount - amount_excluding_tax, 2)
    elif len(amounts) == 1:
        total_amount = amounts[0]

    # 税率
    tax_rate = ""
    rm = re.search(r'(\d{1,2}(?:\.\d+)?)\s*%', full)
    if rm:
        tax_rate = f"{rm.group(1)}%"

    # 税号
    tax_ids = []
    for t in texts:
        tid = _parse_tax_id(t)
        if tid:
            tax_ids.append(tid)
    tax_ids = list(dict.fromkeys(tax_ids))

    companies = _company_names(texts)

    # 买卖方：通常第一段为公司名为购方，后段为销方
    buyer_name = companies[0] if companies else ""
    seller_name = companies[1] if len(companies) > 1 else (companies[0] if companies else "")
    buyer_tax_id = tax_ids[0] if tax_ids else ""
    seller_tax_id = tax_ids[1] if len(tax_ids) > 1 else (tax_ids[0] if tax_ids else "")

    # 若销方名含购方关键字则互换
    if seller_name and ("三力" in seller_name or "购方" in seller_name):
        buyer_name, seller_name = seller_name, buyer_name

    return {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date,
        "seller_name": seller_name,
        "seller_tax_id": seller_tax_id,
        "buyer_name": buyer_name,
        "buyer_tax_id": buyer_tax_id,
        "amount_excluding_tax": round(amount_excluding_tax, 2),
        "tax_amount": round(tax_amount, 2),
        "total_amount": round(total_amount, 2),
        "tax_rate": tax_rate,
        "items": [],
        "raw_text": full[:2000],
    }


# ---------------------------------------------------------------------------
# 引擎：本地 Tesseract（含图像预处理与多尺度择优）
# ---------------------------------------------------------------------------
def _ocr_tesseract(path: str) -> Optional[Dict[str, Any]]:
    """本地 Tesseract 识别，含图像预处理与多尺度择优。

    零密钥、可离线。预处理：灰度 -> 对比度/锐度增强 -> 中值去噪 -> 多尺度放大，
    对中文发票的小字与低对比度背景识别率有显著提升。
    """
    try:
        import shutil
        if not shutil.which("tesseract"):
            logger.warning("未检测到 tesseract 命令，跳过 OCR")
            return None
        import pytesseract
        from PIL import Image, ImageEnhance, ImageFilter

        img_path = _to_image_path(path)
        img = Image.open(img_path).convert("RGB")

        candidates = []
        for scale in (2.0, 1.5, 1.0):
            im = img.resize(
                (int(img.width * scale), int(img.height * scale)),
                Image.Resampling.LANCZOS,
            )
            gray = im.convert("L")
            gray = ImageEnhance.Contrast(gray).enhance(2.0)
            gray = ImageEnhance.Sharpness(gray).enhance(2.0)
            gray = gray.filter(ImageFilter.MedianFilter(3))
            raw = pytesseract.image_to_string(gray, lang="chi_sim+eng", config="--psm 6")
            texts = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            candidates.append(_parse_structured(raw, texts))

        # 择优：优先有金额，其次发票号、日期、税号，最后文本丰富度
        best = max(
            candidates,
            key=lambda r: (
                1 if r.get("total_amount") else 0,
                1 if r.get("invoice_no") else 0,
                1 if r.get("invoice_date") else 0,
                1 if r.get("seller_tax_id") else 0,
                len(r.get("raw_text", "")),
            ),
        )
        return best
    except Exception as e:  # noqa
        logger.warning(f"Tesseract OCR 失败: {e}")
        return None


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def ocr_invoice(image_path: str) -> Dict[str, Any]:
    """识别发票，返回结构化字典；Tesseract 不可用时返回空结构（人工补录）。"""
    res = _ocr_tesseract(image_path)
    if res:
        logger.info("使用 Tesseract OCR 识别")
        return res
    logger.info("Tesseract 不可用，返回空结构（人工补录）")
    return {
        "invoice_no": "", "invoice_date": "", "seller_name": "",
        "seller_tax_id": "", "buyer_name": "", "buyer_tax_id": "",
        "amount_excluding_tax": 0.0, "tax_amount": 0.0, "total_amount": 0.0,
        "tax_rate": "", "items": [], "raw_text": "",
    }


def calculate_payment_date(invoice_date_str: str, days: int = 90) -> str:
    if not invoice_date_str:
        return ""
    try:
        dt = datetime.strptime(invoice_date_str, "%Y-%m-%d")
        return (dt + timedelta(days=days)).strftime("%Y-%m-%d")
    except ValueError:
        return ""
