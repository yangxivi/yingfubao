"""
应付宝 - 应付账款管理系统  API
"""
import os
import uuid
import shutil
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db, init_db
from models import User, Supplier, Invoice, InvoiceItem, InvoiceStatus
from auth import hash_password, verify_password, create_access_token, get_current_user
from ocr_service import ocr_invoice, calculate_payment_date

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="应付宝",
    description="应付账款管理系统 - 发票OCR识别、到期提醒、供应商管理",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4, max_length=100)
    company_name: str = ""
    email: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class SupplierCreate(BaseModel):
    name: str
    tax_id: str = ""
    contact_person: str = ""
    phone: str = ""
    address: str = ""
    bank_name: str = ""
    bank_account: str = ""
    notes: str = ""


class SupplierResponse(BaseModel):
    id: int
    name: str
    tax_id: str
    contact_person: str
    phone: str
    address: str
    bank_name: str
    bank_account: str
    notes: str
    invoice_count: int = 0
    total_amount: float = 0.0
    created_at: datetime

    class Config:
        from_attributes = True


class InvoiceItemSchema(BaseModel):
    id: Optional[int] = None
    item_name: str = ""
    spec: str = ""
    quantity: float = 0.0
    unit_price: float = 0.0
    amount: float = 0.0

    class Config:
        from_attributes = True


class InvoiceResponse(BaseModel):
    id: int
    invoice_no: str
    invoice_date: Optional[str] = None
    payment_date: Optional[str] = None
    amount_excluding_tax: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    tax_rate: str = ""
    business_month: str = ""
    remark: str = ""
    status: str
    created_at: datetime
    supplier_name: str = ""
    supplier_tax_id: str = ""
    supplier_id: Optional[int] = None
    items: List[InvoiceItemSchema] = []

    class Config:
        from_attributes = True


class InvoiceUpdate(BaseModel):
    invoice_no: Optional[str] = None
    invoice_date: Optional[str] = None
    payment_date: Optional[str] = None
    amount_excluding_tax: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    tax_rate: Optional[str] = None
    business_month: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[str] = None
    supplier_id: Optional[int] = None


class InvoiceCreate(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    supplier_tax_id: str = ""
    invoice_no: str = ""
    invoice_date: Optional[str] = None
    payment_date: Optional[str] = None
    amount_excluding_tax: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    tax_rate: str = ""
    business_month: str = ""
    remark: str = ""
    status: str = "pending"


class ReminderResponse(BaseModel):
    due_within_15: int = 0
    due_within_30: int = 0
    due_within_60: int = 0
    due_within_90: int = 0
    overdue: int = 0
    invoices: List[InvoiceResponse] = []


# ---------------------------------------------------------------------------
# Auth Routes
# ---------------------------------------------------------------------------
@app.post("/api/auth/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        company_name=req.company_name,
        email=req.email,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "company_name": user.company_name},
    )


@app.post("/api/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "company_name": user.company_name},
    )


@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "company_name": current_user.company_name,
        "email": current_user.email,
    }


# ---------------------------------------------------------------------------
# Supplier Routes
# ---------------------------------------------------------------------------
@app.get("/api/suppliers", response_model=List[SupplierResponse])
def list_suppliers(
    search: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Supplier).filter(Supplier.user_id == current_user.id)
    if search:
        q = q.filter(
            Supplier.name.contains(search) | Supplier.tax_id.contains(search)
        )
    suppliers = q.order_by(Supplier.name).all()

    result = []
    for s in suppliers:
        invoice_count = db.query(Invoice).filter(Invoice.supplier_id == s.id).count()
        total_amount = (
            db.query(Invoice)
            .filter(Invoice.supplier_id == s.id)
            .with_entities(Invoice.total_amount)
            .all()
        )
        total = sum(t[0] or 0 for t in total_amount)
        result.append(SupplierResponse(
            id=s.id, name=s.name, tax_id=s.tax_id,
            contact_person=s.contact_person, phone=s.phone,
            address=s.address, bank_name=s.bank_name, bank_account=s.bank_account,
            notes=s.notes, invoice_count=invoice_count, total_amount=round(total, 2),
            created_at=s.created_at,
        ))
    return result


