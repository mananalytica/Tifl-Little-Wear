"""
Tifl Little Wear — booking API (Vercel + MotherDuck)
=====================================================
Same job as the old server.py, but built to run as a Vercel
serverless function and store bookings in MotherDuck (DuckDB
in the cloud) instead of a local file — so it works for every
visitor on the live site, not just your Mac.

SETUP
-----
1. Sign up free at https://motherduck.com (no card needed)
2. Create a database called "tifl_bookings" (or let this script
   create it on first run)
3. Get your MotherDuck access token: motherduck.com -> Settings -> Tokens
4. In Vercel: Project -> Settings -> Environment Variables
     MOTHERDUCK_TOKEN = <paste your token>
5. Put this file at:  api/index.py
   and put requirements.txt + vercel.json (see below) in the
   project root, then push to GitHub -> Vercel auto-deploys.
6. Your endpoint becomes:  https://<your-domain>/api/bookings
"""

import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta

# Vercel's serverless filesystem is read-only except /tmp. DuckDB looks up
# the OS-level HOME environment variable to decide where to install the
# MotherDuck extension on first connect, so it must be set before any
# duckdb.connect() call — the "home_directory" connect option alone isn't
# enough in this environment.
os.environ["HOME"] = "/tmp"

import duckdb
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

MOTHERDUCK_TOKEN = os.environ.get("MOTHERDUCK_TOKEN", "")
DB_NAME = "tifl_bookings"

