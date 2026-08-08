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
import rudderstack.analytics as rudder_analytics
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

MOTHERDUCK_TOKEN = os.environ.get("MOTHERDUCK_TOKEN", "")
DB_NAME = "tifl_bookings"

# ================= RUDDERSTACK (server-side) =================
# Used for the conversion-critical events (orders, bookings, signups) —
# firing these from the server instead of only the browser means they
# still get recorded even if a customer has an ad blocker, third-party
# cookies disabled, or closes the tab right after paying.
# ⚙️ EDIT ME: set RUDDERSTACK_WRITE_KEY and RUDDERSTACK_DATA_PLANE_URL in
# Vercel → Settings → Environment Variables (use your server/backend write
# key here, not the JS one from rudderstack.js — RudderStack sources have
# separate keys per platform).
rudder_analytics.write_key = os.environ.get("RUDDERSTACK_WRITE_KEY", "")
rudder_analytics.dataPlaneUrl = os.environ.get("RUDDERSTACK_DATA_PLANE_URL", "")

def rs_track(user_id: str, event: str, properties: dict, anonymous_id: str | None = None):
    if not rudder_analytics.write_key:
        return  # not configured yet — no-op rather than error
    try:
        kwargs = {"event": event, "properties": properties}
        # Passing both user_id and anonymous_id is what lets RudderStack
        # merge this server-side event into the same identity graph as
        # the browser session that submitted the form — without it, a
        # guest's pre-signup browsing and their order end up as two
        # disconnected people in RudderStack instead of one.
        if user_id:
            kwargs["user_id"] = user_id
        if anonymous_id:
            kwargs["anonymous_id"] = anonymous_id
        if not user_id and not anonymous_id:
            return  # nothing to key the event on
        rudder_analytics.track(**kwargs)
        # RudderStack's own docs warn against calling flush() as part of a
        # normal request lifecycle, since it blocks until the queue drains —
        # that advice is for long-running servers. We're on Vercel: this
        # function can freeze the moment it returns a response, so the
        # SDK's background flush thread (default: every 0.5s or 100 events)
        # may never get a chance to actually send the event. Blocking here
        # is the deliberate exception — without it, events are silently
        # lost, not just delayed.
        rudder_analytics.flush()
    except Exception:
        pass  # analytics should never break a real request

def rs_identify(user_id: str, traits: dict, anonymous_id: str | None = None):
    if not rudder_analytics.write_key:
        return
    try:
        kwargs = {"user_id": user_id, "traits": traits}
        if anonymous_id:
            kwargs["anonymous_id"] = anonymous_id
        rudder_analytics.identify(**kwargs)
        rudder_analytics.flush()  # see note in rs_track above
    except Exception:
        pass

# Flattens the { first_touch: {...}, last_touch: {...} } attribution
# object from the browser into event properties, e.g.
# first_touch_utm_source, last_touch_utm_campaign, etc.
def flatten_attribution(attribution: dict | None) -> dict:
    if not attribution:
        return {}
    flat = {}
    for touch_name in ("first_touch", "last_touch"):
        touch = attribution.get(touch_name) if isinstance(attribution, dict) else None
        if not touch:
            continue
        for k, v in touch.items():
            flat[f"{touch_name}_{k}"] = v
    return flat

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
    if not _schema_ready:
        # Only touch the account-level (no-database) connection once per
        # warm instance, purely to create the database if it's missing.
        # Doing this on every single request (as before) was an extra
        # avoidable network round trip every time.
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

    if not _schema_ready:
        ensure_schema(conn)
        _schema_ready = True

    return conn