@app.post("/api/suppliers", response_model=SupplierResponse)
def create_supplier(
    body: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = Supplier(user_id=current_user.id, **body.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return SupplierResponse(
        id=s.id, name=s.name, tax_id=s.tax_id,
        contact_person=s.contact_person, phone=s.phone,
        address=s.address, bank_name=s.bank_name, bank_account=s.bank_account,
        notes=s.notes, invoice_count=0, total_amount=0.0, created_at=s.created_at,
    )


@app.put("/api/suppliers/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: int,
    body: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Supplier).filter(
        Supplier.id == supplier_id, Supplier.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="供应商不存在")
    for key, val in body.model_dump().items():
        setattr(s, key, val)
    db.commit()
    db.refresh(s)
    invoice_count = db.query(Invoice).filter(Invoice.supplier_id == s.id).count()
    return SupplierResponse(
        id=s.id, name=s.name, tax_id=s.tax_id,
        contact_person=s.contact_person, phone=s.phone,
        address=s.address, bank_name=s.bank_name, bank_account=s.bank_account,
        notes=s.notes, invoice_count=invoice_count, total_amount=0.0, created_at=s.created_at,
    )


@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Supplier).filter(
        Supplier.id == supplier_id, Supplier.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="供应商不存在")
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Invoice Routes
# ---------------------------------------------------------------------------
@app.post("/api/invoices/upload", response_model=InvoiceResponse)
async def upload_invoice(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload and OCR a single invoice image/PDF."""
    ext = os.path.splitext(file.filename or "invoice.png")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".pdf", ".bmp", ".tiff"):
        raise HTTPException(status_code=400, detail="支持格式: PNG/JPG/PDF/BMP/TIFF")

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Run OCR
    try:
        ocr_result = ocr_invoice(filepath)
    except Exception as e:
        # OCR failed: still create invoice record but with basic info
        ocr_result = {"total_amount": 0, "invoice_date": "", "invoice_no": "",
                       "seller_name": "", "seller_tax_id": "", "items": [],
                       "tax_amount": 0, "amount_excluding_tax": 0, "tax_rate": ""}

    # Find or create supplier
    supplier = None
    if ocr_result.get("seller_name"):
        supplier = db.query(Supplier).filter(
            Supplier.user_id == current_user.id,
            Supplier.name == ocr_result["seller_name"]
        ).first()
        if not supplier:
            supplier = Supplier(
                user_id=current_user.id,
                name=ocr_result["seller_name"],
                tax_id=ocr_result.get("seller_tax_id", ""),
            )
            db.add(supplier)
            db.flush()

    payment_date = calculate_payment_date(ocr_result.get("invoice_date", ""))

    invoice = Invoice(
        user_id=current_user.id,
        supplier_id=supplier.id if supplier else None,
        invoice_no=ocr_result.get("invoice_no", ""),
        invoice_date=datetime.strptime(ocr_result["invoice_date"], "%Y-%m-%d").date()
        if ocr_result.get("invoice_date") else None,
        payment_date=datetime.strptime(payment_date, "%Y-%m-%d").date()
        if payment_date else None,
        amount_excluding_tax=ocr_result.get("amount_excluding_tax", 0),
        tax_amount=ocr_result.get("tax_amount", 0),
        total_amount=ocr_result.get("total_amount", 0),
        tax_rate=ocr_result.get("tax_rate", ""),
        file_path=filename,
        status="pending",
    )
    db.add(invoice)
    db.flush()

    # Add items
    for item in ocr_result.get("items", [])[:30]:
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            item_name=item.get("item_name", ""),
            spec=item.get("spec", ""),
            quantity=item.get("quantity", 0),
            unit_price=item.get("unit_price", 0),
            amount=item.get("amount", 0),
        ))

    db.commit()
    db.refresh(invoice)

    return _invoice_to_response(invoice, db)


@app.post("/api/invoices", response_model=InvoiceResponse)
def create_invoice(
    body: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """手动新增发票（无需上传文件，OCR 未配置时也可录入）。"""
    supplier = None
    if body.supplier_id:
        supplier = db.query(Supplier).filter(
            Supplier.id == body.supplier_id, Supplier.user_id == current_user.id
        ).first()
    # 若未指定供应商但提供了供应商名称，则自动创建/复用
    if not supplier and body.supplier_name:
        supplier = db.query(Supplier).filter(
            Supplier.user_id == current_user.id, Supplier.name == body.supplier_name
        ).first()
        if not supplier:
            supplier = Supplier(
                user_id=current_user.id,
                name=body.supplier_name,
                tax_id=body.supplier_tax_id,
            )
            db.add(supplier)
            db.flush()

    payment_date = body.payment_date
    if not payment_date and body.invoice_date:
        payment_date = calculate_payment_date(body.invoice_date)

    invoice = Invoice(
        user_id=current_user.id,
        supplier_id=supplier.id if supplier else None,
        invoice_no=body.invoice_no,
        invoice_date=datetime.strptime(body.invoice_date, "%Y-%m-%d").date()
        if body.invoice_date else None,
        payment_date=datetime.strptime(payment_date, "%Y-%m-%d").date()
        if payment_date else None,
        amount_excluding_tax=body.amount_excluding_tax,
        tax_amount=body.tax_amount,
        total_amount=body.total_amount,
        tax_rate=body.tax_rate,
        business_month=body.business_month,
        remark=body.remark,
        status=body.status or "pending",
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return _invoice_to_response(invoice, db)


@app.get("/api/invoices", response_model=List[InvoiceResponse])
def list_invoices(
    status: str = "",
    supplier_id: int = 0,
    search: str = "",
    date_from: str = "",
    date_to: str = "",
    pay_date_from: str = "",
    pay_date_to: str = "",
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Invoice).filter(Invoice.user_id == current_user.id)

    if status:
        q = q.filter(Invoice.status == status)
    if supplier_id:
        q = q.filter(Invoice.supplier_id == supplier_id)
    if search:
        q = q.filter(
            Invoice.invoice_no.contains(search)
            | Invoice.remark.contains(search)
        )

    # 开票日期范围
    if date_from:
        q = q.filter(Invoice.invoice_date >= datetime.strptime(date_from, "%Y-%m-%d").date())
    if date_to:
        q = q.filter(Invoice.invoice_date <= datetime.strptime(date_to, "%Y-%m-%d").date())

    # 付款日期范围
    if pay_date_from:
        q = q.filter(Invoice.payment_date >= datetime.strptime(pay_date_from, "%Y-%m-%d").date())
    if pay_date_to:
        q = q.filter(Invoice.payment_date <= datetime.strptime(pay_date_to, "%Y-%m-%d").date())

    # 金额范围
    if amount_min is not None:
        q = q.filter(Invoice.total_amount >= amount_min)
    if amount_max is not None:
        q = q.filter(Invoice.total_amount <= amount_max)

    # Sort
    sort_col = getattr(Invoice, sort_by, Invoice.created_at)
    if sort_dir == "asc":
        q = q.order_by(sort_col.asc())
    else:
        q = q.order_by(sort_col.desc())

    total = q.count()
    invoices = q.offset((page - 1) * page_size).limit(page_size).all()

    return [_invoice_to_response(inv, db) for inv in invoices]


@app.get("/api/invoices/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(Invoice).filter(
        Invoice.id == invoice_id, Invoice.user_id == current_user.id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="发票不存在")
    return _invoice_to_response(inv, db)


@app.put("/api/invoices/{invoice_id}", response_model=InvoiceResponse)
def update_invoice(
    invoice_id: int,
    body: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(Invoice).filter(
        Invoice.id == invoice_id, Invoice.user_id == current_user.id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="发票不存在")

    upd = body.model_dump(exclude_unset=True)
    if "invoice_date" in upd and upd["invoice_date"]:
        upd["invoice_date"] = datetime.strptime(upd["invoice_date"], "%Y-%m-%d").date()
    if "payment_date" in upd and upd["payment_date"]:
        upd["payment_date"] = datetime.strptime(upd["payment_date"], "%Y-%m-%d").date()

    for key, val in upd.items():
        setattr(inv, key, val)
    db.commit()
    db.refresh(inv)
    return _invoice_to_response(inv, db)


@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = db.query(Invoice).filter(
        Invoice.id == invoice_id, Invoice.user_id == current_user.id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="发票不存在")
    db.delete(inv)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Reminder / Dashboard Routes
# ---------------------------------------------------------------------------
@app.get("/api/reminders", response_model=ReminderResponse)
def get_reminders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get invoices grouped by payment due period."""
    today = date.today()

    all_invoices = (
        db.query(Invoice)
        .filter(Invoice.user_id == current_user.id, Invoice.status != "paid")
        .all()
    )

    due_15 = []
    due_30 = []
    due_60 = []
    due_90 = []
    overdue = []

    for inv in all_invoices:
        if not inv.payment_date:
            continue
        days_left = (inv.payment_date - today).days
        if days_left < 0:
            overdue.append(inv)
        elif days_left <= 15:
            due_15.append(inv)
        elif days_left <= 30:
            due_30.append(inv)
        elif days_left <= 60:
            due_60.append(inv)
        elif days_left <= 90:
            due_90.append(inv)

    # Combine all due (including overdue) for response
    all_due = overdue + due_15 + due_30 + due_60 + due_90

    return ReminderResponse(
        due_within_15=len(due_15),
        due_within_30=len(due_30),
        due_within_60=len(due_60),
        due_within_90=len(due_90),
        overdue=len(overdue),
        invoices=[_invoice_to_response(inv, db) for inv in all_due],
    )


@app.get("/api/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dashboard summary."""
    today = date.today()

    total_invoices = db.query(Invoice).filter(Invoice.user_id == current_user.id).count()
    pending = db.query(Invoice).filter(
        Invoice.user_id == current_user.id, Invoice.status == "pending"
    ).count()
    paid = db.query(Invoice).filter(
        Invoice.user_id == current_user.id, Invoice.status == "paid"
    ).count()

    total_amount = (
        db.query(Invoice)
        .filter(Invoice.user_id == current_user.id)
        .with_entities(Invoice.total_amount)
        .all()
    )
    total_payable = sum(t[0] or 0 for t in total_amount)

    # Upcoming (within 90 days)
    upcoming = (
        db.query(Invoice)
        .filter(
            Invoice.user_id == current_user.id,
            Invoice.status == "pending",
            Invoice.payment_date.isnot(None),
            Invoice.payment_date >= today,
        )
        .with_entities(Invoice.total_amount)
        .all()
    )
    upcoming_amount = sum(t[0] or 0 for t in upcoming)

    # Overdue
    overdue_invs = (
        db.query(Invoice)
        .filter(
            Invoice.user_id == current_user.id,
            Invoice.status != "paid",
            Invoice.payment_date.isnot(None),
            Invoice.payment_date < today,
        )
        .all()
    )
    overdue_count = len(overdue_invs)
    overdue_amount = sum(inv.total_amount or 0 for inv in overdue_invs)

    supplier_count = db.query(Supplier).filter(Supplier.user_id == current_user.id).count()

    return {
        "total_invoices": total_invoices,
        "pending_count": pending,
        "paid_count": paid,
        "total_payable": round(total_payable, 2),
        "upcoming_amount": round(upcoming_amount, 2),
        "overdue_count": overdue_count,
        "overdue_amount": round(overdue_amount, 2),
        "supplier_count": supplier_count,
        "overdue_invoices": [
            {
                "id": inv.id,
                "supplier_name": inv.supplier.name if inv.supplier else "",
                "total_amount": inv.total_amount,
                "payment_date": inv.payment_date.isoformat() if inv.payment_date else "",
                "days_overdue": (today - inv.payment_date).days if inv.payment_date else 0,
            }
            for inv in overdue_invs[:10]
        ],
    }


# ---------------------------------------------------------------------------
# Serve uploaded files
# ---------------------------------------------------------------------------
@app.get("/api/files/{filename}")
def serve_file(filename: str):
    filepath = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath)
    raise HTTPException(status_code=404)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "name": "应付宝"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _invoice_to_response(inv: Invoice, db: Session) -> InvoiceResponse:
    supplier_name = inv.supplier.name if inv.supplier else ""
    supplier_tax_id = inv.supplier.tax_id if inv.supplier else ""
    return InvoiceResponse(
        id=inv.id,
        invoice_no=inv.invoice_no,
        invoice_date=inv.invoice_date.isoformat() if inv.invoice_date else None,
        payment_date=inv.payment_date.isoformat() if inv.payment_date else None,
        amount_excluding_tax=inv.amount_excluding_tax or 0,
        tax_amount=inv.tax_amount or 0,
        total_amount=inv.total_amount or 0,
        tax_rate=inv.tax_rate or "",
        business_month=inv.business_month or "",
        remark=inv.remark or "",
        status=inv.status,
        created_at=inv.created_at,
        supplier_name=supplier_name,
        supplier_tax_id=supplier_tax_id,
        supplier_id=inv.supplier_id,
        items=[
            InvoiceItemSchema(
                id=it.id,
                item_name=it.item_name,
                spec=it.spec,
                quantity=it.quantity or 0,
                unit_price=it.unit_price or 0,
                amount=it.amount or 0,
            )
            for it in (inv.items or [])
        ],
    )


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def startup():
    init_db()


# ---------------------------------------------------------------------------
# Production static file serving (frontend build output) —— SPA 友好
# ---------------------------------------------------------------------------
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend", "dist")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """非 /api 的 GET 请求统一返回 index.html，支持前端路由刷新。"""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        index_file = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="前端未构建，请先执行 npm run build")