app = FastAPI(title="Tifl Little Wear — Booking API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_schema_ready = False

def get_conn():
    global _schema_ready
    # Connect at the account level first (no database name) so we can
    # create tifl_bookings if it doesn't exist yet, then attach to it.
    root = duckdb.connect(
        f"md:?motherduck_token={MOTHERDUCK_TOKEN}",
        config={"home_directory": "/tmp"},
    )
    root.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
    root.close()

    conn = duckdb.connect(
        f"md:{DB_NAME}?motherduck_token={MOTHERDUCK_TOKEN}",
        config={"home_directory": "/tmp"},
    )

    # Only set up tables once per warm instance instead of on every single
    # request — running 4 CREATE TABLE statements plus a seed check on every
    # call was slow enough to risk timing out, which is what caused products
    # to intermittently disappear.
    if not _schema_ready:
        ensure_schema(conn)
        _schema_ready = True

    return conn


def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bookings (
            booking_id      VARCHAR PRIMARY KEY,
            created_at      TIMESTAMP,
            parent_name     VARCHAR,
            child_name      VARCHAR,
            phone           VARCHAR,
            garment_type    VARCHAR,
            mode            VARCHAR,
            date            VARCHAR,
            time_slot       VARCHAR,
            notes           VARCHAR,
            measurements    JSON
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_messages (
            message_id      VARCHAR PRIMARY KEY,
            created_at      TIMESTAMP,
            name            VARCHAR,
            phone           VARCHAR,
            email           VARCHAR,
            message         VARCHAR
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            product_id      VARCHAR PRIMARY KEY,
            created_at      TIMESTAMP,
            name            VARCHAR,
            brand           VARCHAR,
            category        VARCHAR,
            price           DOUBLE,
            currency        VARCHAR,
            image_url       VARCHAR,
            description     VARCHAR,
            sku             VARCHAR,
            stock_status    VARCHAR,
            active          BOOLEAN
        )
        """
    )
    # ================= SHOPPING FEED ATTRIBUTES =================
    # Added on top of the original table with ALTER TABLE ... ADD COLUMN
    # IF NOT EXISTS, so existing products already saved in MotherDuck are
    # kept — they'll just show blank/default values for these new fields
    # until you fill them in (via admin.html or a bulk CSV/XML upload).
    # Column names follow Google Merchant Center / Meta Catalog feed specs
    # directly, so they map straight onto the feed with no translation.
    shopping_columns = [
        ("link", "VARCHAR"),                    # product page URL
        ("additional_image_link", "VARCHAR"),
        ("availability", "VARCHAR"),             # in stock | out of stock | preorder | backorder
        ("sale_price", "DOUBLE"),
        ("gtin", "VARCHAR"),                     # barcode (UPC/EAN/ISBN)
        ("mpn", "VARCHAR"),                      # manufacturer part number
        ("condition", "VARCHAR"),                # new | refurbished | used
        ("google_product_category", "VARCHAR"),
        ("product_type", "VARCHAR"),             # your own category path, e.g. "Kids > Boys > Kurta"
        ("color", "VARCHAR"),
        ("size", "VARCHAR"),
        ("gender", "VARCHAR"),                   # male | female | unisex
        ("age_group", "VARCHAR"),                # newborn | infant | toddler | kids | adult
        ("item_group_id", "VARCHAR"),            # groups size/colour variants of the same product
    ]
    for col_name, col_type in shopping_columns:
        try:
            conn.execute(f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col_name} {col_type}")
        except Exception:
            # Older DuckDB/MotherDuck versions without "IF NOT EXISTS" on
            # ALTER — safe to ignore if the column already exists.
            pass

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            order_id         VARCHAR PRIMARY KEY,
            created_at        TIMESTAMP,
            customer_name     VARCHAR,
            phone             VARCHAR,
            email             VARCHAR,
            address           VARCHAR,
            city              VARCHAR,
            payment_method    VARCHAR,
            notes             VARCHAR,
            items             JSON,
            subtotal          DOUBLE,
            shipping_fee      DOUBLE,
            total             DOUBLE,
            currency          VARCHAR,
            status            VARCHAR
        )
        """
    )
    try:
        conn.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id VARCHAR")
    except Exception:
        pass

    # ================= CUSTOMER ACCOUNTS =================
    # Lightweight accounts so a shopper can save an address for true
    # one-click buying on the live sale, comment while logged in, and see
    # their own order history. This is simple email+password auth with
    # opaque session tokens — appropriate for a small studio, not a
    # replacement for a full identity provider (no email verification or
    # password-reset flow yet).
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
            customer_id      VARCHAR PRIMARY KEY,
            created_at       TIMESTAMP,
            name             VARCHAR,
            email            VARCHAR,
            phone            VARCHAR,
            password_hash    VARCHAR,
            address          VARCHAR,
            city             VARCHAR
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token            VARCHAR PRIMARY KEY,
            customer_id      VARCHAR,
            created_at       TIMESTAMP,
            expires_at       TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS live_comments (
            comment_id       VARCHAR PRIMARY KEY,
            created_at       TIMESTAMP,
            customer_id      VARCHAR,
            name             VARCHAR,
            message          VARCHAR
        )
        """
    )
    seed_products_if_empty(conn)


def seed_products_if_empty(conn):
    count = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    if count > 0:
        return
    seed = [
        ("p1","Block-print Kurta Set","Chinar Kids","Boys",3200,"#108A00","Hand block-printed cotton kurta and pajama set, breathable for everyday wear."),
        ("p2","Layered Cotton Frock","Bunain","Girls",3800,"#0C6B00","A layered cotton frock with soft gathers, easy to move in."),
        ("p3","Newborn Gown, 0-3m","Rui & Co","Newborn",2100,"#5C6B61","Soft muslin gown for newborns, envelope neckline for easy changing."),
        ("p4","Silk Waistcoat Set","Chinar Kids","Occasion",6200,"#0F2B1B","Silk waistcoat and trouser set for weddings and formal occasions."),
        ("p5","Everyday Dungaree","Bunain","Boys",2600,"#108A00","Sturdy cotton dungaree built for play, adjustable straps."),
        ("p6","Embroidered Lehnga, Mini","Zainab Kids","Occasion",8400,"#0C6B00","Hand-embroidered mini lehnga with dupatta, for festive occasions."),
        ("p7","Soft Muslin Romper","Rui & Co","Newborn",1900,"#5C6B61","Breathable muslin romper, popper closures for quick changes."),
        ("p8","Cotton Gharara Set","Zainab Kids","Girls",4600,"#108A00","Cotton gharara set with delicate embroidery detailing."),
        ("p9","Hand-tied Rakhi Kurta","Chinar Kids","Boys",2900,"#0F2B1B","Festive kurta with hand-tied detailing at the collar."),
        ("p10","Beaded Hairband Set","Zainab Kids","Accessories",850,"#0C6B00","Set of three beaded hairbands to match occasion wear."),
        ("p11","Embroidered Juti, Kids","Bunain","Accessories",1600,"#5C6B61","Traditional embroidered juti, cushioned sole for small feet."),
        ("p12","Quilted Winter Sherwani","Chinar Kids","Occasion",7300,"#B4682F","Quilted sherwani for cooler months, lined for warmth."),
    ]
    for pid, name, brand, cat, price, color, desc in seed:
        conn.execute(
            """INSERT INTO products
               (product_id, created_at, name, brand, category, price, currency,
                image_url, description, sku, stock_status, active)
               VALUES (?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, 'in_stock', true)""",
            [pid, datetime.now(), name, brand, cat, price, color, desc, pid.upper()],
        )


class Measurements(BaseModel):
    child: str | None = None
    age: str | None = None
    chest: str | None = None
    waist: str | None = None
    height: str | None = None
    inseam: str | None = None


class Booking(BaseModel):
    parent_name: str
    phone: str
    child_name: str | None = None
    garment_type: str | None = None
    mode: str | None = None
    date: str | None = None
    time_slot: str | None = None
    notes: str | None = None
    measurements: Measurements | None = None


class ContactMessage(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    message: str


class Product(BaseModel):
    name: str
    brand: str | None = None
    category: str | None = None
    price: float
    currency: str | None = "PKR"
    # Either a real photo URL, or a hex colour like "#108A00" — if it starts
    # with "#", the site draws a simple garment illustration in that colour
    # instead of an image, so you can list a product before you have photos.
    image_url: str | None = None
    description: str | None = None
    sku: str | None = None
    stock_status: str | None = "in_stock"   # legacy field, kept for backward compatibility — use availability instead
    active: bool | None = True

    # ---- Shopping feed attributes (Google Merchant Center / Meta Catalog) ----
    link: str | None = None                          # product page URL — auto-filled if left blank
    additional_image_link: str | None = None
    availability: str | None = "in stock"            # in stock | out of stock | preorder | backorder
    sale_price: float | None = None
    gtin: str | None = None                          # barcode: UPC / EAN / ISBN
    mpn: str | None = None                            # manufacturer part number
    condition: str | None = "new"                     # new | refurbished | used
    google_product_category: str | None = None        # Google's taxonomy, e.g. "Apparel & Accessories > Clothing > Kids' Clothing"
    product_type: str | None = None                   # your own category path, e.g. "Kids > Boys > Kurta"
    color: str | None = None
    size: str | None = None
    gender: str | None = None                          # male | female | unisex
    age_group: str | None = "kids"                     # newborn | infant | toddler | kids | adult
    item_group_id: str | None = None                   # same value across size/colour variants of one product


class OrderItem(BaseModel):
    id: str
    name: str
    brand: str | None = None
    price: float
    qty: int


class Order(BaseModel):
    customer_name: str
    phone: str
    email: str | None = None
    address: str
    city: str | None = "Lahore"
    payment_method: str | None = "Cash on delivery"
    notes: str | None = None
    items: list[OrderItem]
    subtotal: float
    shipping_fee: float | None = 0
    total: float
    currency: str | None = "PKR"


ADMIN_KEY = os.environ.get("ADMIN_KEY", "")

def require_admin(x_admin_key: str | None):
    if not ADMIN_KEY or x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing admin key")


# ================= CUSTOMER AUTH =================
# Passwords are hashed with PBKDF2-HMAC-SHA256 (stdlib only, no extra
# dependency to keep the serverless bundle small) — a per-user random salt
# plus a high iteration count, stored as "salt$hash" in one column.
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260_000)
    return f"{salt}${digest.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$")
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260_000)
        return secrets.compare_digest(check.hex(), digest_hex)
    except Exception:
        return False

SESSION_DAYS = 30

def get_current_customer(authorization: str | None):
    """Returns the customer dict for a valid 'Authorization: Bearer <token>'
    header, or None if missing/invalid/expired. Callers decide whether to
    require it (401) or treat it as optional (guest checkout)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    conn = get_conn()
    row = conn.execute(
        """SELECT c.customer_id, c.name, c.email, c.phone, c.address, c.city, s.expires_at
           FROM sessions s JOIN customers c ON c.customer_id = s.customer_id
           WHERE s.token = ?""",
        [token],
    ).fetchone()
    conn.close()
    if not row:
        return None
    if row[6] and row[6] < datetime.now():
        return None
    return {"customer_id": row[0], "name": row[1], "email": row[2], "phone": row[3], "address": row[4], "city": row[5]}

def require_customer(authorization: str | None):
    customer = get_current_customer(authorization)
    if not customer:
        raise HTTPException(status_code=401, detail="Sign in required")
    return customer


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    phone: str | None = None
    address: str | None = None
    city: str | None = "Lahore"

class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/signup")
def signup(payload: SignupRequest):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    conn = get_conn()
    existing = conn.execute("SELECT customer_id FROM customers WHERE email = ?", [payload.email]).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    customer_id = "cust-" + uuid.uuid4().hex[:10]
    conn.execute(
        """INSERT INTO customers (customer_id, created_at, name, email, phone, password_hash, address, city)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [customer_id, datetime.now(), payload.name, payload.email, payload.phone,
         hash_password(payload.password), payload.address, payload.city],
    )
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions VALUES (?, ?, ?, ?)",
        [token, customer_id, datetime.now(), datetime.now() + timedelta(days=SESSION_DAYS)],
    )
    conn.close()
    return {"token": token, "name": payload.name, "email": payload.email}


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    conn = get_conn()
    row = conn.execute(
        "SELECT customer_id, name, password_hash FROM customers WHERE email = ?", [payload.email]
    ).fetchone()
    # Same generic error either way — avoids confirming whether an email is registered.
    if not row or not verify_password(payload.password, row[2]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO sessions VALUES (?, ?, ?, ?)",
        [token, row[0], datetime.now(), datetime.now() + timedelta(days=SESSION_DAYS)],
    )
    conn.close()
    return {"token": token, "name": row[1], "email": payload.email}


@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE token = ?", [authorization.removeprefix("Bearer ").strip()])
        conn.close()
    return {"status": "logged out"}


@app.get("/api/auth/me")
def me(authorization: str | None = Header(default=None)):
    return require_customer(authorization)


@app.get("/api")
def health():
    return {"status": "ok", "service": "tifl-booking-api"}


@app.post("/api/bookings")
def create_booking(booking: Booking):
    booking_id = "TLW-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO bookings
            (booking_id, created_at, parent_name, child_name, phone,
             garment_type, mode, date, time_slot, notes, measurements)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            booking_id,
            datetime.now(),
            booking.parent_name,
            booking.child_name,
            booking.phone,
            booking.garment_type,
            booking.mode,
            booking.date,
            booking.time_slot,
            booking.notes,
            json.dumps(booking.measurements.dict()) if booking.measurements else None,
        ],
    )
    conn.close()
    return {"booking_id": booking_id, "status": "confirmed"}


@app.get("/api/bookings")
def list_bookings():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM bookings ORDER BY created_at DESC").fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


@app.post("/api/contact")
def create_contact_message(msg: ContactMessage):
    message_id = "MSG-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        "INSERT INTO contact_messages VALUES (?, ?, ?, ?, ?, ?)",
        [message_id, datetime.now(), msg.name, msg.phone, msg.email, msg.message],
    )
    conn.close()
    return {"message_id": message_id, "status": "received"}


@app.get("/api/contact")
def list_contact_messages():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM contact_messages ORDER BY created_at DESC").fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


# ================= PRODUCTS =================
# Public: GET (used by shop.html and product.html)
# Admin-key protected: POST / PUT / DELETE (used by admin.html)
# Set ADMIN_KEY in Vercel -> Settings -> Environment Variables, then enter
# the same value into admin.html when prompted.

@app.get("/api/products")
def list_products():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM products WHERE active = true ORDER BY created_at DESC"
    ).fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


# ================= SHOPPING FEEDS =================
# Point Google Merchant Center and Meta Commerce Manager directly at these
# URLs to sync your catalogue automatically. Both only include active
# products with a price set. IMPORTANT: these must be registered before
# the "/api/products/{product_id}" route below — otherwise FastAPI would
# treat "feed.xml"/"feed.csv" as a product_id and 404 instead of serving
# the feed.
SITE_URL = "https://www.tifllittlewear.com"

def feed_rows(conn):
    rows = conn.execute(
        "SELECT * FROM products WHERE active = true AND price IS NOT NULL ORDER BY created_at DESC"
    ).fetchall()
    cols = [c[0] for c in conn.description]
    return [dict(zip(cols, row)) for row in rows]


@app.get("/api/products/feed.xml")
def products_feed_xml():
    import xml.sax.saxutils as sx
    conn = get_conn()
    items = feed_rows(conn)
    conn.close()

    def esc(v):
        return sx.escape(str(v)) if v is not None else ""

    xml_items = []
    for p in items:
        link = p.get("link") or f"{SITE_URL}/product.html?id={p['product_id']}"
        image = p.get("image_url") or ""
        if image.startswith("#"):
            image = ""  # placeholder colour swatches aren't real images — omit rather than send a bad link
        xml_items.append(f"""
    <item>
      <g:id>{esc(p.get('sku') or p['product_id'])}</g:id>
      <title>{esc(p['name'])}</title>
      <description>{esc(p.get('description') or p['name'])}</description>
      <link>{esc(link)}</link>
      <g:image_link>{esc(image)}</g:image_link>
      <g:availability>{esc(p.get('availability') or 'in stock')}</g:availability>
      <g:price>{esc(p['price'])} {esc(p.get('currency') or 'PKR')}</g:price>
      {f"<g:sale_price>{esc(p['sale_price'])} {esc(p.get('currency') or 'PKR')}</g:sale_price>" if p.get('sale_price') else ""}
      <g:brand>{esc(p.get('brand') or 'Tifl Little Wear')}</g:brand>
      <g:condition>{esc(p.get('condition') or 'new')}</g:condition>
      {f"<g:gtin>{esc(p['gtin'])}</g:gtin>" if p.get('gtin') else ""}
      {f"<g:mpn>{esc(p['mpn'])}</g:mpn>" if p.get('mpn') else ""}
      {f"<g:google_product_category>{esc(p['google_product_category'])}</g:google_product_category>" if p.get('google_product_category') else ""}
      {f"<g:product_type>{esc(p['product_type'])}</g:product_type>" if p.get('product_type') else ""}
      {f"<g:color>{esc(p['color'])}</g:color>" if p.get('color') else ""}
      {f"<g:size>{esc(p['size'])}</g:size>" if p.get('size') else ""}
      {f"<g:gender>{esc(p['gender'])}</g:gender>" if p.get('gender') else ""}
      <g:age_group>{esc(p.get('age_group') or 'kids')}</g:age_group>
      {f"<g:item_group_id>{esc(p['item_group_id'])}</g:item_group_id>" if p.get('item_group_id') else ""}
    </item>""")

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Tifl Little Wear — Product Feed</title>
    <link>{SITE_URL}</link>
    <description>Made-to-measure and ready-to-wear kidswear, Lahore.</description>
    {''.join(xml_items)}
  </channel>
</rss>"""
    return Response(content=feed, media_type="application/xml")


@app.get("/api/products/feed.csv")
def products_feed_csv():
    import io, csv
    conn = get_conn()
    items = feed_rows(conn)
    conn.close()

    header = [
        "id", "title", "description", "link", "image_link", "availability", "price",
        "sale_price", "brand", "condition", "gtin", "mpn", "google_product_category",
        "product_type", "color", "size", "gender", "age_group", "item_group_id",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for p in items:
        link = p.get("link") or f"{SITE_URL}/product.html?id={p['product_id']}"
        image = p.get("image_url") or ""
        if image.startswith("#"):
            image = ""
        writer.writerow([
            p.get("sku") or p["product_id"],
            p["name"],
            p.get("description") or p["name"],
            link,
            image,
            p.get("availability") or "in stock",
            f"{p['price']} {p.get('currency') or 'PKR'}",
            f"{p['sale_price']} {p.get('currency') or 'PKR'}" if p.get("sale_price") else "",
            p.get("brand") or "Tifl Little Wear",
            p.get("condition") or "new",
            p.get("gtin") or "",
            p.get("mpn") or "",
            p.get("google_product_category") or "",
            p.get("product_type") or "",
            p.get("color") or "",
            p.get("size") or "",
            p.get("gender") or "",
            p.get("age_group") or "kids",
            p.get("item_group_id") or "",
        ])
    return Response(content=buf.getvalue(), media_type="text/csv")


@app.get("/api/products/{product_id}")
def get_product(product_id: str):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM products WHERE product_id = ?", [product_id]
    ).fetchone()
    cols = [c[0] for c in conn.description]
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return dict(zip(cols, row))


# All product columns except product_id/created_at (which are handled
# separately) — used to build INSERT/UPDATE statements without manually
# counting placeholders every time a field is added.
PRODUCT_FIELDS = [
    "name", "brand", "category", "price", "currency", "image_url", "description",
    "sku", "stock_status", "active", "link", "additional_image_link", "availability",
    "sale_price", "gtin", "mpn", "condition", "google_product_category", "product_type",
    "color", "size", "gender", "age_group", "item_group_id",
]

def product_values(product: "Product"):
    return [getattr(product, f) for f in PRODUCT_FIELDS]


@app.post("/api/products")
def create_product(product: Product, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    product_id = "p-" + uuid.uuid4().hex[:8]
    conn = get_conn()
    cols = ", ".join(PRODUCT_FIELDS)
    placeholders = ", ".join(["?"] * len(PRODUCT_FIELDS))
    conn.execute(
        f"INSERT INTO products (product_id, created_at, {cols}) VALUES (?, ?, {placeholders})",
        [product_id, datetime.now()] + product_values(product),
    )
    conn.close()
    return {"product_id": product_id, "status": "created"}


@app.put("/api/products/{product_id}")
def update_product(product_id: str, product: Product, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    set_clause = ", ".join([f"{f}=?" for f in PRODUCT_FIELDS])
    conn.execute(
        f"UPDATE products SET {set_clause} WHERE product_id=?",
        product_values(product) + [product_id],
    )
    conn.close()
    return {"product_id": product_id, "status": "updated"}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: str, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    conn.execute("DELETE FROM products WHERE product_id = ?", [product_id])
    conn.close()
    return {"product_id": product_id, "status": "deleted"}


# ================= BULK IMPORT (CSV / XML from admin.html) =================
# The browser parses the uploaded CSV/XML into JSON and posts it here — this
# endpoint never touches a file, just a list of product-shaped dicts. If an
# item's "sku" matches an existing product, that product is updated in
# place; otherwise a new product is created. This makes re-uploading the
# same feed file safe to repeat (e.g. a weekly export from your supplier).
@app.post("/api/products/bulk")
def bulk_import_products(payload: dict, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    items = payload.get("items", [])
    conn = get_conn()
    created, updated, errors = 0, 0, []

    for i, raw in enumerate(items):
        try:
            product = Product(**{k: v for k, v in raw.items() if k in Product.model_fields})
        except Exception as e:
            errors.append({"row": i, "error": str(e)})
            continue

        existing_id = None
        if product.sku:
            row = conn.execute(
                "SELECT product_id FROM products WHERE sku = ? LIMIT 1", [product.sku]
            ).fetchone()
            if row:
                existing_id = row[0]

        if existing_id:
            set_clause = ", ".join([f"{f}=?" for f in PRODUCT_FIELDS])
            conn.execute(
                f"UPDATE products SET {set_clause} WHERE product_id=?",
                product_values(product) + [existing_id],
            )
            updated += 1
        else:
            product_id = "p-" + uuid.uuid4().hex[:8]
            cols = ", ".join(PRODUCT_FIELDS)
            placeholders = ", ".join(["?"] * len(PRODUCT_FIELDS))
            conn.execute(
                f"INSERT INTO products (product_id, created_at, {cols}) VALUES (?, ?, {placeholders})",
                [product_id, datetime.now()] + product_values(product),
            )
            created += 1

    conn.close()
    return {"created": created, "updated": updated, "errors": errors, "total": len(items)}


# ================= ORDERS =================
@app.post("/api/orders")
def create_order(order: Order, authorization: str | None = Header(default=None)):
    # Auth is optional here — guest checkout still works. If a valid
    # session is present, the order is linked to that customer so it shows
    # up under "My Orders" and future one-click buys can reuse their info.
    customer = get_current_customer(authorization)
    order_id = "TLW-ORD-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        """INSERT INTO orders
           (order_id, created_at, customer_name, phone, email, address, city,
            payment_method, notes, items, subtotal, shipping_fee, total, currency, status, customer_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)""",
        [order_id, datetime.now(), order.customer_name, order.phone, order.email,
         order.address, order.city, order.payment_method, order.notes,
         json.dumps([i.dict() for i in order.items]), order.subtotal,
         order.shipping_fee, order.total, order.currency,
         customer["customer_id"] if customer else None],
    )
    conn.close()
    return {"order_id": order_id, "status": "received"}


@app.get("/api/orders")
def list_orders(x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


@app.get("/api/orders/mine")
def my_orders(authorization: str | None = Header(default=None)):
    customer = require_customer(authorization)
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC", [customer["customer_id"]]
    ).fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


# ================= LIVE SALE COMMENTS =================
class LiveComment(BaseModel):
    message: str

@app.get("/api/live/comments")
def list_live_comments():
    conn = get_conn()
    rows = conn.execute(
        "SELECT comment_id, created_at, name, message FROM live_comments ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [{"comment_id": r[0], "created_at": str(r[1]), "name": r[2], "message": r[3]} for r in rows][::-1]

@app.post("/api/live/comments")
def post_live_comment(comment: LiveComment, authorization: str | None = Header(default=None)):
    customer = require_customer(authorization)
    if not comment.message.strip():
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    comment_id = "cmt-" + uuid.uuid4().hex[:8]
    conn = get_conn()
    conn.execute(
        "INSERT INTO live_comments VALUES (?, ?, ?, ?, ?)",
        [comment_id, datetime.now(), customer["customer_id"], customer["name"], comment.message.strip()[:500]],
    )
    conn.close()
    return {"comment_id": comment_id, "status": "posted"}