def ensure_schema(conn):
    # Try running all CREATE TABLE statements as one batched script first
    # (fewer network round trips to MotherDuck). If this DuckDB/MotherDuck
    # version doesn't support multi-statement execute(), fall back to one
    # statement at a time — slower on that one cold start, but never fails.
    create_statements = [
        """CREATE TABLE IF NOT EXISTS bookings (
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
        );""",
        """CREATE TABLE IF NOT EXISTS contact_messages (
            message_id      VARCHAR PRIMARY KEY,
            created_at      TIMESTAMP,
            name            VARCHAR,
            phone           VARCHAR,
            email           VARCHAR,
            message         VARCHAR
        );""",
        """CREATE TABLE IF NOT EXISTS products (
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
        );""",
        """CREATE TABLE IF NOT EXISTS orders (
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
        );""",
        """CREATE TABLE IF NOT EXISTS customers (
            customer_id      VARCHAR PRIMARY KEY,
            created_at       TIMESTAMP,
            name             VARCHAR,
            email            VARCHAR,
            phone            VARCHAR,
            password_hash    VARCHAR,
            address          VARCHAR,
            city             VARCHAR
        );""",
        """CREATE TABLE IF NOT EXISTS sessions (
            token            VARCHAR PRIMARY KEY,
            customer_id      VARCHAR,
            created_at       TIMESTAMP,
            expires_at       TIMESTAMP
        );""",
        """CREATE TABLE IF NOT EXISTS live_comments (
            comment_id       VARCHAR PRIMARY KEY,
            created_at       TIMESTAMP,
            customer_id      VARCHAR,
            name             VARCHAR,
            message          VARCHAR
        );""",
        """CREATE TABLE IF NOT EXISTS analytics_events (
            event_id         VARCHAR PRIMARY KEY,
            received_at      TIMESTAMP,
            event_name       VARCHAR,
            event_type       VARCHAR,
            user_id          VARCHAR,
            anonymous_id     VARCHAR,
            payload          JSON
        );""",
        """CREATE TABLE IF NOT EXISTS quiz_leads (
            lead_id          VARCHAR PRIMARY KEY,
            created_at       TIMESTAMP,
            email            VARCHAR,
            age_band         VARCHAR,
            occasion         VARCHAR,
            activity         VARCHAR,
            care             VARCHAR,
            recommended      VARCHAR
        );""",
        # One row per master tailor. Each row becomes its own page at
        # master-tailor.html?slug=<slug> — see TAILOR ONBOARDING notes
        # near seed_tailors_if_empty() below for how a new tailor is added.
        """CREATE TABLE IF NOT EXISTS tailors (
            tailor_id          VARCHAR PRIMARY KEY,
            created_at         TIMESTAMP,
            slug               VARCHAR,
            name               VARCHAR,
            title              VARCHAR,
            tagline            VARCHAR,
            photo_url          VARCHAR,
            years_experience   INTEGER,
            garments_count     VARCHAR,
            apprentices_count  VARCHAR,
            established_year   VARCHAR,
            bio                VARCHAR,
            specialties        JSON,
            timeline           JSON,
            gallery            JSON,
            testimonials       JSON,
            active             BOOLEAN
        );""",
    ]
    try:
        conn.execute("\n".join(create_statements))
    except Exception:
        for stmt in create_statements:
            try:
                conn.execute(stmt)
            except Exception:
                pass

    # ================= SHOPPING FEED ATTRIBUTES + customer_id =================
    # Same batch-then-fallback pattern. Column names follow Google Merchant
    # Center / Meta Catalog feed specs directly.
    shopping_columns = [
        ("link", "VARCHAR"), ("additional_image_link", "VARCHAR"),
        ("availability", "VARCHAR"), ("sale_price", "DOUBLE"),
        ("gtin", "VARCHAR"), ("mpn", "VARCHAR"), ("condition", "VARCHAR"),
        ("google_product_category", "VARCHAR"), ("product_type", "VARCHAR"),
        ("color", "VARCHAR"), ("size", "VARCHAR"), ("gender", "VARCHAR"),
        ("age_group", "VARCHAR"), ("item_group_id", "VARCHAR"), ("material", "VARCHAR"),
        # Bullet-point selling points shown as the checkmark strip on the
        # product page (e.g. "Premium Jacquard Fabric: Crafted from..."),
        # stored as JSON: [{"title": "...", "description": "..."}, ...].
        ("features", "JSON"),
    ]
    alter_statements = [f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {c} {t};" for c, t in shopping_columns]
    alter_statements.append("ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id VARCHAR;")
    alter_statements.append("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email VARCHAR;")
    alter_statements.append("ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_line2 VARCHAR;")
    alter_statements.append("ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_code VARCHAR;")
    alter_statements.append("ALTER TABLE orders ADD COLUMN IF NOT EXISTS state VARCHAR;")
    alter_statements.append("ALTER TABLE orders ADD COLUMN IF NOT EXISTS country VARCHAR;")
    # Designer/tailor attribution — which master tailor cut and finished this
    # piece. Stores the tailor's SLUG (e.g. "abdul-sattar"), not their display
    # name, so renaming a tailor never breaks product attribution. Resolved
    # to a name + link on product.html via /api/tailors/{slug}.
    alter_statements.append("ALTER TABLE products ADD COLUMN IF NOT EXISTS tailor VARCHAR;")
    # Which tailor a booking was requested with (their name, for readability
    # in the bookings list) — set when someone books from a tailor's own
    # "Book with [Name]" form on master-tailor.html (blank for a normal
    # studio booking).
    alter_statements.append("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS preferred_tailor VARCHAR;")
    try:
        conn.execute("\n".join(alter_statements))
    except Exception:
        for stmt in alter_statements:
            try:
                conn.execute(stmt)
            except Exception:
                pass

    seed_products_if_empty(conn)
    seed_tailors_if_empty(conn)


def seed_products_if_empty(conn):
    count = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    if count > 0:
        return
    # Last field is the tailor attribution — pieces cut and finished
    # in-house by Ustad Abdul Sattar are tagged so they surface in his
    # portfolio on master-tailor.html. Ready-to-wear partner-brand pieces
    # (Chinar Kids, Bunain, etc.) are left blank since they aren't his work.
    # Last field is the tailor attribution — the SLUG of whoever cut and
    # finished the piece in-house (see the `tailors` table / Tailor model
    # below). Ready-to-wear partner-brand pieces (Chinar Kids, Bunain, etc.)
    # are left blank since they aren't studio-tailored.
    seed = [
        ("p1","Block-print Kurta Set","Chinar Kids","Boys",3200,"#108A00","Hand block-printed cotton kurta and pajama set, breathable for everyday wear.",None),
        ("p2","Layered Cotton Frock","Bunain","Girls",3800,"#0C6B00","A layered cotton frock with soft gathers, easy to move in.",None),
        ("p3","Newborn Gown, 0-3m","Rui & Co","Newborn",2100,"#5C6B61","Soft muslin gown for newborns, envelope neckline for easy changing.",None),
        ("p4","Silk Waistcoat Set","Tifl Little Wear","Occasion",6200,"#0F2B1B","Silk waistcoat and trouser set, hand-cut and finished in the studio for weddings and formal occasions.","abdul-sattar"),
        ("p5","Everyday Dungaree","Bunain","Boys",2600,"#108A00","Sturdy cotton dungaree built for play, adjustable straps.",None),
        ("p6","Embroidered Lehnga, Mini","Tifl Little Wear","Occasion",8400,"#0C6B00","Hand-embroidered mini lehnga with dupatta, drafted and stitched in-house for festive occasions.","abdul-sattar"),
        ("p7","Soft Muslin Romper","Rui & Co","Newborn",1900,"#5C6B61","Breathable muslin romper, popper closures for quick changes.",None),
        ("p8","Cotton Gharara Set","Tifl Little Wear","Girls",4600,"#108A00","Cotton gharara set with delicate hand embroidery, cut in the studio.","abdul-sattar"),
        ("p9","Hand-tied Rakhi Kurta","Chinar Kids","Boys",2900,"#0F2B1B","Festive kurta with hand-tied detailing at the collar.",None),
        ("p10","Beaded Hairband Set","Zainab Kids","Accessories",850,"#0C6B00","Set of three beaded hairbands to match occasion wear.",None),
        ("p11","Embroidered Juti, Kids","Bunain","Accessories",1600,"#5C6B61","Traditional embroidered juti, cushioned sole for small feet.",None),
        ("p12","Quilted Winter Sherwani","Tifl Little Wear","Occasion",7300,"#B4682F","Quilted sherwani for cooler months, hand-lined and finished by the studio's master tailor.","abdul-sattar"),
    ]
    for pid, name, brand, cat, price, color, desc, tailor in seed:
        conn.execute(
            """INSERT INTO products
               (product_id, created_at, name, brand, category, price, currency,
                image_url, description, sku, stock_status, active, tailor)
               VALUES (?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, 'in_stock', true, ?)""",
            [pid, datetime.now(), name, brand, cat, price, color, desc, pid.upper(), tailor],
        )


# ================= TAILOR ONBOARDING =================
# How to add a new master tailor (no code changes needed):
#   1. Open admin.html -> "Tailors" panel -> "Add a tailor".
#   2. Fill in name, slug (used in the URL — keep it short, e.g. "iram-baig"),
#      photo, years of experience, bio, and (optionally) specialties /
#      timeline / gallery / testimonials.
#   3. Save. Their page is immediately live at
#      master-tailor.html?slug=<their-slug> and they appear on tailors.html.
#   4. Tag any of their pieces to them in the product form's "Designed /
#      stitched by" dropdown (admin.html -> Products) — those pieces then
#      populate their portfolio + lookbook automatically.
# That's the whole flow — nothing here needs a redeploy per tailor.
def seed_tailors_if_empty(conn):
    count = conn.execute("SELECT count(*) FROM tailors").fetchone()[0]
    if count > 0:
        return
    specialties = json.dumps([
        {"title": "Hand-drafted patterns", "description": "No size charts — every pattern starts as a fresh draft from the child's own measurements, chalked and cut by hand."},
        {"title": "A Multan training lineage", "description": "Apprenticed under his father's shop in Multan from age 14, then twelve years cutting occasion wear before opening his own line in Lahore."},
        {"title": "Embroidery specialist", "description": "Focused on hand-set embroidery for festive and bridal-side pieces — the lehngas and sherwanis marked \"by Ustad Sattar\" are his."},
    ])
    timeline = json.dumps([
        {"year": "2000", "title": "Apprenticeship", "description": "Started learning the trade at 14, in his father's tailoring shop in Multan."},
        {"year": "2008", "title": "His own line", "description": "Opened a small occasion-wear shop, specialising in hand embroidery for weddings."},
        {"year": "2010", "title": "Joined Tifl", "description": "Moved to Lahore to lead Tifl Little Wear's made-to-measure and occasion-wear line."},
        {"year": "Today", "title": "Mentoring", "description": "Trains the studio's newer tailors and still cuts every occasion piece personally."},
    ])
    gallery = json.dumps([
        {"image_url": "#C24B7C", "title": "The Gulabi Anarkali", "caption": "Crafted by Ustad Abdul Sattar", "tag": "Ages 12-16"},
        {"image_url": "#3AA0A8", "title": "Firuzi Fusion Kurta", "caption": "Lightweight summer formal", "tag": "Ages 5-8"},
        {"image_url": "#D8C7B0", "title": "Ivory Block Print", "caption": "Hand block-printed cotton", "tag": None},
    ])
    testimonials = json.dumps([
        {"quote": "He remeasured our son's kurta himself and had it ready before the fitting even ended — the embroidery on the collar was better than anything we'd seen ready-made.", "name": "Sana R.", "location": "Gulberg, Lahore"},
        {"quote": "Booked a private fitting for a wedding lehnga on short notice. Ustad Sattar sketched changes on the spot and it fit perfectly on the day.", "name": "Hina M.", "location": "DHA, Lahore"},
    ])
    conn.execute(
        """INSERT INTO tailors
           (tailor_id, created_at, slug, name, title, tagline, photo_url,
            years_experience, garments_count, apprentices_count, established_year,
            bio, specialties, timeline, gallery, testimonials, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)""",
        [
            "t-abdulsattar", datetime.now(), "abdul-sattar", "Ustad Abdul Sattar", "Master Tailor",
            "24 years of hands that shaped this studio's stitch line.", "#101B2E",
            24, "3,000+", "12", "2010",
            "Every occasion piece in our in-house line passes through Ustad Sattar's hands — pattern drafted from scratch, embroidery marked by eye, seams finished the way he learned them from his father's shop in Multan.",
            specialties, timeline, gallery, testimonials,
        ],
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
    email: str | None = None
    child_name: str | None = None
    garment_type: str | None = None
    mode: str | None = None
    date: str | None = None
    time_slot: str | None = None
    notes: str | None = None
    measurements: Measurements | None = None
    preferred_tailor: str | None = None   # set when booked from a specific tailor's page, e.g. master-tailor.html
    anonymous_id: str | None = None
    attribution: dict | None = None


class ContactMessage(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    message: str
    anonymous_id: str | None = None
    attribution: dict | None = None


class ProductFeature(BaseModel):
    title: str
    description: str | None = None


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
    # One or more extra photo URLs, comma-separated (matches the Google
    # Merchant Center text-feed convention for this exact attribute) — the
    # product gallery on product.html shows image_url plus every URL here.
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
    material: str | None = None                        # e.g. "100% Cotton", "Lawn", "Silk blend"
    tailor: str | None = None                           # which in-house master tailor cut/finished this piece, if any
    # Selling-point bullets shown as the checkmark strip on product.html,
    # e.g. [{"title": "Premium Jacquard Fabric", "description": "Crafted from..."}].
    features: list[ProductFeature] | None = None


class TailorSpecialty(BaseModel):
    title: str
    description: str


class TailorTimelineItem(BaseModel):
    year: str
    title: str
    description: str


class TailorGalleryItem(BaseModel):
    image_url: str          # real photo URL, or a hex colour like "#C24B7C" for a placeholder tile
    title: str | None = None
    caption: str | None = None
    tag: str | None = None  # small badge, e.g. "Ages 5-8"


class TailorTestimonial(BaseModel):
    quote: str
    name: str
    location: str | None = None


class Tailor(BaseModel):
    slug: str                                    # used in the URL: master-tailor.html?slug=<slug>
    name: str
    title: str | None = "Master Tailor"
    tagline: str | None = None
    # Real photo URL, or a hex colour like "#101B2E" — if it starts with
    # "#", the hero draws a placeholder illustration in that colour instead
    # of a photo, so a tailor can be onboarded before headshots exist.
    photo_url: str | None = None
    years_experience: int | None = None
    garments_count: str | None = None
    apprentices_count: str | None = None
    established_year: str | None = None
    bio: str | None = None
    specialties: list[TailorSpecialty] | None = None
    timeline: list[TailorTimelineItem] | None = None
    gallery: list[TailorGalleryItem] | None = None
    testimonials: list[TailorTestimonial] | None = None
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
    address_line2: str | None = None
    city: str | None = "Lahore"
    postal_code: str | None = None
    state: str | None = None
    country: str | None = "Pakistan"
    payment_method: str | None = "Cash on delivery"
    notes: str | None = None
    items: list[OrderItem]
    subtotal: float
    shipping_fee: float | None = 0
    total: float
    currency: str | None = "PKR"
    anonymous_id: str | None = None
    attribution: dict | None = None


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
    anonymous_id: str | None = None
    attribution: dict | None = None

class LoginRequest(BaseModel):
    email: str
    password: str
    anonymous_id: str | None = None


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
    rs_identify(payload.email, {
        "name": payload.name, "email": payload.email, "phone": payload.phone,
        "address": payload.address, "city": payload.city,
    }, anonymous_id=payload.anonymous_id)
    rs_track(payload.email, "Signed Up",
             dict({"method": "email"}, **flatten_attribution(payload.attribution)),
             anonymous_id=payload.anonymous_id)
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
    rs_track(payload.email, "Logged In", {"method": "email"}, anonymous_id=payload.anonymous_id)
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
            (booking_id, created_at, parent_name, child_name, phone, email,
             garment_type, mode, date, time_slot, notes, measurements, preferred_tailor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            booking_id,
            datetime.now(),
            booking.parent_name,
            booking.child_name,
            booking.phone,
            booking.email,
            booking.garment_type,
            booking.mode,
            booking.date,
            booking.time_slot,
            booking.notes,
            json.dumps(booking.measurements.dict()) if booking.measurements else None,
            booking.preferred_tailor,
        ],
    )
    conn.close()
    rs_track(booking.email or booking.phone, "Booking Confirmed",
              dict({
                  "booking_id": booking_id, "parent_name": booking.parent_name, "child_name": booking.child_name,
                  "garment_type": booking.garment_type, "mode": booking.mode, "date": booking.date, "time_slot": booking.time_slot,
                  "preferred_tailor": booking.preferred_tailor,
              }, **flatten_attribution(booking.attribution)),
              anonymous_id=booking.anonymous_id)
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
    rs_track(msg.email or msg.phone or message_id, "Contact Form Submitted",
              dict({"message_id": message_id, "name": msg.name}, **flatten_attribution(msg.attribution)),
              anonymous_id=msg.anonymous_id)
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

# ================= TAILORS =================
# One page per row — see the TAILOR ONBOARDING comment above
# seed_tailors_if_empty() for the full add-a-new-tailor flow.
TAILOR_FIELDS = [
    "slug", "name", "title", "tagline", "photo_url", "years_experience",
    "garments_count", "apprentices_count", "established_year", "bio",
    "specialties", "timeline", "gallery", "testimonials", "active",
]
TAILOR_JSON_FIELDS = {"specialties", "timeline", "gallery", "testimonials"}

def tailor_values(tailor: "Tailor"):
    values = []
    for f in TAILOR_FIELDS:
        v = getattr(tailor, f)
        if f in TAILOR_JSON_FIELDS and v is not None:
            v = json.dumps([item.dict() for item in v])
        values.append(v)
    return values


@app.get("/api/tailors")
def list_tailors():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM tailors WHERE active = true ORDER BY created_at"
    ).fetchall()
    cols = [c[0] for c in conn.description]
    conn.close()
    return [dict(zip(cols, row)) for row in rows]


@app.get("/api/tailors/{slug}")
def get_tailor(slug: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM tailors WHERE slug = ?", [slug]).fetchone()
    cols = [c[0] for c in conn.description]
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Tailor not found")
    return dict(zip(cols, row))


@app.post("/api/tailors")
def create_tailor(tailor: Tailor, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    tailor_id = "t-" + uuid.uuid4().hex[:8]
    conn = get_conn()
    cols = ", ".join(TAILOR_FIELDS)
    placeholders = ", ".join(["?"] * len(TAILOR_FIELDS))
    conn.execute(
        f"INSERT INTO tailors (tailor_id, created_at, {cols}) VALUES (?, ?, {placeholders})",
        [tailor_id, datetime.now()] + tailor_values(tailor),
    )
    conn.close()
    return {"tailor_id": tailor_id, "status": "created"}


@app.put("/api/tailors/{tailor_id}")
def update_tailor(tailor_id: str, tailor: Tailor, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    set_clause = ", ".join([f"{f}=?" for f in TAILOR_FIELDS])
    conn.execute(
        f"UPDATE tailors SET {set_clause} WHERE tailor_id=?",
        tailor_values(tailor) + [tailor_id],
    )
    conn.close()
    return {"tailor_id": tailor_id, "status": "updated"}


@app.delete("/api/tailors/{tailor_id}")
def delete_tailor(tailor_id: str, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    conn = get_conn()
    conn.execute("DELETE FROM tailors WHERE tailor_id = ?", [tailor_id])
    conn.close()
    return {"tailor_id": tailor_id, "status": "deleted"}


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
        # Google/Meta expect one <g:additional_image_link> tag per extra
        # photo (up to 10) — the value is stored as a comma-separated list.
        additional_images = [u.strip() for u in (p.get("additional_image_link") or "").split(",") if u.strip()]
        additional_image_tags = "\n      ".join(
            f"<g:additional_image_link>{esc(u)}</g:additional_image_link>" for u in additional_images[:10]
        )
        xml_items.append(f"""
    <item>
      <g:id>{esc(p.get('sku') or p['product_id'])}</g:id>
      <title>{esc(p['name'])}</title>
      <description>{esc(p.get('description') or p['name'])}</description>
      <link>{esc(link)}</link>
      <g:image_link>{esc(image)}</g:image_link>
      {additional_image_tags}
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
        "id", "title", "description", "link", "image_link", "additional_image_link",
        "availability", "price", "sale_price", "brand", "condition", "gtin", "mpn",
        "google_product_category", "product_type", "color", "size", "gender",
        "age_group", "item_group_id",
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
            p.get("additional_image_link") or "",
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
    "color", "size", "gender", "age_group", "item_group_id", "material", "tailor",
    "features",
]
PRODUCT_JSON_FIELDS = {"features"}

def product_values(product: "Product"):
    values = []
    for f in PRODUCT_FIELDS:
        v = getattr(product, f)
        if f in PRODUCT_JSON_FIELDS and v is not None:
            v = json.dumps([item.dict() for item in v])
        values.append(v)
    return values


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
           (order_id, created_at, customer_name, phone, email, address, address_line2, city,
            postal_code, state, country, payment_method, notes, items, subtotal, shipping_fee,
            total, currency, status, customer_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)""",
        [order_id, datetime.now(), order.customer_name, order.phone, order.email,
         order.address, order.address_line2, order.city, order.postal_code, order.state, order.country,
         order.payment_method, order.notes,
         json.dumps([i.dict() for i in order.items]), order.subtotal,
         order.shipping_fee, order.total, order.currency,
         customer["customer_id"] if customer else None],
    )
    conn.close()
    order_user_id = customer["email"] if customer else (order.email or order.phone)
    rs_track(order_user_id, "Order Completed",
              dict({
                  "order_id": order_id,
                  "currency": order.currency,
                  "revenue": order.total,
                  "subtotal": order.subtotal,
                  "shipping": order.shipping_fee,
                  "payment_method": order.payment_method,
                  "city": order.city,
                  "postal_code": order.postal_code,
                  "country": order.country,
                  "products": [
                      {"product_id": i.id, "name": i.name, "brand": i.brand, "price": i.price, "quantity": i.qty}
                      for i in order.items
                  ],
              }, **flatten_attribution(order.attribution)),
              anonymous_id=order.anonymous_id)
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
    rs_track(customer["email"], "Live Comment Posted", {"comment_id": comment_id})
    return {"comment_id": comment_id, "status": "posted"}


# ================= RUDDERSTACK WEBHOOK -> MOTHERDUCK =================
# Add this as a "Webhook" destination in RudderStack, pointed at
# https://<your-domain>/api/rudder-webhook, and connect your JS + Python
# sources to it the same way you connected them to any other destination.
#
# Security: RudderStack's Webhook destination lets you add custom headers
# to every request it sends. Set WEBHOOK_SHARED_SECRET below (as a Vercel
# env var) and add a matching header in RudderStack's destination config
# (Header name: X-Webhook-Secret, Value: the same secret) so random
# internet traffic can't write fake rows into your database. If the env
# var is left unset, the check is skipped — fine for initial testing, but
# set it before relying on this for real.
WEBHOOK_SHARED_SECRET = os.environ.get("WEBHOOK_SHARED_SECRET", "")

def _event_name(raw: dict) -> str | None:
    # track calls have "event"; page/screen calls use their "name" (or
    # fall back to "type"); identify/alias/group have neither.
    return raw.get("event") or raw.get("name") or raw.get("type")

@app.post("/api/rudder-webhook")
async def rudder_webhook(request: Request, x_webhook_secret: str | None = Header(default=None)):
    if WEBHOOK_SHARED_SECRET and x_webhook_secret != WEBHOOK_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    body = await request.json()
    # RudderStack's Webhook destination sends one event per request by
    # default, but this also accepts a list just in case that's ever
    # changed in the destination config (e.g. batching enabled).
    events = body if isinstance(body, list) else [body]

    conn = get_conn()
    inserted = 0
    for raw in events:
        if not isinstance(raw, dict):
            continue
        event_id = raw.get("messageId") or ("evt-" + uuid.uuid4().hex[:12])
        received_at = raw.get("originalTimestamp") or raw.get("timestamp") or datetime.now().isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO analytics_events VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                event_id,
                received_at,
                _event_name(raw),
                raw.get("type"),
                raw.get("userId"),
                raw.get("anonymousId"),
                json.dumps(raw),
            ],
        )
        inserted += 1
    conn.close()
    return {"status": "received", "events_stored": inserted}


# ================= FIND MY FABRIC QUIZ — lead capture =================
class QuizLead(BaseModel):
    email: str
    age_band: str | None = None
    occasion: str | None = None
    activity: str | None = None
    care: str | None = None
    recommended: str | None = None
    anonymous_id: str | None = None

@app.post("/api/quiz-leads")
def create_quiz_lead(lead: QuizLead):
    lead_id = "quiz-" + uuid.uuid4().hex[:10]
    conn = get_conn()
    conn.execute(
        "INSERT INTO quiz_leads VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [lead_id, datetime.now(), lead.email, lead.age_band, lead.occasion,
         lead.activity, lead.care, lead.recommended],
    )
    conn.close()
    rs_identify(lead.email, {"email": lead.email, "quiz_age_band": lead.age_band}, anonymous_id=lead.anonymous_id)
    rs_track(lead.email, "Fabric Quiz Completed", {
        "age_band": lead.age_band, "occasion": lead.occasion,
        "activity": lead.activity, "care": lead.care, "recommended": lead.recommended,
    }, anonymous_id=lead.anonymous_id)
    return {"lead_id": lead_id, "status": "received"}
