import json, urllib.request

B = "http://127.0.0.1:8000/api"

def req(method, path, token=None, data=None):
    url = B + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))

# register
s, u = req("POST", "/auth/register", data={"username": "demo4", "password": "123456", "company_name": "西安新三力复合材料科技有限公司"})
print("register:", s, u.get("user", {}).get("username"))
tok = u["access_token"]

# create supplier
s, sup = req("POST", "/suppliers", token=tok, data={"name": "西安金晟达汽车零部件有限公司", "tax_id": "91610117MA6WNM5638", "contact_person": "李海侠"})
print("supplier:", s, sup.get("name"), sup.get("id"))
sid = sup["id"]

# create 6 invoices from the summary table
rows = [
    ("26612000000367753336", "2026-02-28", "2026-05-29", 155535.46, 137642.0, 17893.46, "13%", "2026年1月"),
    ("26612000000419963506", "2026-03-06", "2026-06-04", 195586.70, 189890.0, 5696.70, "3%", "2026年1月"),
    ("26612000000356751931", "2026-02-26", "2026-05-27", 19800.00, 17522.12, 2277.88, "13%", "2026年1月"),
    ("26422000000142959896", "2026-04-21", "2026-07-20", 6906.04, 6111.54, 794.50, "13%", "2026年2月"),
    ("26612000000538531321", "2026-03-23", "2026-06-21", 160652.10, 142170.0, 18482.10, "13%", "2026年2月"),
    ("26612000000842084791", "2026-05-06", "2026-08-04", 237178.10, 230270.0, 6908.10, "3%", "2026年2月"),
]
for no, idate, pdate, total, ex, tax, rate, month in rows:
    s, inv = req("POST", "/invoices", token=tok, data={
        "supplier_id": sid, "invoice_no": no, "invoice_date": idate, "payment_date": pdate,
        "total_amount": total, "amount_excluding_tax": ex, "tax_amount": tax,
        "tax_rate": rate, "business_month": month, "status": "pending"})
    print("invoice", no, "->", s, "total", inv.get("total_amount"))

# reminders
s, rem = req("GET", "/reminders", token=tok)
print("reminders:", {k: v for k, v in rem.items() if k != "invoices"})

# dashboard
s, dash = req("GET", "/dashboard", token=tok)
print("dashboard:", {k: v for k, v in dash.items() if k != "overdue_invoices"})

# invoice list count
s, lst = req("GET", "/invoices", token=tok)
print("invoice list count:", len(lst))
