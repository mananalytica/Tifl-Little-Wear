"""
Tifl Little Wear — local booking API
=====================================
A tiny local service that the booking form in index.html talks to.
It writes every booking straight into a DuckDB file on your machine.

Why this exists: a browser can't open a DuckDB file directly (no
database driver runs inside JavaScript in the page for security
reasons), so the page sends each booking as JSON to this API, and
this API is the thing that actually writes the row into DuckDB.

SETUP
-----
1. pip install fastapi uvicorn duckdb
2. python server.py
   -> starts on http://localhost:8787
3. Open index.html (double-click it, or serve it with any static
   file server) and submit the booking form — rows will land in
   tifl_bookings.duckdb in this folder.

Inspect your data any time with:
   python -c "import duckdb; print(duckdb.connect('tifl_bookings.duckdb').sql('select * from bookings').df())"
"""

from datetime import datetime
import json
import uuid

import duckdb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

DB_PATH = "tifl_bookings.duckdb"

app = FastAPI(title="Tifl Little Wear — Booking API")

# Allow the static HTML file (opened from file:// or any localhost
# port) to call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    conn = duckdb.connect(DB_PATH)
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
            address         VARCHAR,
            notes           VARCHAR,
            measurements    JSON
        )
        """
    )
    return conn


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
    address: str | None = None
    notes: str | None = None
    measurements: Measurements | None = None


@app.post("/api/bookings")
def create_booking(booking: Booking):
    booking_id = "TLW-" + uuid.uuid4().hex[:8].upper()
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            booking.address,
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


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)
