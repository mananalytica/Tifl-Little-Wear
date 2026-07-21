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

import json
import os
import uuid
from datetime import datetime

# Vercel's serverless filesystem is read-only except /tmp. DuckDB looks up
# the OS-level HOME environment variable to decide where to install the
# MotherDuck extension on first connect, so it must be set before any
# duckdb.connect() call — the "home_directory" connect option alone isn't
# enough in this environment.
os.environ["HOME"] = "/tmp"

import duckdb
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
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


def get_conn():
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
    seed_products_if_empty(conn)
    return conn


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
    stock_status: str | None = "in_stock"
    active: bool | None = True


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


@app.get("/api")
def health():
    return {"status": "ok", "service": "tifl-booking-api"}


@app.post("/bookings")
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


@app.get("/bookings")
def list_bookings():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM bookings ORDER BY created_at DESC").fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


@app.post("/contact")
def create_contact_message(msg: ContactMessage):
    message_id = "MSG-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        "INSERT INTO contact_messages VALUES (?, ?, ?, ?, ?, ?)",
        [message_id, datetime.now(), msg.name, msg.phone, msg.email, msg.message],
    )
    conn.close()
    return {"message_id": message_id, "status": "received"}


@app.get("/contact")
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

@app.get("/products")
def list_products():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM products WHERE active = true ORDER BY created_at DESC"
    ).fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


@app.get("/products/{product_id}")
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


@app.post("/products")
def create_product(product: Product, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    product_id = "p-" + uuid.uuid4().hex[:8]
    conn = get_conn()
    conn.execute(
        """INSERT INTO products
           (product_id, created_at, name, brand, category, price, currency,
            image_url, description, sku, stock_status, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [product_id, datetime.now(), product.name, product.brand, product.category,
         product.price, product.currency, product.image_url, product.description,
         product.sku, product.stock_status, product.active],
    )
    conn.close()
    return {"product_id": product_id, "status": "created"}


@app.put("/products/{product_id}")
def update_product(product_id: str, product: Product, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    conn.execute(
        """UPDATE products SET name=?, brand=?, category=?, price=?, currency=?,
           image_url=?, description=?, sku=?, stock_status=?, active=?
           WHERE product_id=?""",
        [product.name, product.brand, product.category, product.price, product.currency,
         product.image_url, product.description, product.sku, product.stock_status,
         product.active, product_id],
    )
    conn.close()
    return {"product_id": product_id, "status": "updated"}


@app.delete("/products/{product_id}")
def delete_product(product_id: str, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    conn.execute("DELETE FROM products WHERE product_id = ?", [product_id])
    conn.close()
    return {"product_id": product_id, "status": "deleted"}


# ================= ORDERS =================
@app.post("/orders")
def create_order(order: Order):
    order_id = "TLW-ORD-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        """INSERT INTO orders
           (order_id, created_at, customer_name, phone, email, address, city,
            payment_method, notes, items, subtotal, shipping_fee, total, currency, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')""",
        [order_id, datetime.now(), order.customer_name, order.phone, order.email,
         order.address, order.city, order.payment_method, order.notes,
         json.dumps([i.dict() for i in order.items]), order.subtotal,
         order.shipping_fee, order.total, order.currency],
    )
    conn.close()
    return {"order_id": order_id, "status": "received"}


@app.get("/orders")
def list_orders(x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]