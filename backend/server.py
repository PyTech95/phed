from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Query, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, Response, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from bson import ObjectId
import aiofiles
import csv
import io
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
import json
import httpx
from urllib.parse import quote, unquote
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfgen import canvas
from PIL import Image as PILImage, ImageDraw, ImageFont
import tempfile
import fitz  # PyMuPDF for PDF processing
import re
import math
import base64
import asyncio
from functools import lru_cache
import time
from contextvars import ContextVar

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from hardening import (  # noqa: E402
    require_env, env_flag, setup_logging, limiter, RequestGuardMiddleware,
    unhandled_exception_handler, assert_public_http_url,
)
from slowapi.errors import RateLimitExceeded  # noqa: E402
from slowapi import _rate_limit_exceeded_handler  # noqa: E402
import ward_master  # noqa: E402

setup_logging()
IS_PROD = os.environ.get('ENV', 'production').lower() == 'production'

# ============== SIMPLE IN-MEMORY CACHE ==============
class SimpleCache:
    def __init__(self, ttl_seconds=60):
        self.cache: Dict[str, Any] = {}
        self.timestamps: Dict[str, float] = {}
        self.ttl = ttl_seconds
    
    def get(self, key: str):
        if key in self.cache:
            if time.time() - self.timestamps[key] < self.ttl:
                return self.cache[key]
            else:
                del self.cache[key]
                del self.timestamps[key]
        return None
    
    def set(self, key: str, value: Any):
        self.cache[key] = value
        self.timestamps[key] = time.time()
    
    def clear(self):
        self.cache.clear()
        self.timestamps.clear()

# Cache instances (60 second TTL for map data)
map_cache = SimpleCache(ttl_seconds=60)
colonies_cache = SimpleCache(ttl_seconds=300)  # 5 minutes for colonies list

# ============== MULTI-TENANT DATABASE SETUP ==============
# MongoDB connection with optimized settings for performance
mongo_url = require_env('MONGO_URL')
APP_DB_NAME = require_env('DB_NAME')
client = AsyncIOMotorClient(
    mongo_url,
    maxPoolSize=50,
    minPoolSize=10,
    maxIdleTimeMS=30000,
    serverSelectionTimeoutMS=5000
)

# Master DB - Global (users, towns, access control)
MASTER_DB_NAME = os.environ.get('MASTER_DB_NAME') or APP_DB_NAME
master_db = client[MASTER_DB_NAME]

# Legacy DB support (for backward compatibility during migration)
db = client[APP_DB_NAME]

# Town DB cache
_town_db_cache: Dict[str, Any] = {}

# Special mapping for existing towns to their databases
# Uses DB_NAME from .env (nstu_property_tax on VPS, test_database in dev)
TOWN_DB_MAPPING = {
    "THS": APP_DB_NAME,
}

# Town data location: "single" keeps every town inside DB_NAME as prefixed collections
# (works with a least-privilege Mongo user); "multi" is the legacy one-database-per-town layout.
TOWN_DB_MODE = os.environ.get('TOWN_DB_MODE', 'single').lower()
if TOWN_DB_MODE not in ('single', 'multi'):
    raise RuntimeError("TOWN_DB_MODE must be 'single' or 'multi'")

class TownNamespace:
    """Town collections inside the main DB with a per-town prefix (single-database mode)."""
    def __init__(self, base, prefix: str):
        self._base = base
        self.prefix = prefix
        self.name = f"{base.name}[{prefix}]"

    def __getattr__(self, name: str):
        if name.startswith('_'):
            raise AttributeError(name)
        return self._base[f"{self.prefix}{name}"]

    def __getitem__(self, name: str):
        return self._base[f"{self.prefix}{name}"]

def get_town_db(town_code: str):
    """Get Town-specific data handle (real DB in multi mode, prefixed namespace in single mode)."""
    if town_code in _town_db_cache:
        return _town_db_cache[town_code]
    
    if town_code.upper() in TOWN_DB_MAPPING:
        town_db = client[TOWN_DB_MAPPING[town_code.upper()]]
    elif TOWN_DB_MODE == 'single':
        town_db = TownNamespace(db, f"town_{town_code.lower()}__")
    else:
        town_db = client[f"nstu_town_{town_code.lower()}"]
    _town_db_cache[town_code] = town_db
    return town_db

def get_town_gridfs(town_code: str):
    """Get GridFS bucket for town-specific file storage"""
    town_db = get_town_db(town_code)
    if isinstance(town_db, TownNamespace):
        return AsyncIOMotorGridFSBucket(db, bucket_name=f"{town_db.prefix}fs")
    return AsyncIOMotorGridFSBucket(town_db)

# GridFS cache per town to avoid recreation on every request
_town_fs_cache: Dict[str, Any] = {}

def get_town_gridfs_cached(town_code: str):
    """Get cached GridFS bucket for town"""
    if town_code not in _town_fs_cache:
        _town_fs_cache[town_code] = get_town_gridfs(town_code)
    return _town_fs_cache[town_code]

# GridFS for file storage in database (legacy)
fs_bucket = AsyncIOMotorGridFSBucket(db)

# ============== MULTI-TENANT CONTEXT VAR ==============
# ContextVar stores the current request's town database per-async-task
_current_town_db: ContextVar = ContextVar('current_town_db', default=None)
_current_town_fs: ContextVar = ContextVar('current_town_fs', default=None)
_current_town_code: ContextVar = ContextVar('current_town_code', default=None)

def get_db():
    """Get the current request's town-scoped database.
    Set by the town_context_middleware. Falls back to legacy db."""
    val = _current_town_db.get()
    return val if val is not None else db

def get_fs():
    """Get the current request's town-scoped GridFS bucket."""
    val = _current_town_fs.get()
    return val if val is not None else fs_bucket

def get_current_town_code():
    """Get the current request's town code."""
    return _current_town_code.get() or "THS"

# ============== MULTI-TENANT HELPER FUNCTIONS ==============
async def get_town_data_db(request: Request):
    """FastAPI dependency: resolve the town-scoped database from request headers."""
    town_code = request.headers.get("x-town-code")
    if town_code:
        return get_town_db(town_code)
    return db

async def get_town_fs_dep(request: Request):
    """FastAPI dependency: resolve the town-scoped GridFS from request headers."""
    town_code = request.headers.get("x-town-code")
    if town_code:
        return get_town_gridfs(town_code)
    return fs_bucket

# ============== DATABASE INDEXES FOR PERFORMANCE ==============
async def create_town_indexes(town_db):
    """Create MongoDB indexes for Town-specific DB"""
    try:
        # Properties collection indexes (Town DB)
        await town_db.properties.create_index("id", unique=True, background=True)
        await town_db.properties.create_index("batch_id", background=True)
        await town_db.properties.create_index("ward", background=True)
        await town_db.properties.create_index("colony", background=True)
        await town_db.properties.create_index("status", background=True)
        await town_db.properties.create_index("assigned_employee_id", background=True)
        await town_db.properties.create_index("assigned_employee_ids", background=True)
        await town_db.properties.create_index([("latitude", 1), ("longitude", 1)], background=True)
        await town_db.properties.create_index("serial_number", background=True)
        await town_db.properties.create_index("bill_sr_no", background=True)
        await town_db.properties.create_index("property_id", background=True)
        # Compound indexes for common query patterns
        await town_db.properties.create_index([("ward", 1), ("status", 1)], background=True)
        await town_db.properties.create_index([("assigned_employee_id", 1), ("status", 1)], background=True)
        await town_db.properties.create_index([("assigned_employee_id", 1), ("status", 1), ("serial_number", 1)], background=True)
        # Index for $or queries on assigned employee fields
        await town_db.properties.create_index([("assigned_employee_ids", 1), ("status", 1)], background=True)
        # Index for colony distinct queries
        await town_db.properties.create_index("colony", background=True)
        
        # Submissions collection indexes (Town DB)
        await town_db.submissions.create_index("id", unique=True, background=True)
        await town_db.submissions.create_index("property_record_id", background=True)
        await town_db.submissions.create_index("employee_id", background=True)
        await town_db.submissions.create_index("status", background=True)
        await town_db.submissions.create_index("submitted_at", background=True)
        await town_db.submissions.create_index([("employee_id", 1), ("submitted_at", -1)], background=True)
        await town_db.submissions.create_index([("employee_id", 1), ("status", 1), ("submitted_at", -1)], background=True)
        
        from phed import ensure_indexes as phed_ensure_indexes
        await phed_ensure_indexes(town_db)

        # Bills collection indexes (Town DB)
        await town_db.bills.create_index("id", unique=True, background=True)
        await town_db.bills.create_index("colony", background=True)
        await town_db.bills.create_index("bill_sr_no", background=True)
        await town_db.bills.create_index("property_id", background=True)
        await town_db.bills.create_index([("colony", 1), ("serial_na", 1)], background=True)
        await town_db.bills.create_index([("colony", 1), ("self_certified", 1)], background=True)
        
        # Attendance collection indexes (Town DB)
        await town_db.attendance.create_index("employee_id", background=True)
        await town_db.attendance.create_index("date", background=True)
        await town_db.attendance.create_index([("employee_id", 1), ("date", 1)], unique=True, background=True)
        
        # Batches collection (Town DB)
        await town_db.batches.create_index("id", unique=True, background=True)
        await town_db.batches.create_index("status", background=True)
        
        # Generated PDFs collection (Town DB)
        await town_db.generated_pdfs.create_index("id", unique=True, background=True)
        await town_db.generated_pdfs.create_index("colony", background=True)
        await town_db.generated_pdfs.create_index("created_at", background=True)
        await town_db.generated_pdfs.create_index("pdf_type", background=True)
        
        # Permanent property_photos collection (never deleted on bill re-upload)
        await town_db.property_photos.create_index("property_id", unique=True, background=True)
        
        logging.info("Town DB indexes created successfully")
    except Exception as e:
        logging.warning(f"Town DB index creation warning (may already exist): {e}")

async def create_indexes():
    """Create MongoDB indexes for faster queries"""
    try:
        # ========== MASTER DB INDEXES ==========
        # Users collection (global)
        await master_db.users.create_index("id", unique=True, background=True)
        await master_db.users.create_index("username", unique=True, background=True)
        await master_db.users.create_index("role", background=True)
        
        # Towns collection
        await master_db.towns.create_index("id", unique=True, background=True)
        await master_db.towns.create_index("code", unique=True, background=True)
        await master_db.towns.create_index("is_active", background=True)
        
        # User Town Access (which user can access which towns)
        await master_db.user_town_access.create_index("user_id", background=True)
        await master_db.user_town_access.create_index("town_id", background=True)
        await master_db.user_town_access.create_index([("user_id", 1), ("town_id", 1)], unique=True, background=True)
        
        # Audit logs
        await master_db.audit_login.create_index("user_id", background=True)
        await master_db.audit_login.create_index("timestamp", background=True)
        await master_db.audit_town_switch.create_index("user_id", background=True)
        await master_db.audit_town_switch.create_index("timestamp", background=True)
        
        print("✅ Master DB indexes created successfully")
        
        # ========== LEGACY DB INDEXES (for backward compatibility) ==========
        # Properties collection indexes
        await get_db().properties.create_index("id", unique=True, background=True)
        await get_db().properties.create_index("batch_id", background=True)
        await get_db().properties.create_index("ward", background=True)
        await get_db().properties.create_index("colony", background=True)
        await get_db().properties.create_index("town", background=True)
        await get_db().properties.create_index("status", background=True)
        await get_db().properties.create_index("assigned_employee_id", background=True)
        await get_db().properties.create_index("assigned_employee_ids", background=True)
        await get_db().properties.create_index([("latitude", 1), ("longitude", 1)], background=True)
        await get_db().properties.create_index("serial_number", background=True)
        await get_db().properties.create_index("bill_sr_no", background=True)
        await get_db().properties.create_index("property_id", background=True)
        await get_db().properties.create_index([("ward", 1), ("status", 1)], background=True)
        await get_db().properties.create_index([("town", 1), ("status", 1)], background=True)
        await get_db().properties.create_index([("assigned_employee_id", 1), ("status", 1)], background=True)
        await get_db().properties.create_index([("assigned_employee_id", 1), ("status", 1), ("serial_number", 1)], background=True)
        
        # Users collection indexes (legacy)
        await master_db.users.create_index("id", unique=True, background=True)
        await master_db.users.create_index("username", unique=True, background=True)
        await master_db.users.create_index("role", background=True)
        await master_db.users.create_index("assigned_town", background=True)
        
        # Submissions collection indexes
        await get_db().submissions.create_index("id", unique=True, background=True)
        await get_db().submissions.create_index("property_record_id", background=True)
        await get_db().submissions.create_index("employee_id", background=True)
        await get_db().submissions.create_index("status", background=True)
        await get_db().submissions.create_index("submitted_at", background=True)
        await get_db().submissions.create_index("town", background=True)
        await get_db().submissions.create_index([("employee_id", 1), ("submitted_at", -1)], background=True)
        await get_db().submissions.create_index([("status", 1), ("submitted_at", -1)], background=True)
        await get_db().submissions.create_index([("submitted_at", -1)], background=True)
        
        # Bills collection indexes
        await get_db().bills.create_index("id", unique=True, background=True)
        await get_db().bills.create_index("colony", background=True)
        await get_db().bills.create_index("bill_sr_no", background=True)
        await get_db().bills.create_index("town", background=True)
        
        # Attendance collection indexes
        await get_db().attendance.create_index("employee_id", background=True)
        await get_db().attendance.create_index("date", background=True)
        await get_db().attendance.create_index("town", background=True)
        
        print("✅ Legacy DB indexes created successfully")
        
    except Exception as e:
        logging.warning(f"Database index creation warning (may already exist): {e}")

# JWT Configuration
JWT_SECRET = require_env('JWT_SECRET')
if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be at least 32 characters")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.environ.get('ACCESS_TOKEN_MINUTES', '60'))
REFRESH_TOKEN_DAYS = int(os.environ.get('REFRESH_TOKEN_DAYS', '7'))
CORS_ORIGINS = [o.strip() for o in require_env('CORS_ORIGINS').split(',') if o.strip()]
if IS_PROD and '*' in CORS_ORIGINS:
    logging.getLogger("app").warning(
        "CORS_ORIGINS is '*' in production; allowed for same-origin Emergent hosting"
    )
LOGIN_MAX_FAILURES = 5
LOGIN_LOCKOUT_MINUTES = 15
SURVEY_RADIUS_METERS = float(os.environ.get('SURVEY_RADIUS_METERS', '50'))  # geofence for surveyors with gps_radius_required

# Create uploads directory (for backward compatibility and temp files)
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Durable storage for generated/uploaded files: local dir is only a cache, GridFS is the source of truth
_uploads_fs = AsyncIOMotorGridFSBucket(master_db, bucket_name="uploads")

async def persist_upload(filename: str):
    path = UPLOAD_DIR / filename
    if not path.exists():
        return
    async for old in _uploads_fs.find({"filename": filename}):
        await _uploads_fs.delete(old._id)
    async with aiofiles.open(str(path), 'rb') as fh:
        content = await fh.read()
    await _uploads_fs.upload_from_stream(filename, content)

async def ensure_upload_local(filename: str) -> Path:
    path = UPLOAD_DIR / filename
    if path.exists():
        return path
    try:
        grid_out = await _uploads_fs.open_download_stream_by_name(filename)
        content = await grid_out.read()
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(str(path), 'wb') as fh:
            await fh.write(content)
    except Exception:
        pass
    return path

async def delete_upload(filename: str):
    path = UPLOAD_DIR / filename
    if path.exists():
        path.unlink()
    async for old in _uploads_fs.find({"filename": filename}):
        await _uploads_fs.delete(old._id)

# Create the main app with increased body size limit for file uploads
ENABLE_DOCS = env_flag('ENABLE_DOCS', False)
app = FastAPI(
    title="PHED Survey & Notice Distribution",
    docs_url="/api/docs" if ENABLE_DOCS else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if ENABLE_DOCS else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)
app.add_middleware(RequestGuardMiddleware)

# Town context middleware - sets the correct DB per request based on X-Town-Code header
@app.middleware("http")
async def town_context_middleware(request: Request, call_next):
    town_code = request.headers.get("x-town-code")
    if town_code:
        _current_town_db.set(get_town_db(town_code))
        _current_town_fs.set(get_town_gridfs_cached(town_code))
        _current_town_code.set(town_code)
    else:
        _current_town_db.set(db)
        _current_town_fs.set(fs_bucket)
        _current_town_code.set("THS")
    response = await call_next(request)
    return response

# Add GZip compression for faster responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Startup event to create indexes
@app.on_event("startup")
async def startup_event():
    await create_indexes()
    await master_db.login_attempts.create_index("identifier", background=True)
    await master_db.login_attempts.create_index("expires_at", expireAfterSeconds=0, background=True)
    await master_db.audit_log.create_index([("timestamp", -1)], background=True)
    await master_db.audit_log.create_index("actor_id", background=True)
    await master_db.audit_log.create_index("action", background=True)
    await master_db.audit_log.create_index("target_id", background=True)
    await seed_defaults()
    logging.info("Application started with optimized database indexes")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

@api_router.get("/health")
async def health_check():
    try:
        await client.admin.command("ping")
        return {"status": "ok", "db": "connected", "env": os.environ.get('ENV', 'production').lower(), "town_db_mode": TOWN_DB_MODE}
    except Exception as e:
        logging.getLogger("app").error(f"health check db failure: {e}")
        raise HTTPException(status_code=503, detail="db unavailable")

# ============== GRIDFS HELPER FUNCTIONS ==============

async def save_file_to_gridfs(file_content: bytes, filename: str, content_type: str = "application/octet-stream") -> str:
    """Save file to MongoDB GridFS and return file_id"""
    file_id = await get_fs().upload_from_stream(
        filename,
        file_content,
        metadata={"content_type": content_type, "uploaded_at": datetime.now(timezone.utc).isoformat()}
    )
    return str(file_id)

def make_file_url(file_id: str) -> str:
    """Create a file URL that includes town code for cross-town access"""
    town_code = get_current_town_code()
    return f"/api/file/{town_code}/{file_id}"

async def get_file_from_gridfs(file_id: str) -> tuple:
    """Get file from GridFS by file_id, returns (content, filename, content_type)"""
    try:
        grid_out = await get_fs().open_download_stream(ObjectId(file_id))
        content = await grid_out.read()
        filename = grid_out.filename
        content_type = grid_out.metadata.get("content_type", "application/octet-stream") if grid_out.metadata else "application/octet-stream"
        return content, filename, content_type
    except Exception:
        return None, None, None

async def delete_file_from_gridfs(file_id: str) -> bool:
    """Delete file from GridFS"""
    try:
        await get_fs().delete(ObjectId(file_id))
        return True
    except Exception:
        return False

# ============== FILE SERVE ENDPOINTS ==============

@api_router.get("/file/{town_code}/{file_id}")
async def serve_file_with_town(town_code: str, file_id: str):
    """Serve file from town-specific GridFS by town_code and file_id"""
    try:
        town_fs = get_town_gridfs(town_code)
        grid_out = await town_fs.open_download_stream(ObjectId(file_id))
        content = await grid_out.read()
        filename = grid_out.filename
        content_type = grid_out.metadata.get("content_type", "application/octet-stream") if grid_out.metadata else "application/octet-stream"
        
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "public, max-age=86400"
            }
        )
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

@api_router.get("/file/{file_id}")
async def serve_file(file_id: str):
    """Serve file from GridFS - searches current town DB then all towns"""
    try:
        # Try current context DB first
        content, filename, content_type = await get_file_from_gridfs(file_id)
        if content is not None:
            return Response(
                content=content,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "Cache-Control": "public, max-age=86400"
                }
            )
        
        # Fallback: search all town databases
        towns = await master_db.towns.find({}, {"_id": 0, "code": 1}).to_list(50)
        for town in towns:
            try:
                town_fs = get_town_gridfs(town["code"])
                grid_out = await town_fs.open_download_stream(ObjectId(file_id))
                content = await grid_out.read()
                filename = grid_out.filename
                content_type = grid_out.metadata.get("content_type", "application/octet-stream") if grid_out.metadata else "application/octet-stream"
                return Response(
                    content=content,
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f'inline; filename="{filename}"',
                        "Cache-Control": "public, max-age=86400"
                    }
                )
            except Exception:
                continue
        
        raise HTTPException(status_code=404, detail="File not found in any town database")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

# Legacy endpoint for backward compatibility with old /api/uploads/ URLs
@api_router.get("/uploads/{filename}")
async def serve_legacy_upload(filename: str):
    """Serve legacy files from UPLOAD_DIR for backward compatibility"""
    file_path = await ensure_upload_local(filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine content type
    suffix = file_path.suffix.lower()
    content_types = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    content_type = content_types.get(suffix, 'application/octet-stream')
    
    return FileResponse(
        path=str(file_path),
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"}
    )

@api_router.get("/proxy-image")
async def proxy_image(url: str):
    """Proxy external image URLs through app domain"""
    decoded_url = unquote(url)
    assert_public_http_url(decoded_url)
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, max_redirects=0) as http_client:
            resp = await http_client.get(decoded_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch image")
            content_type = resp.headers.get("content-type", "image/jpeg")
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Not an image")
            if len(resp.content) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Image too large")
            return Response(content=resp.content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Failed to fetch external image")


# ============== MODELS ==============

# Role options: ADMIN, SURVEYOR, SUPERVISOR, MC_OFFICER
# Permission options for SUPERVISOR and MC_OFFICER
AVAILABLE_PERMISSIONS = [
    "dashboard",      # View dashboard
    "bills",          # View/manage bills
    "properties",     # View properties
    "map",            # View property map
    "submissions",    # View submissions
    "approve",        # Approve/reject submissions
    "employees",      # View employees
    "attendance",     # View attendance
    "export",         # Export data
    "upload"          # Upload data
]

# ============== TOWN MODELS ==============
class TownCreate(BaseModel):
    name: str
    code: str  # Short code like "THS", "LDW", "PHW"
    description: Optional[str] = None
    is_active: bool = True

class TownUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    name: str
    role: str = "SURVEYOR"  # ADMIN, SURVEYOR, SUPERVISOR, MC_OFFICER
    assigned_area: Optional[str] = None
    assigned_town: Optional[str] = None  # Town ID assigned to user
    authority: Optional[str] = None  # For SUPERVISOR and MC_OFFICER roles
    permissions: Optional[List[str]] = None  # For SUPERVISOR and MC_OFFICER roles
    gps_radius_required: bool = True  # SURVEYOR: must be within SURVEY_RADIUS_METERS of the property to submit

class UserLogin(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    selected_town: Optional[str] = None  # Town selected at login

class RefreshRequest(BaseModel):
    refresh_token: str

class UserResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    assigned_area: Optional[str] = None
    assigned_town: Optional[str] = None
    authority: Optional[str] = None
    permissions: Optional[List[str]] = None
    gps_radius_required: Optional[bool] = True
    created_at: str

class TokenResponse(BaseModel):
    token: str
    refresh_token: Optional[str] = None
    user: UserResponse
    selected_town: Optional[dict] = None
    accessible_towns: Optional[List[dict]] = None

class DatasetBatchCreate(BaseModel):
    name: str

class DatasetBatchResponse(BaseModel):
    id: str
    name: str
    uploaded_by: str
    uploaded_at: str
    status: str
    total_records: int

class PropertyResponse(BaseModel):
    id: str
    batch_id: str
    property_id: str
    owner_name: str
    mobile: str
    address: str
    total_area: Optional[str] = None
    amount: Optional[str] = None
    ward: Optional[str] = None
    assigned_employee_id: Optional[str] = None
    assigned_employee_name: Optional[str] = None
    status: str
    created_at: str

class AssignmentRequest(BaseModel):
    property_ids: List[str]
    employee_id: Optional[str] = None  # Single employee (backward compat)
    employee_ids: Optional[List[str]] = None  # Multiple employees (work together)

class BulkAssignmentRequest(BaseModel):
    area: str
    employee_id: Optional[str] = None  # Single employee (backward compat)
    employee_ids: Optional[List[str]] = None  # Multiple employees (work together)
    custom_distribution: Optional[Dict[str, int]] = None  # {employee_id: count} for custom distribution
    serial_from: Optional[int] = None  # Range assignment: start serial number
    serial_to: Optional[int] = None    # Range assignment: end serial number

class BulkUnassignRequest(BaseModel):
    area: str
    employee_id: Optional[str] = None  # If provided, only unassign this employee from area

class SubmissionApproval(BaseModel):
    submission_id: str
    action: str  # APPROVE or REJECT
    remarks: Optional[str] = None

class DashboardStats(BaseModel):
    total_properties: int
    completed: int
    pending: int
    in_progress: int
    rejected: int
    employees: int
    batches: int
    today_completed: int
    today_wards: int

class EmployeeProgress(BaseModel):
    employee_id: str
    employee_name: str
    role: str
    total_assigned: int
    completed: int
    pending: int
    today_completed: int
    overall_completed: int

# ============== HELPER FUNCTIONS ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "type": "refresh",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        token = authorization
        if token.startswith("Bearer "):
            token = token[7:]
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await master_db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Non-admin users may only act inside their assigned town
    if user.get("role") != "ADMIN" and user.get("assigned_town"):
        town = await master_db.towns.find_one({"id": user["assigned_town"]}, {"_id": 0, "code": 1})
        if town and town.get("code") and get_current_town_code().upper() != town["code"].upper():
            raise HTTPException(status_code=403, detail="Access to this town is not permitted")
    return user

def _client_ip_of(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

async def _check_lockout(identifier: str):
    rec = await master_db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= LOGIN_MAX_FAILURES and rec.get("expires_at"):
        expires = rec["expires_at"]
        # Mongo can return tz-naive datetimes; normalize to UTC for safe comparison.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")

async def _record_failure(identifier: str):
    await master_db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)}},
        upsert=True,
    )

def get_today_start():
    """Get the start of today in UTC"""
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)

# ============== ADMIN AUDIT TRAIL ==============

async def record_audit(actor: dict, action: str, target_type: str, target_id: Optional[str],
                       details: Optional[dict] = None, request: Optional[Request] = None):
    """Append-only trail of who changed what, when (users, towns, approvals)."""
    await master_db.audit_log.insert_one({
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor_id": actor.get("id"),
        "actor_username": actor.get("username"),
        "actor_name": actor.get("name"),
        "actor_role": actor.get("role"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "town_code": get_current_town_code(),
        "details": details or {},
        "ip_address": _client_ip_of(request) if request else None,
        "request_id": getattr(request.state, "request_id", None) if request else None,
    })

def _safe_user_fields(u: dict) -> dict:
    return {k: u.get(k) for k in ("username", "name", "role", "assigned_area", "assigned_town", "authority", "permissions")}

# ============== AUTH ROUTES ==============

@api_router.post("/auth/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, data: UserLogin):
    ip = _client_ip_of(request)
    identifier = f"{ip}:{data.username.lower()}"
    await _check_lockout(identifier)

    user = await master_db.users.find_one({"username": data.username}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        await _record_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await master_db.login_attempts.delete_one({"identifier": identifier})
    
    # Log login audit
    await master_db.audit_login.insert_one({
        "user_id": user["id"],
        "username": user["username"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ip_address": ip
    })
    
    token = create_token(user["id"], user["role"])
    refresh_token = create_refresh_token(user["id"])
    
    # Get user's accessible towns
    user_towns = []
    if user["role"] == "ADMIN":
        # Admin can access all active towns
        towns = await master_db.towns.find({"is_active": True}, {"_id": 0}).to_list(None)
        user_towns = towns
    else:
        # Other users only access assigned town
        assigned_town = user.get("assigned_town")
        if assigned_town:
            town = await master_db.towns.find_one({"id": assigned_town, "is_active": True}, {"_id": 0})
            if town:
                user_towns = [town]
    
    return {
        "token": token,
        "refresh_token": refresh_token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "role": user["role"],
            "assigned_area": user.get("assigned_area"),
            "assigned_town": user.get("assigned_town"),
            "authority": user.get("authority"),
            "permissions": user.get("permissions"),
            "gps_radius_required": user.get("gps_radius_required", True),
            "created_at": user["created_at"]
        },
        "accessible_towns": user_towns
    }

@api_router.post("/auth/refresh")
@limiter.limit("30/minute")
async def refresh_access_token(request: Request, data: RefreshRequest):
    try:
        payload = jwt.decode(data.refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await master_db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "id": 1, "role": 1})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {"token": create_token(user["id"], user["role"])}

@api_router.get("/admin/audit-log")
async def list_audit_log(
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    query: Dict[str, Any] = {}
    if action:
        query["action"] = action
    if actor_id:
        query["actor_id"] = actor_id
    if target_type:
        query["target_type"] = target_type
    if target_id:
        query["target_id"] = target_id
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"actor_username": rx}, {"actor_name": rx}, {"target_id": rx}, {"details.username": rx},
                        {"details.before.username": rx}, {"details.after.username": rx}, {"details.code": rx}, {"details.after.code": rx}]
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to + "T23:59:59.999999+00:00"
        query["timestamp"] = rng
    total = await master_db.audit_log.count_documents(query)
    items = await master_db.audit_log.find(query, {"_id": 0}).sort("timestamp", -1).skip((page - 1) * limit).limit(limit).to_list(None)
    actions = await master_db.audit_log.distinct("action")
    return {"logs": items, "total": total, "page": page, "limit": limit, "actions": sorted(actions)}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    # Get user's custom permissions from DB
    user_permissions = current_user.get("permissions") or []
    role = current_user["role"]
    
    # For Admin, grant all permissions
    if role == "ADMIN":
        user_permissions = AVAILABLE_PERMISSIONS.copy()
    
    # Build permissions object - check both role-based and custom permissions
    permissions = {
        "can_upload": role in UPLOAD_ROLES or "upload" in user_permissions,
        "can_export": role in EXPORT_ROLES or "export" in user_permissions,
        "can_edit_submissions": role in SUBMISSION_EDIT_ROLES or "approve" in user_permissions,
        "can_manage_users": role == "ADMIN",
        "can_download_performance": role in PERFORMANCE_DOWNLOAD_ROLES or "export" in user_permissions,
        "can_view_employees": role in ["ADMIN", "MC_OFFICER"] or "employees" in user_permissions,
        "can_view_attendance": role in ["ADMIN", "MC_OFFICER"] or "attendance" in user_permissions,
        "can_approve_reject": role == "ADMIN" or "approve" in user_permissions,
        # New granular permissions
        "can_view_dashboard": role == "ADMIN" or "dashboard" in user_permissions,
        "can_view_bills": role == "ADMIN" or "bills" in user_permissions,
        "can_view_properties": role == "ADMIN" or "properties" in user_permissions,
        "can_view_map": role == "ADMIN" or "map" in user_permissions,
        "can_view_submissions": role == "ADMIN" or "submissions" in user_permissions,
    }
    
    # Get user's accessible towns
    user_towns = []
    if role == "ADMIN":
        towns = await master_db.towns.find({"is_active": True}, {"_id": 0}).to_list(None)
        user_towns = towns
    else:
        assigned_town = current_user.get("assigned_town")
        if assigned_town:
            town = await master_db.towns.find_one({"id": assigned_town, "is_active": True}, {"_id": 0})
            if town:
                user_towns = [town]
    
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "name": current_user["name"],
        "role": current_user["role"],
        "assigned_area": current_user.get("assigned_area"),
        "assigned_town": current_user.get("assigned_town"),
        "authority": current_user.get("authority"),
        "permissions": permissions,
        "raw_permissions": user_permissions,
        "accessible_towns": user_towns,
        "gps_radius_required": current_user.get("gps_radius_required", True),
        "created_at": current_user["created_at"]
    }

# ============== FAST MAP ENDPOINTS (OPTIMIZED FOR 20+ CONCURRENT USERS) ==============

@api_router.get("/map/colonies")
async def get_colonies_list(request: Request, current_user: dict = Depends(get_current_user)):
    """Fast endpoint to get list of colonies - CACHED"""
    town_code = request.headers.get("x-town-code", "default")
    cache_key = f"colonies_list_{town_code}"
    cached = colonies_cache.get(cache_key)
    if cached:
        return cached
    
    town_db = await get_town_data_db(request)
    
    # Get unique colonies from properties
    pipeline = [
        {"$match": {"latitude": {"$ne": None}, "longitude": {"$ne": None}}},
        {"$group": {"_id": {"$ifNull": ["$colony", "$ward"]}, "count": {"$sum": 1}}},
        {"$match": {"_id": {"$ne": None}}},
        {"$sort": {"_id": 1}}
    ]
    
    result = await town_db.properties.aggregate(pipeline).to_list(None)
    colonies = [{"name": r["_id"], "count": r["count"]} for r in result if r["_id"]]
    total = sum(c["count"] for c in colonies)
    
    response = {"colonies": colonies, "total": total}
    colonies_cache.set(cache_key, response)
    return response

@api_router.get("/map/properties")
async def get_map_properties(
    colony: Optional[str] = None,
    status: Optional[str] = None,
    hide_completed: bool = False,
    limit: int = 5000,
    current_user: dict = Depends(get_current_user)
):
    """Fast endpoint for map markers with submission data for filtering"""
    
    query = {"latitude": {"$ne": None}, "longitude": {"$ne": None}}
    
    if colony and colony.strip():
        query["$or"] = [
            {"colony": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}},
            {"ward": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}}
        ]
    
    if status and status.strip():
        query["status"] = status
    
    if hide_completed:
        if "status" not in query:
            query["status"] = {"$nin": ["Completed", "Approved", "In Progress"]}
    
    if current_user["role"] not in ["ADMIN", "SUPERVISOR", "MC_OFFICER"]:
        if "$or" in query:
            query["$and"] = [
                {"$or": query.pop("$or")},
                {"$or": [
                    {"assigned_employee_id": current_user["id"]},
                    {"assigned_employee_ids": current_user["id"]}
                ]}
            ]
        else:
            query["$or"] = [
                {"assigned_employee_id": current_user["id"]},
                {"assigned_employee_ids": current_user["id"]}
            ]
    
    projection = {
        "_id": 0, "id": 1, "latitude": 1, "longitude": 1, "status": 1,
        "serial_number": 1, "bill_sr_no": 1, "property_id": 1,
        "owner_name": 1, "colony": 1, "ward": 1, "mobile": 1,
        "assigned_employee_id": 1, "assigned_employee_name": 1,
        "assigned_employee_ids": 1, "category": 1, "total_area": 1,
        "amount": 1, "address": 1, "photo_url": 1, "self_certified": 1,
        "polygon": 1, "polygon_centroid": 1, "phed_survey_status": 1, "phed_survey_type": 1,
        "phed_survey_state": 1, "phed_outcome": 1, "phed_surveyor_name": 1
    }
    
    properties = await get_db().properties.find(query, projection).limit(limit).to_list(limit)
    
    # Remove duplicates
    seen_property_ids = set()
    unique_properties = []
    for prop in properties:
        prop_id = prop.get("property_id", "")
        if prop_id and prop_id in seen_property_ids:
            continue
        if prop_id:
            seen_property_ids.add(prop_id)
        unique_properties.append(prop)
    
    # Enrich with submission data
    prop_ids = [p["id"] for p in unique_properties]
    if prop_ids:
        subs = await get_db().submissions.find(
            {"property_record_id": {"$in": prop_ids}},
            {"_id": 0, "property_record_id": 1, "house_status": 1, 
             "property_use": 1, "special_condition": 1, "self_satisfied": 1,
             "receiver_name": 1, "remarks": 1, "employee_name": 1,
             "property_status": 1, "submitted_at": 1, "status": 1}
        ).to_list(None)
        sub_map = {s["property_record_id"]: s for s in subs}
        
        for prop in unique_properties:
            sub = sub_map.get(prop["id"])
            if sub:
                prop["sub_house_status"] = sub.get("house_status", "")
                prop["sub_property_use"] = sub.get("property_use", "")
                prop["sub_special_condition"] = sub.get("special_condition", "")
                prop["sub_self_satisfied"] = sub.get("self_satisfied", True)
                prop["sub_receiver_name"] = sub.get("receiver_name", "")
                prop["sub_remarks"] = sub.get("remarks", "")
                prop["sub_employee_name"] = sub.get("employee_name", "")
                prop["sub_property_status"] = sub.get("property_status", "")
                prop["sub_submitted_at"] = sub.get("submitted_at", "")
                prop["sub_status"] = sub.get("status", "")
                prop["has_submission"] = True
            else:
                prop["has_submission"] = False

        phed_consumers = await get_db().phed_consumers.find(
            {"linked_property_id": {"$in": prop_ids}, "is_active": True},
            {
                "_id": 0,
                "id": 1,
                "linked_property_id": 1,
                "consumer_id": 1,
                "consumer_name": 1,
                "phone": 1,
                "source": 1,
            },
        ).to_list(None)
        phed_by_property = {}
        for consumer in phed_consumers:
            property_id = consumer.get("linked_property_id")
            existing = phed_by_property.get(property_id)
            if existing is None or existing.get("source") == "survey":
                phed_by_property[property_id] = consumer
        for prop in unique_properties:
            consumer = phed_by_property.get(prop["id"])
            if consumer:
                prop["phed_consumer_id"] = consumer.get("consumer_id")
                prop["phed_consumer_name"] = consumer.get("consumer_name")
                prop["phed_consumer_mobile"] = consumer.get("phone")
                prop["phed_consumer_source"] = consumer.get("source")
    
    return {
        "properties": unique_properties,
        "count": len(unique_properties),
        "total_before_dedup": len(properties)
    }

@api_router.get("/map/employee-properties")
async def get_employee_map_properties(
    hide_completed: bool = False,
    current_user: dict = Depends(get_current_user)
):
    """Fast lightweight endpoint for surveyor map - Optimized with caching"""
    
    # Check cache first
    cache_key = f"emp_map_{current_user['id']}_{hide_completed}_{get_current_town_code()}"
    cached = map_cache.get(cache_key)
    if cached:
        return cached
    
    query = {
        "$or": [
            {"assigned_employee_id": current_user["id"]},
            {"assigned_employee_ids": current_user["id"]}
        ],
        "latitude": {"$ne": None},
        "longitude": {"$ne": None}
    }
    
    # Hide completed if requested
    if hide_completed:
        query["status"] = {"$nin": ["Completed", "Approved"]}
    
    # OPTIMIZED: Minimal projection for fast loading
    projection = {
        "_id": 0,
        "id": 1,
        "latitude": 1,
        "longitude": 1,
        "status": 1,
        "phed_survey_status": 1,
        "serial_number": 1,
        "bill_sr_no": 1,
        "property_id": 1,
        "owner_name": 1,
        "colony": 1,
        "ward": 1,
        "mobile": 1,
        "amount": 1,
        "total_area": 1,
        "category": 1,
        "address": 1,
        "self_certified": 1,
        "phed_survey_state": 1,
        "phed_outcome": 1,
        "phed_surveyor_name": 1
    }
    
    properties = await get_db().properties.find(
        query, 
        projection,
        batch_size=2000
    ).sort([
        ("status", 1),
        ("serial_number", 1)
    ]).to_list(None)
    
    # Faster deduplication using set
    seen = set()
    unique_properties = []
    for prop in properties:
        prop_id = prop.get("property_id", "")
        if prop_id:
            if prop_id not in seen:
                seen.add(prop_id)
                unique_properties.append(prop)
        else:
            unique_properties.append(prop)
    
    result = {
        "properties": unique_properties,
        "count": len(unique_properties)
    }
    
    # Cache for 60 seconds
    map_cache.set(cache_key, result)
    return result

# Clear cache when properties are modified
async def clear_map_cache():
    """Call this when properties are added/modified"""
    map_cache.clear()
    colonies_cache.clear()

# Get submission by property ID
@api_router.get("/submission/by-property/{property_id}")
async def get_submission_by_property(
    property_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get submission data for a specific property"""
    if current_user["role"] not in ["ADMIN", "SUPERVISOR", "MC_OFFICER"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Search by property_record_id or property_id
    submission = await get_db().submissions.find_one(
        {"$or": [
            {"property_record_id": property_id},
            {"property_id": property_id}
        ]},
        {"_id": 0}
    )
    
    if not submission:
        return {"submission": None}
    
    return {"submission": submission}

# ============== TOWN MANAGEMENT ROUTES ==============

@api_router.get("/towns")
async def list_all_towns():
    """Get all active towns - public endpoint for login page"""
    towns = await master_db.towns.find({"is_active": True}, {"_id": 0}).sort("name", 1).to_list(None)
    return {"towns": towns}

@api_router.get("/admin/towns/manage")
async def list_towns_admin(current_user: dict = Depends(get_current_user)):
    """Get all towns for admin management"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    towns = await master_db.towns.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    
    # Parallel stats fetch for all towns
    async def get_town_stats(town):
        town_db = get_town_db(town["code"])
        prop_count, user_count = await asyncio.gather(
            town_db.properties.estimated_document_count(),
            master_db.users.count_documents({"assigned_town": town["id"]})
        )
        town["property_count"] = prop_count
        town["user_count"] = user_count
    
    await asyncio.gather(*[get_town_stats(t) for t in towns])
    
    return {"towns": towns}

@api_router.post("/admin/towns")
async def create_town(data: TownCreate, request: Request, current_user: dict = Depends(get_current_user)):
    """Create a new town"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if code already exists
    existing = await master_db.towns.find_one({"code": data.code.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="Town code already exists")
    
    town_doc = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "code": data.code.upper(),
        "description": data.description,
        "is_active": data.is_active,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await master_db.towns.insert_one(town_doc)
    
    # Initialize town-specific database with indexes
    town_db = get_town_db(data.code.upper())
    await create_town_indexes(town_db)
    await record_audit(current_user, "TOWN_CREATE", "town", town_doc["id"],
                       {"after": {k: town_doc[k] for k in ("name", "code", "description", "is_active")}}, request)
    
    return {"message": "Town created successfully", "town": {k: v for k, v in town_doc.items() if k != "_id"}}

@api_router.put("/admin/towns/{town_id}")
async def update_town(town_id: str, data: TownUpdate, request: Request, current_user: dict = Depends(get_current_user)):
    """Update a town"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town = await master_db.towns.find_one({"id": town_id})
    if not town:
        raise HTTPException(status_code=404, detail="Town not found")
    
    update_data = {}
    if data.name is not None:
        update_data["name"] = data.name
    if data.code is not None:
        # Check if code is unique
        existing = await master_db.towns.find_one({"code": data.code.upper(), "id": {"$ne": town_id}})
        if existing:
            raise HTTPException(status_code=400, detail="Town code already exists")
        update_data["code"] = data.code.upper()
    if data.description is not None:
        update_data["description"] = data.description
    if data.is_active is not None:
        update_data["is_active"] = data.is_active
    
    if update_data:
        await master_db.towns.update_one({"id": town_id}, {"$set": update_data})
        await record_audit(current_user, "TOWN_UPDATE", "town", town_id,
                           {"before": {k: town.get(k) for k in update_data}, "after": update_data}, request)
    
    return {"message": "Town updated successfully"}

@api_router.delete("/admin/towns/{town_id}")
async def delete_town(town_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Delete a town (soft delete by setting is_active=False)"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town = await master_db.towns.find_one({"id": town_id})
    if not town:
        raise HTTPException(status_code=404, detail="Town not found")
    
    # Check town-specific DB for data
    town_db = get_town_db(town["code"])
    total_properties = await town_db.properties.count_documents({})
    
    if total_properties > 0:
        # Soft delete
        await master_db.towns.update_one({"id": town_id}, {"$set": {"is_active": False}})
        await record_audit(current_user, "TOWN_DEACTIVATE", "town", town_id,
                           {"code": town["code"], "name": town["name"], "properties": total_properties}, request)
        return {"message": f"Town deactivated (has {total_properties} properties)"}
    else:
        # Hard delete if no data
        await master_db.towns.delete_one({"id": town_id})
        if isinstance(town_db, TownNamespace):
            for name in await db.list_collection_names(filter={"name": {"$regex": f"^{re.escape(town_db.prefix)}"}}):
                await db.drop_collection(name)
        await record_audit(current_user, "TOWN_DELETE", "town", town_id, {"code": town["code"], "name": town["name"]}, request)
        return {"message": "Town deleted successfully"}

@api_router.post("/admin/towns/{town_id}/set-active")
async def set_current_town(town_id: str, current_user: dict = Depends(get_current_user)):
    """Set the active town for the current session"""
    town = await master_db.towns.find_one({"id": town_id, "is_active": True}, {"_id": 0})
    if not town:
        raise HTTPException(status_code=404, detail="Town not found or inactive")
    
    # For non-admin users, verify they are assigned to this town
    if current_user["role"] != "ADMIN":
        if current_user.get("assigned_town") and current_user["assigned_town"] != town_id:
            raise HTTPException(status_code=403, detail="You are not assigned to this town")
    
    return {"message": "Town selected", "town": town}

# ============== ADMIN USER ROUTES ==============

@api_router.post("/admin/users", response_model=UserResponse)
async def create_user(data: UserCreate, request: Request, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    existing = await master_db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Auto-assign to current town if not explicitly set
    assigned_town = data.assigned_town
    if not assigned_town:
        town_code = request.headers.get("x-town-code")
        if town_code:
            town = await master_db.towns.find_one({"code": town_code}, {"_id": 0})
            if town:
                assigned_town = town["id"]
    
    user_permissions = None
    if data.role in ["SUPERVISOR", "MC_OFFICER"]:
        if data.permissions:
            user_permissions = [p for p in data.permissions if p in AVAILABLE_PERMISSIONS]
        else:
            user_permissions = ["dashboard", "properties", "map", "submissions"]
    elif data.role == "ADMIN":
        user_permissions = AVAILABLE_PERMISSIONS.copy()
    
    user_doc = {
        "id": str(uuid.uuid4()),
        "username": data.username,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": data.role,
        "assigned_area": data.assigned_area,
        "assigned_town": assigned_town,
        "authority": data.authority if data.role in ["SUPERVISOR", "MC_OFFICER"] else None,
        "permissions": user_permissions,
        "gps_radius_required": bool(data.gps_radius_required) if data.role == "SURVEYOR" else True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await master_db.users.insert_one(user_doc)
    await record_audit(current_user, "USER_CREATE", "user", user_doc["id"], {"after": _safe_user_fields(user_doc)}, request)
    
    return {
        "id": user_doc["id"],
        "username": user_doc["username"],
        "name": user_doc["name"],
        "role": user_doc["role"],
        "assigned_area": user_doc["assigned_area"],
        "assigned_town": user_doc["assigned_town"],
        "authority": user_doc["authority"],
        "permissions": user_doc["permissions"],
        "gps_radius_required": user_doc["gps_radius_required"],
        "created_at": user_doc["created_at"]
    }

@api_router.get("/admin/users", response_model=List[UserResponse])
async def list_users(request: Request, current_user: dict = Depends(get_current_user)):
    # Allow ADMIN, SUPERVISOR, and MC_OFFICER to view users
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor/MC Officer access required")
    
    # Filter users by selected town
    query = {}
    town_code = request.headers.get("x-town-code")
    if town_code:
        town = await master_db.towns.find_one({"code": town_code}, {"_id": 0})
        if town:
            query = {"$or": [
                {"assigned_town": town["id"]},
                {"role": "ADMIN"}
            ]}
    
    users = await master_db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    
    target = await master_db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    result = await master_db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await record_audit(current_user, "USER_DELETE", "user", user_id, {"before": _safe_user_fields(target or {})}, request)
    return {"message": "User deleted"}

class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    authority: Optional[str] = None
    permissions: Optional[List[str]] = None
    assigned_area: Optional[str] = None
    gps_radius_required: Optional[bool] = None

@api_router.put("/admin/users/{user_id}")
async def update_user(user_id: str, data: UpdateUserRequest, request: Request, current_user: dict = Depends(get_current_user)):
    """Update user details (Admin only)"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Check if user exists
    user = await master_db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Build update dict
    update_data = {}
    if data.name:
        update_data["name"] = data.name
    if data.authority is not None:
        update_data["authority"] = data.authority
    if data.permissions is not None:
        update_data["permissions"] = data.permissions
    if data.assigned_area is not None:
        update_data["assigned_area"] = data.assigned_area
    if data.gps_radius_required is not None:
        update_data["gps_radius_required"] = bool(data.gps_radius_required)
    
    if update_data:
        await master_db.users.update_one({"id": user_id}, {"$set": update_data})
        await record_audit(current_user, "USER_UPDATE", "user", user_id,
                           {"username": user.get("username"), "before": {k: user.get(k) for k in update_data}, "after": update_data}, request)
    
    # Return updated user
    updated_user = await master_db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return updated_user

class ResetPasswordRequest(BaseModel):
    new_password: str

@api_router.post("/admin/users/{user_id}/reset-password")
async def reset_user_password(user_id: str, data: ResetPasswordRequest, request: Request, current_user: dict = Depends(get_current_user)):
    """Reset password for a user (Admin only)"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    
    # Check if user exists
    user = await master_db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Hash the new password
    hashed_password = bcrypt.hashpw(data.new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # Update password_hash (the field used by login verification)
    await master_db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": hashed_password}}
    )
    await record_audit(current_user, "USER_PASSWORD_RESET", "user", user_id, {"username": user.get("username")}, request)
    
    return {"message": f"Password reset successfully for {user['name']}"}

# ============== BATCH UPLOAD ROUTES ==============

@api_router.post("/admin/batch/upload")
async def upload_batch(
    file: UploadFile = File(...),
    batch_name: str = Form(...),
    authorization: str = Form(...)
):
    current_user = await get_current_user(authorization)
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Read file content
    content = await file.read()
    filename = file.filename.lower()
    
    properties = []
    
    # Check file type and parse accordingly
    if filename.endswith('.xlsx') or filename.endswith('.xls'):
        # Parse Excel file using openpyxl
        import openpyxl
        from io import BytesIO
        
        workbook = openpyxl.load_workbook(BytesIO(content), data_only=True)
        sheet = workbook.active
        
        # Get headers from first row
        headers = []
        for cell in sheet[1]:
            headers.append(str(cell.value).strip() if cell.value else "")
        
        # Create header mapping (case-insensitive)
        header_map = {h.lower(): i for i, h in enumerate(headers)}
        
        # Parse data rows starting from row 2
        serial_num = 1
        for row in sheet.iter_rows(min_row=2, values_only=True):
            if not any(row):  # Skip empty rows
                continue
            
            # Get values using header mapping
            def get_val(keys):
                for k in keys:
                    idx = header_map.get(k.lower())
                    if idx is not None and idx < len(row) and row[idx]:
                        return str(row[idx]).strip()
                return ""
            
            prop = {
                "id": str(uuid.uuid4()),
                "serial_number": serial_num,
                "property_id": get_val(["Property Id", "property_id", "PropertyID"]) or str(uuid.uuid4())[:8].upper(),
                "old_property_id": get_val(["Old Property Id", "old_property_id", "OldPropertyId"]),
                "owner_name": get_val(["Owner Name", "owner_name", "OwnerName"]) or "Unknown",
                "mobile": get_val(["Mobile", "mobile", "Mobile No", "Phone"]),
                "address": get_val(["Plot Address", "Address", "address", "plot_address"]),
                "colony": get_val(["Colony", "colony", "Area", "area"]),
                "ward": (get_val(["Ward No", "Ward Number", "Ward", "ward", "ward_no"])
                         or ward_master.ward_for_colony(get_val(["Colony", "colony", "Area", "area"]))
                         or get_val(["Colony", "colony", "Area", "area"])),
                "latitude": None,
                "longitude": None,
                "total_area": get_val(["Total Area (SqYard)", "Total Area", "total_area", "Area"]),
                "category": get_val(["Category", "category"]),
                "amount": get_val(["Outstanding", "Total Outstanding", "Amount", "amount"]) or "0",
                "financial_year": get_val(["Financial Year", "financial_year"]) or "2025-2026",
                "assigned_employee_id": None,
                "assigned_employee_name": None,
                "status": "Pending",
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Parse latitude/longitude if available
            lat_str = get_val(["Latitude", "latitude", "Lat"])
            lng_str = get_val(["Longitude", "longitude", "Long", "Lng"])
            if lat_str:
                try:
                    prop["latitude"] = float(lat_str)
                except (ValueError, TypeError):
                    pass
            if lng_str:
                try:
                    prop["longitude"] = float(lng_str)
                except (ValueError, TypeError):
                    pass
            
            properties.append(prop)
            serial_num += 1
    else:
        # Parse CSV file
        content_str = content.decode('utf-8')
        reader = csv.DictReader(io.StringIO(content_str))
        
        serial_num = 1
        for row in reader:
            prop = {
                "id": str(uuid.uuid4()),
                "serial_number": serial_num,
                "property_id": row.get("property_id") or row.get("Property Id") or row.get("PropertyID") or str(uuid.uuid4())[:8].upper(),
                "old_property_id": row.get("old_property_id") or row.get("Old Property Id") or "",
                "owner_name": row.get("owner_name") or row.get("Owner Name") or row.get("OwnerName") or "Unknown",
                "mobile": row.get("mobile") or row.get("Mobile") or row.get("Mobile No") or "",
                "address": row.get("address") or row.get("Address") or row.get("Plot Address") or row.get("plot_address") or "",
                "colony": row.get("Colony") or row.get("colony") or row.get("Area") or "",
                "ward": (row.get("Ward No") or row.get("Ward Number") or row.get("ward") or row.get("Ward")
                         or ward_master.ward_for_colony(row.get("Colony") or row.get("colony") or row.get("Area") or "")
                         or row.get("Colony") or row.get("colony") or ""),
                "latitude": None,
                "longitude": None,
                "total_area": row.get("total_area") or row.get("Total Area") or row.get("Total Area (SqYard)") or "",
                "category": row.get("Category") or row.get("category") or "",
                "amount": row.get("amount") or row.get("Amount") or row.get("Outstanding") or "0",
                "financial_year": row.get("Financial Year") or row.get("financial_year") or "2025-2026",
                "assigned_employee_id": None,
                "assigned_employee_name": None,
                "status": "Pending",
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Parse latitude/longitude
            lat_str = row.get("Latitude") or row.get("latitude")
            lng_str = row.get("Longitude") or row.get("longitude")
            if lat_str:
                try:
                    prop["latitude"] = float(lat_str)
                except (ValueError, TypeError):
                    pass
            if lng_str:
                try:
                    prop["longitude"] = float(lng_str)
                except (ValueError, TypeError):
                    pass
            
            properties.append(prop)
            serial_num += 1
    
    if not properties:
        raise HTTPException(status_code=400, detail="No valid properties found in file")
    
    # Create batch
    batch_doc = {
        "id": str(uuid.uuid4()),
        "name": batch_name,
        "uploaded_by": current_user["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "status": "ACTIVE",
        "total_records": len(properties)
    }
    await get_db().batches.insert_one(batch_doc)
    
    # Add batch_id to properties and insert
    for prop in properties:
        prop["batch_id"] = batch_doc["id"]
    
    if properties:
        # Auto-merge photo_url from permanent property_photos collection
        prop_pids = [p.get("property_id", "") for p in properties if p.get("property_id")]
        if prop_pids:
            photo_docs = await get_db().property_photos.find(
                {"property_id": {"$in": prop_pids}}, {"property_id": 1, "photo_url": 1, "_id": 0}
            ).to_list(None)
            photo_map = {d["property_id"]: d["photo_url"] for d in photo_docs if d.get("photo_url")}
            if photo_map:
                for prop in properties:
                    pid = prop.get("property_id", "")
                    if pid in photo_map:
                        prop["photo_url"] = photo_map[pid]
                    elif pid.upper() in photo_map:
                        prop["photo_url"] = photo_map[pid.upper()]
        
        await get_db().properties.insert_many(properties)
    
    return {
        "batch_id": batch_doc["id"],
        "name": batch_doc["name"],
        "total_records": len(properties),
        "message": f"Successfully uploaded {len(properties)} properties"
    }

@api_router.get("/admin/batches", response_model=List[DatasetBatchResponse])
async def list_batches(current_user: dict = Depends(get_current_user)):
    # Allow ADMIN, SUPERVISOR, and MC_OFFICER to view batches
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor access required")
    
    batches = await get_db().batches.find({"status": {"$ne": "DELETED"}}, {"_id": 0}).to_list(100)
    return batches

@api_router.post("/admin/batch/{batch_id}/archive")
async def archive_batch(batch_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await get_db().batches.update_one(
        {"id": batch_id},
        {"$set": {"status": "ARCHIVED"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"message": "Batch archived"}

@api_router.delete("/admin/batch/{batch_id}")
async def delete_batch(batch_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await get_db().properties.delete_many({"batch_id": batch_id})
    await get_db().submissions.delete_many({"batch_id": batch_id})
    await get_db().batches.delete_one({"id": batch_id})
    
    return {"message": "Batch and all related data deleted"}

# ============== ROLE DEFINITIONS ==============
# Roles with admin-level access (can modify data)
ADMIN_ROLES = ["ADMIN", "SUPERVISOR"]
# Roles that can view admin dashboard (including MC_OFFICER with limited access)
ADMIN_VIEW_ROLES = ["ADMIN", "SUPERVISOR", "MC_OFFICER"]
# Roles that can export data (PDF/Excel)
EXPORT_ROLES = ["ADMIN", "MC_OFFICER"]
# Roles that can upload data
UPLOAD_ROLES = ["ADMIN", "SUPERVISOR"]
# Roles that can edit submissions
SUBMISSION_EDIT_ROLES = ["ADMIN", "SUPERVISOR", "MC_OFFICER"]
# Roles that can download employee performance
PERFORMANCE_DOWNLOAD_ROLES = ["ADMIN"]

# ============== PROPERTY ROUTES ==============

@api_router.get("/admin/properties")
async def list_properties(
    request: Request,
    batch_id: Optional[str] = None,
    ward: Optional[str] = None,
    town: Optional[str] = None,
    status: Optional[str] = None,
    employee_id: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if ward and ward.strip():
        query["ward"] = ward
    if town and town.strip():
        query["town"] = town
    if status and status.strip():
        query["status"] = status
    if employee_id and employee_id.strip():
        query["assigned_employee_id"] = employee_id
    if search:
        query["$or"] = [
            {"property_id": {"$regex": search, "$options": "i"}},
            {"owner_name": {"$regex": search, "$options": "i"}},
            {"mobile": {"$regex": search, "$options": "i"}},
            {"colony": {"$regex": search, "$options": "i"}},
            {"address": {"$regex": search, "$options": "i"}}
        ]
    
    projection = {
        "_id": 0, "id": 1, "property_id": 1, "owner_name": 1, "mobile": 1,
        "address": 1, "colony": 1, "ward": 1, "town": 1, "latitude": 1,
        "longitude": 1, "status": 1, "serial_number": 1, "bill_sr_no": 1,
        "amount": 1, "category": 1, "total_area": 1, "assigned_employee_id": 1,
        "assigned_employee_name": 1, "assigned_employee_ids": 1, "batch_id": 1, "created_at": 1,
        "photo_url": 1, "phed_survey_status": 1, "phed_survey_type": 1
    }
    
    skip = (page - 1) * limit
    total = await town_db.properties.count_documents(query)
    properties = await town_db.properties.find(query, projection).sort("serial_number", 1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "properties": properties,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@api_router.post("/admin/assign")
async def assign_properties(data: AssignmentRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Support both single employee_id and multiple employee_ids
    new_emp_ids = data.employee_ids if data.employee_ids else ([data.employee_id] if data.employee_id else [])
    
    if not new_emp_ids:
        raise HTTPException(status_code=400, detail="At least one employee must be selected")
    
    # Get all selected employees
    new_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0}).to_list(None)
    if not new_employees:
        raise HTTPException(status_code=404, detail="No employees found")
    
    # Process each property to ADD new employees to existing assignments
    updated_count = 0
    for prop_id in data.property_ids:
        # Get existing property to check current assignments
        prop = await get_db().properties.find_one({"id": prop_id}, {"_id": 0})
        if not prop:
            continue
        
        # Get existing assigned employee IDs (or empty list)
        existing_emp_ids = prop.get("assigned_employee_ids") or []
        if prop.get("assigned_employee_id") and prop["assigned_employee_id"] not in existing_emp_ids:
            existing_emp_ids.append(prop["assigned_employee_id"])
        
        # Merge new employees with existing (avoid duplicates)
        combined_emp_ids = list(set(existing_emp_ids + new_emp_ids))
        
        # Get all employee names for the combined list
        all_employees = await master_db.users.find({"id": {"$in": combined_emp_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
        combined_names = ", ".join([emp["name"] for emp in all_employees])
        
        # Update the property with merged assignments
        await get_db().properties.update_one(
            {"id": prop_id},
            {"$set": {
                "assigned_employee_ids": combined_emp_ids,
                "assigned_employee_id": combined_emp_ids[0] if combined_emp_ids else None,
                "assigned_employee_name": combined_names
            }}
        )
        updated_count += 1
    
    new_employee_names = ", ".join([emp["name"] for emp in new_employees])
    return {"message": f"Added {new_employee_names} to {updated_count} properties"}

@api_router.post("/admin/assign-bulk")
async def bulk_assign_by_ward(data: BulkAssignmentRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Support both single employee_id and multiple employee_ids
    new_emp_ids = data.employee_ids if data.employee_ids else ([data.employee_id] if data.employee_id else [])
    
    if not new_emp_ids:
        raise HTTPException(status_code=400, detail="At least one employee must be selected")
    
    # Get all selected employees
    new_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0}).to_list(None)
    if not new_employees:
        raise HTTPException(status_code=404, detail="No employees found")
    
    emp_name_map = {emp["id"]: emp["name"] for emp in new_employees}
    
    # AUTO-COPY: Check if bills exist for this colony but haven't been copied to properties yet
    bills_count = await get_db().bills.count_documents({"colony": {"$regex": f"^{re.escape(data.area.strip())}$", "$options": "i"}})
    props_count = await get_db().properties.count_documents({"ward": data.area})
    
    if bills_count > 0 and props_count == 0:
        # Auto-copy bills to properties for this colony
        bills = await get_db().bills.find(
            {"colony": {"$regex": f"^{re.escape(data.area.strip())}$", "$options": "i"}}, {"_id": 0}
        ).sort("serial_number", 1).to_list(None)
        
        existing_props = await get_db().properties.find({}, {"property_id": 1, "_id": 0}).to_list(None)
        existing_ids = set(p.get("property_id", "") for p in existing_props if p.get("property_id"))
        
        auto_batch_id = str(uuid.uuid4())
        auto_copied = 0
        for bill in bills:
            pid = bill.get("property_id", "")
            if pid and pid not in existing_ids:
                prop = {
                    "id": str(uuid.uuid4()),
                    "property_id": pid,
                    "batch_id": auto_batch_id,
                    "owner_name": bill.get("owner_name", ""),
                    "mobile": bill.get("mobile", ""),
                    "address": bill.get("address", ""),
                    "ward": bill.get("colony", ""),
                    "colony": bill.get("colony", ""),
                    "category": bill.get("category") or "Residential",
                    "total_area": bill.get("total_area") or "",
                    "amount": bill.get("total_outstanding") or bill.get("amount") or "0",
                    "serial_number": bill.get("serial_number", 0),
                    "bill_sr_no": bill.get("bill_sr_no", ""),
                    "latitude": bill.get("latitude"),
                    "longitude": bill.get("longitude"),
                    "photo_url": bill.get("photo_url", ""),
                    "status": "Pending",
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                await get_db().properties.insert_one(prop)
                existing_ids.add(pid)
                auto_copied += 1
        
        logger.info(f"Auto-copied {auto_copied} bills to properties for colony {data.area}")
    
    # Build query - just filter by area, serial filtering done in Python
    query = {"ward": data.area}
    
    # Get ALL properties in the ward/area (serial filtering done in Python to handle N-prefix)
    properties = await get_db().properties.find(query, {"_id": 0, "id": 1, "serial_number": 1, "bill_sr_no": 1, "assigned_employee_ids": 1, "assigned_employee_id": 1}).to_list(None)
    
    # RANGE ASSIGNMENT: Filter by serial number range (handles N-prefix)
    if data.serial_from is not None and data.serial_to is not None:
        filtered_props = []
        for prop in properties:
            serial = prop.get("serial_number") or 0
            bill_sr_str = str(prop.get("bill_sr_no") or "").strip()
            
            # Try to get numeric serial
            bill_sr_num = 0
            try:
                bill_sr_num = int(bill_sr_str)
            except (ValueError, TypeError):
                pass
            
            # Handle N-prefix serial numbers (e.g., N45, N584, N123)
            n_serial = 0
            if bill_sr_str.upper().startswith("N"):
                try:
                    n_serial = int(bill_sr_str[1:])  # Extract number after "N"
                except (ValueError, TypeError):
                    pass
            
            # Use the best available serial: actual serial > bill_sr_no as number > N-prefix number
            effective_serial = serial if serial > 0 else (bill_sr_num if bill_sr_num > 0 else n_serial)
            
            # Include if the effective serial is within range
            if effective_serial > 0 and data.serial_from <= effective_serial <= data.serial_to:
                filtered_props.append(prop)
        
        properties = filtered_props
    
    if not properties:
        raise HTTPException(status_code=404, detail=f"No properties found in {data.area}" + (f" with serial {data.serial_from}-{data.serial_to}" if data.serial_from else ""))
    
    # Check if custom distribution is provided
    if data.custom_distribution:
        # Custom distribution: assign specific count to each employee
        updated_count = 0
        prop_index = 0
        
        for emp_id, count in data.custom_distribution.items():
            if emp_id not in new_emp_ids:
                continue
                
            _emp_name = emp_name_map.get(emp_id, "Unknown")
            
            # Assign 'count' properties to this employee
            for i in range(int(count)):
                if prop_index >= len(properties):
                    break
                    
                prop = properties[prop_index]
                
                # Get existing assigned employee IDs
                existing_emp_ids = prop.get("assigned_employee_ids") or []
                if prop.get("assigned_employee_id") and prop["assigned_employee_id"] not in existing_emp_ids:
                    existing_emp_ids.append(prop["assigned_employee_id"])
                
                # Add only this employee (not all)
                combined_emp_ids = list(set(existing_emp_ids + [emp_id]))
                
                # Get all employee names
                all_employees = await master_db.users.find({"id": {"$in": combined_emp_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
                combined_names = ", ".join([e["name"] for e in all_employees])
                
                await get_db().properties.update_one(
                    {"id": prop["id"]},
                    {"$set": {
                        "assigned_employee_ids": combined_emp_ids,
                        "assigned_employee_id": combined_emp_ids[0] if combined_emp_ids else None,
                        "assigned_employee_name": combined_names
                    }}
                )
                updated_count += 1
                prop_index += 1
        
        # Build distribution summary
        dist_summary = ", ".join([f"{emp_name_map.get(eid, 'Unknown')}: {cnt}" for eid, cnt in data.custom_distribution.items()])
        return {"message": f"Assigned {updated_count} properties in {data.area} (Distribution: {dist_summary})"}
    
    else:
        # Default: assign ALL employees to ALL properties (existing behavior)
        updated_count = 0
        for prop in properties:
            existing_emp_ids = prop.get("assigned_employee_ids") or []
            if prop.get("assigned_employee_id") and prop["assigned_employee_id"] not in existing_emp_ids:
                existing_emp_ids.append(prop["assigned_employee_id"])
            
            combined_emp_ids = list(set(existing_emp_ids + new_emp_ids))
            
            all_employees = await master_db.users.find({"id": {"$in": combined_emp_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
            combined_names = ", ".join([emp["name"] for emp in all_employees])
            
            await get_db().properties.update_one(
                {"id": prop["id"]},
                {"$set": {
                    "assigned_employee_ids": combined_emp_ids,
                    "assigned_employee_id": combined_emp_ids[0] if combined_emp_ids else None,
                    "assigned_employee_name": combined_names
                }}
            )
            updated_count += 1
        
        # Update all assigned employees with the area
        for emp_id in new_emp_ids:
            await master_db.users.update_one(
                {"id": emp_id},
                {"$set": {"assigned_area": data.area}}
            )
        
        new_employee_names = ", ".join([emp["name"] for emp in new_employees])
        range_info = f" (Serial {data.serial_from}-{data.serial_to})" if data.serial_from else ""
        return {"message": f"Assigned {new_employee_names} to {updated_count} properties in {data.area}{range_info}"}

@api_router.post("/admin/unassign-bulk")
async def bulk_unassign_by_ward(data: BulkUnassignRequest, current_user: dict = Depends(get_current_user)):
    """Bulk unassign properties by area"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {"$or": [{"ward": data.area}, {"colony": data.area}]}
    
    # If specific employee, only unassign that employee
    if data.employee_id:
        employee = await master_db.users.find_one({"id": data.employee_id}, {"_id": 0, "name": 1})
        emp_name = employee["name"] if employee else "Unknown"
        
        # Find properties assigned to this employee in this area
        properties = await get_db().properties.find({
            "$and": [
                {"$or": [{"ward": data.area}, {"colony": data.area}]},
                {"$or": [
                    {"assigned_employee_id": data.employee_id},
                    {"assigned_employee_ids": data.employee_id}
                ]}
            ]
        }, {"_id": 0, "id": 1, "assigned_employee_ids": 1, "assigned_employee_id": 1}).to_list(None)
        
        updated_count = 0
        for prop in properties:
            existing_emp_ids = prop.get("assigned_employee_ids") or []
            
            # Remove this employee from the list
            new_emp_ids = [eid for eid in existing_emp_ids if eid != data.employee_id]
            
            if new_emp_ids:
                # Still has other employees
                all_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0, "name": 1}).to_list(None)
                combined_names = ", ".join([e["name"] for e in all_employees])
                
                await get_db().properties.update_one(
                    {"id": prop["id"]},
                    {"$set": {
                        "assigned_employee_ids": new_emp_ids,
                        "assigned_employee_id": new_emp_ids[0],
                        "assigned_employee_name": combined_names
                    }}
                )
            else:
                # No employees left, clear all
                await get_db().properties.update_one(
                    {"id": prop["id"]},
                    {"$set": {
                        "assigned_employee_ids": [],
                        "assigned_employee_id": None,
                        "assigned_employee_name": None
                    }}
                )
            updated_count += 1
        
        return {"message": f"Removed {emp_name} from {updated_count} properties in {data.area}"}
    
    else:
        # Unassign ALL employees from ALL properties in this area
        result = await get_db().properties.update_many(
            query,
            {"$set": {
                "assigned_employee_ids": [],
                "assigned_employee_id": None,
                "assigned_employee_name": None
            }}
        )
        
        return {"message": f"Unassigned all employees from {result.modified_count} properties in {data.area}"}

# ============== UNASSIGN PROPERTIES ==============
class UnassignRequest(BaseModel):
    property_ids: List[str]
    employee_id: Optional[str] = None  # If provided, only unassign this employee. If not, unassign all.

@api_router.post("/admin/unassign")
async def unassign_properties(data: UnassignRequest, current_user: dict = Depends(get_current_user)):
    """Unassign employee(s) from properties"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not data.property_ids:
        raise HTTPException(status_code=400, detail="No properties selected")
    
    updated_count = 0
    
    for prop_id in data.property_ids:
        prop = await get_db().properties.find_one({"id": prop_id}, {"_id": 0})
        if not prop:
            continue
        
        if data.employee_id:
            # Unassign specific employee
            existing_emp_ids = prop.get("assigned_employee_ids") or []
            if prop.get("assigned_employee_id"):
                if prop["assigned_employee_id"] not in existing_emp_ids:
                    existing_emp_ids.append(prop["assigned_employee_id"])
            
            # Remove the specified employee
            new_emp_ids = [eid for eid in existing_emp_ids if eid != data.employee_id]
            
            if new_emp_ids:
                # Get remaining employee names
                remaining_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
                remaining_names = ", ".join([emp["name"] for emp in remaining_employees])
                
                await get_db().properties.update_one(
                    {"id": prop_id},
                    {"$set": {
                        "assigned_employee_ids": new_emp_ids,
                        "assigned_employee_id": new_emp_ids[0],
                        "assigned_employee_name": remaining_names
                    }}
                )
            else:
                # No employees left - clear all assignment fields
                await get_db().properties.update_one(
                    {"id": prop_id},
                    {"$set": {
                        "assigned_employee_ids": [],
                        "assigned_employee_id": None,
                        "assigned_employee_name": None
                    }}
                )
        else:
            # Unassign ALL employees
            await get_db().properties.update_one(
                {"id": prop_id},
                {"$set": {
                    "assigned_employee_ids": [],
                    "assigned_employee_id": None,
                    "assigned_employee_name": None
                }}
            )
        
        updated_count += 1
    
    if data.employee_id:
        emp = await master_db.users.find_one({"id": data.employee_id}, {"_id": 0, "name": 1})
        emp_name = emp["name"] if emp else "Employee"
        return {"message": f"Unassigned {emp_name} from {updated_count} properties"}
    else:
        return {"message": f"Unassigned all employees from {updated_count} properties"}

@api_router.post("/admin/unassign-by-employee")
async def unassign_all_properties_from_employee(
    employee_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Unassign ALL properties from a specific employee (when they leave)"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get employee name
    employee = await master_db.users.find_one({"id": employee_id}, {"_id": 0, "name": 1})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Find all properties assigned to this employee
    properties = await get_db().properties.find({
        "$or": [
            {"assigned_employee_id": employee_id},
            {"assigned_employee_ids": employee_id}
        ]
    }, {"_id": 0, "id": 1, "assigned_employee_ids": 1, "assigned_employee_id": 1}).to_list(None)
    
    updated_count = 0
    for prop in properties:
        existing_emp_ids = prop.get("assigned_employee_ids") or []
        if prop.get("assigned_employee_id") and prop["assigned_employee_id"] not in existing_emp_ids:
            existing_emp_ids.append(prop["assigned_employee_id"])
        
        # Remove the employee
        new_emp_ids = [eid for eid in existing_emp_ids if eid != employee_id]
        
        if new_emp_ids:
            remaining_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
            remaining_names = ", ".join([emp["name"] for emp in remaining_employees])
            
            await get_db().properties.update_one(
                {"id": prop["id"]},
                {"$set": {
                    "assigned_employee_ids": new_emp_ids,
                    "assigned_employee_id": new_emp_ids[0],
                    "assigned_employee_name": remaining_names
                }}
            )
        else:
            await get_db().properties.update_one(
                {"id": prop["id"]},
                {"$set": {
                    "assigned_employee_ids": [],
                    "assigned_employee_id": None,
                    "assigned_employee_name": None
                }}
            )
        updated_count += 1
    
    return {
        "message": f"Unassigned {employee['name']} from {updated_count} properties",
        "unassigned_count": updated_count
    }

class BulkDeleteRequest(BaseModel):
    property_ids: List[str]

@api_router.post("/admin/properties/bulk-delete")
async def bulk_delete_properties(data: BulkDeleteRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not data.property_ids:
        raise HTTPException(status_code=400, detail="No properties selected for deletion")
    
    # Delete associated submissions first
    await get_db().submissions.delete_many({"property_record_id": {"$in": data.property_ids}})
    
    # Delete the properties
    result = await get_db().properties.delete_many({"id": {"$in": data.property_ids}})
    
    return {
        "message": f"Successfully deleted {result.deleted_count} properties",
        "deleted_count": result.deleted_count
    }

@api_router.post("/admin/properties/delete-all")
async def delete_all_properties(
    batch_id: Optional[str] = None,
    ward: Optional[str] = None,
    status: Optional[str] = None,
    employee_id: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Delete all properties matching the given filters. If no filters, deletes ALL properties."""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Build query based on filters
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if ward and ward.strip():
        query["ward"] = ward
    if status and status.strip():
        query["status"] = status
    if employee_id and employee_id.strip():
        query["assigned_employee_id"] = employee_id
    if search and search.strip():
        query["$or"] = [
            {"property_id": {"$regex": search, "$options": "i"}},
            {"owner_name": {"$regex": search, "$options": "i"}},
            {"mobile": {"$regex": search, "$options": "i"}}
        ]
    
    # Get count first
    count = await get_db().properties.count_documents(query)
    
    if count == 0:
        return {"message": "No properties found to delete", "deleted_count": 0}
    
    # Get all property IDs to delete submissions
    properties = await get_db().properties.find(query, {"id": 1, "_id": 0}).to_list(None)
    property_ids = [p["id"] for p in properties]
    
    # Delete associated submissions first
    await get_db().submissions.delete_many({"property_record_id": {"$in": property_ids}})
    
    # Delete the properties
    result = await get_db().properties.delete_many(query)
    
    return {
        "message": f"Successfully deleted {result.deleted_count} properties",
        "deleted_count": result.deleted_count
    }

@api_router.post("/admin/properties/delete-colony")
async def delete_colony_properties(
    colony: str = Form(...),
    keep_surveyed: bool = Form(True),
    current_user: dict = Depends(get_current_user)
):
    """Delete all properties of a specific colony. Option to keep surveyed properties."""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Find properties in this colony
    query = {"$or": [
        {"colony": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}},
        {"ward": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}}
    ]}
    
    properties = await get_db().properties.find(query, {"id": 1, "_id": 0}).to_list(None)
    property_ids = [p["id"] for p in properties]
    
    if not property_ids:
        return {"message": "No properties found in this colony", "deleted_count": 0}
    
    # If keep_surveyed, exclude properties with submissions
    ids_to_delete = property_ids
    if keep_surveyed:
        submissions = await get_db().submissions.find(
            {"property_record_id": {"$in": property_ids}},
            {"property_record_id": 1, "_id": 0}
        ).to_list(None)
        surveyed_ids = set(s["property_record_id"] for s in submissions)
        ids_to_delete = [pid for pid in property_ids if pid not in surveyed_ids]
    
    if not ids_to_delete:
        return {"message": "All properties in this colony have surveys. Nothing deleted.", "deleted_count": 0, "kept_surveyed": len(property_ids)}
    
    # Delete properties
    result = await get_db().properties.delete_many({"id": {"$in": ids_to_delete}})
    
    # Clear cache
    await clear_map_cache()
    
    return {
        "message": f"Deleted {result.deleted_count} properties from {colony}",
        "deleted_count": result.deleted_count,
        "kept_surveyed": len(property_ids) - len(ids_to_delete) if keep_surveyed else 0
    }

@api_router.post("/admin/properties/delete-duplicates")
async def delete_duplicate_properties(
    colony: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Delete duplicate properties but KEEP the ones with survey submissions.
    Duplicates are identified by: property_id OR (owner_name + mobile)
    """
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Build query
    query = {}
    if colony and colony.strip():
        query["$or"] = [
            {"colony": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}},
            {"ward": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}}
        ]
    
    # Get all properties
    properties = await get_db().properties.find(query, {"_id": 0}).to_list(None)
    
    if not properties:
        return {"message": "No properties found", "deleted_count": 0}
    
    # Get all submissions to know which properties have surveys
    all_submissions = await get_db().submissions.find({}, {"property_record_id": 1, "_id": 0}).to_list(None)
    surveyed_property_ids = set(s["property_record_id"] for s in all_submissions)
    
    # Group properties by property_id and by owner+mobile
    by_property_id = {}
    by_owner_mobile = {}
    
    for prop in properties:
        pid = prop.get("property_id", "")
        owner = (prop.get("owner_name") or "").strip().upper()
        mobile = (prop.get("mobile") or "").strip()
        prop_uuid = prop.get("id")
        has_survey = prop_uuid in surveyed_property_ids
        
        # Group by property_id
        if pid:
            if pid not in by_property_id:
                by_property_id[pid] = []
            by_property_id[pid].append({"uuid": prop_uuid, "has_survey": has_survey, "prop": prop})
        
        # Group by owner + mobile
        if owner and mobile:
            key = f"{owner}_{mobile}"
            if key not in by_owner_mobile:
                by_owner_mobile[key] = []
            by_owner_mobile[key].append({"uuid": prop_uuid, "has_survey": has_survey, "prop": prop})
    
    # Find duplicates to delete (keep ones with survey, delete others)
    ids_to_delete = set()
    
    # Check property_id duplicates
    for pid, items in by_property_id.items():
        if len(items) > 1:
            # Keep the one with survey, or the first one if none have survey
            has_survey_items = [i for i in items if i["has_survey"]]
            if has_survey_items:
                # Keep all with survey, delete others
                for item in items:
                    if not item["has_survey"]:
                        ids_to_delete.add(item["uuid"])
            else:
                # Keep only the first one
                for item in items[1:]:
                    ids_to_delete.add(item["uuid"])
    
    # Check owner+mobile duplicates
    for key, items in by_owner_mobile.items():
        if len(items) > 1:
            has_survey_items = [i for i in items if i["has_survey"]]
            if has_survey_items:
                for item in items:
                    if not item["has_survey"]:
                        ids_to_delete.add(item["uuid"])
            else:
                for item in items[1:]:
                    ids_to_delete.add(item["uuid"])
    
    if not ids_to_delete:
        return {"message": "No duplicate properties found", "deleted_count": 0}
    
    # Delete duplicates
    result = await get_db().properties.delete_many({"id": {"$in": list(ids_to_delete)}})
    
    # Clear cache
    await clear_map_cache()
    
    return {
        "message": f"Deleted {result.deleted_count} duplicate properties (kept surveyed ones)",
        "deleted_count": result.deleted_count,
        "total_properties": len(properties),
        "remaining": len(properties) - result.deleted_count
    }

@api_router.post("/admin/properties/arrange-by-route")
async def arrange_properties_by_route(
    ward: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Arrange properties by GPS route using nearest neighbor algorithm"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {"latitude": {"$ne": None}, "longitude": {"$ne": None}}
    if ward and ward.strip():
        query["ward"] = ward
    
    # Get all properties with GPS
    properties = await get_db().properties.find(query, {"_id": 0}).to_list(None)
    
    if not properties:
        raise HTTPException(status_code=404, detail="No properties with GPS found")
    
    # Sort by GPS route using nearest neighbor algorithm
    sorted_props = []
    remaining = list(properties)
    
    if remaining:
        # Start from first property
        sorted_props.append(remaining.pop(0))
        
        while remaining:
            last = sorted_props[-1]
            last_lat, last_lon = last['latitude'], last['longitude']
            
            # Find nearest neighbor
            nearest_idx = 0
            nearest_dist = float('inf')
            
            for i, prop in enumerate(remaining):
                dist = haversine_distance(last_lat, last_lon, prop['latitude'], prop['longitude'])
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_idx = i
            
            sorted_props.append(remaining.pop(nearest_idx))
    
    # Update serial numbers based on route order
    for i, prop in enumerate(sorted_props):
        await get_db().properties.update_one(
            {"id": prop["id"]},
            {"$set": {"serial_number": i + 1, "route_ordered": True}}
        )
    
    return {
        "message": f"Arranged {len(sorted_props)} properties by GPS route",
        "total_arranged": len(sorted_props)
    }

@api_router.post("/admin/properties/save-arranged")
async def save_arranged_data(
    ward: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Save the current arrangement as the permanent serial numbers"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if ward and ward.strip():
        query["ward"] = ward
    
    # Get properties sorted by current serial_number
    properties = await get_db().properties.find(query, {"_id": 0}).sort("serial_number", 1).to_list(None)
    
    if not properties:
        raise HTTPException(status_code=404, detail="No properties found")
    
    # Re-assign serial numbers to ensure they're consecutive
    for i, prop in enumerate(properties):
        await get_db().properties.update_one(
            {"id": prop["id"]},
            {"$set": {"serial_number": i + 1, "arrangement_saved": True, "saved_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    return {
        "message": f"Saved arrangement for {len(properties)} properties",
        "total_saved": len(properties)
    }

@api_router.post("/admin/properties/download-pdf")
async def download_properties_pdf(
    ward: Optional[str] = None,
    sn_position: str = "top-right",
    sn_font_size: int = 48,
    sn_color: str = "red",
    current_user: dict = Depends(get_current_user)
):
    """Generate PDF with property list arranged by serial number"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if ward and ward.strip():
        query["ward"] = ward
    
    # Get properties sorted by serial_number
    properties = await get_db().properties.find(query, {"_id": 0}).sort("serial_number", 1).to_list(None)
    
    if not properties:
        raise HTTPException(status_code=404, detail="No properties found")
    
    # Generate PDF
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    colony_name = ward.replace(" ", "_") if ward else "all"
    pdf_filename = f"properties_{colony_name}_{timestamp}.pdf"
    pdf_path = UPLOAD_DIR / pdf_filename
    
    # Ensure uploads directory exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Create PDF document
    doc = SimpleDocTemplate(str(pdf_path), pagesize=A4)
    styles = getSampleStyleSheet()
    elements = []
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    elements.append(Paragraph(f"Property List - {ward or 'All Colonies'}", title_style))
    elements.append(Paragraph(f"Total: {len(properties)} properties | Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles['Normal']))
    elements.append(Spacer(1, 20))
    
    # Table data
    table_data = [['SN', 'Property ID', 'Owner Name', 'Mobile', 'Category', 'Area', 'Amount']]
    
    for prop in properties:
        table_data.append([
            str(prop.get('serial_number', '-')),
            prop.get('property_id', '-'),
            prop.get('owner_name', '-')[:20] if prop.get('owner_name') else '-',
            prop.get('mobile', '-'),
            prop.get('category', '-')[:10] if prop.get('category') else '-',
            prop.get('total_area', '-'),
            f"₹{prop.get('amount', '0')}"
        ])
    
    # Create table
    table = Table(table_data, colWidths=[30, 70, 100, 80, 60, 50, 60])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.darkblue),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
    ]))
    
    elements.append(table)
    doc.build(elements)
    
    # Verify file was created
    if not pdf_path.exists():
        raise HTTPException(status_code=500, detail="PDF generation failed")
    await persist_upload(pdf_filename)
    
    return {
        "message": f"Generated PDF with {len(properties)} properties",
        "filename": pdf_filename,
        "download_url": f"/api/uploads/{pdf_filename}"
    }

# Direct PDF download endpoint - More reliable for VPS
@api_router.get("/admin/properties/download-pdf/{filename}")
async def get_pdf_file(filename: str, current_user: dict = Depends(get_current_user)):
    """Direct download of generated PDF file"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    
    file_path = await ensure_upload_local(filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    
    return FileResponse(
        path=str(file_path),
        media_type='application/pdf',
        filename=filename,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )

@api_router.get("/admin/wards")
async def list_wards(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor access required")
    
    wards = await get_db().properties.distinct("ward")
    wards = [w for w in wards if w]
    return {"wards": wards}

# ============== DASHBOARD ROUTES ==============

@api_router.get("/admin/dashboard")
async def admin_dashboard(
    request: Request,
    date: str = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    na_values = [None, "", "NA", "N/A", "na", "n/a", "UNKNOWN", "unknown", "-", "nil"]
    
    if date:
        date_start = f"{date}T00:00:00"
        date_end = f"{date}T23:59:59"
        date_filter = {"submitted_at": {"$gte": date_start, "$lte": date_end}}
        
        # Today's submissions stats
        sub_pipeline = [
            {"$match": date_filter},
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "approved": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed"]]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$in": ["$status", ["Pending"]]}, 1, 0]}},
                "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}}
            }}
        ]
        sub_result = await town_db.submissions.aggregate(sub_pipeline).to_list(1)
        sub_stats = sub_result[0] if sub_result else {"total": 0, "approved": 0, "pending": 0, "rejected": 0}
        
        # Always get property totals from properties collection
        prop_pipeline = [
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "approved": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed"]]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, 1, 0]}},
                "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}},
                "colonies": {"$addToSet": "$colony"},
                "residential": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "residential", "options": "i"}}, 1, 0]}},
                "commercial": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "commercial", "options": "i"}}, 1, 0]}},
                "vacant_plot": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "vacant|plot", "options": "i"}}, 1, 0]}},
                "agriculture": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "agri", "options": "i"}}, 1, 0]}},
                "mix_use": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "mix", "options": "i"}}, 1, 0]}},
                "industrial": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "^Industrial$", "options": "i"}}, 1, 0]}},
                "institutional": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "institutional", "options": "i"}}, 1, 0]}},
                "special_category": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "special", "options": "i"}}, 1, 0]}},
                "owner_na": {"$sum": {"$cond": [{"$in": ["$owner_name", na_values]}, 1, 0]}},
                "mobile_na": {"$sum": {"$cond": [{"$in": ["$mobile", na_values]}, 1, 0]}}
            }}
        ]
        prop_result = await town_db.properties.aggregate(prop_pipeline).to_list(1)
        prop_stats = prop_result[0] if prop_result else {"total": 0, "approved": 0, "pending": 0, "rejected": 0, "colonies": []}
        
        total = prop_stats["total"]
        pending = prop_stats["pending"]
        approved = prop_stats["approved"]
        rejected = prop_stats["rejected"]
        colonies_count = len([c for c in prop_stats.get("colonies", []) if c])
        category_counts = {
            "residential": prop_stats.get("residential", 0),
            "commercial": prop_stats.get("commercial", 0),
            "vacant_plot": prop_stats.get("vacant_plot", 0),
            "agriculture": prop_stats.get("agriculture", 0),
            "mix_use": prop_stats.get("mix_use", 0),
            "industrial": prop_stats.get("industrial", 0),
            "institutional": prop_stats.get("institutional", 0),
            "special_category": prop_stats.get("special_category", 0)
        }
        owner_na = prop_stats.get("owner_na", 0)
        mobile_na = prop_stats.get("mobile_na", 0)
        
        # Store today's submission counts separately
        today_surveys = sub_stats["total"]
        today_approved = sub_stats["approved"]
        today_pending = sub_stats["pending"]
        today_rejected = sub_stats["rejected"]
    else:
        # All time: single aggregation for property counts with categories and NA
        pipeline = [
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "approved": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed"]]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, 1, 0]}},
                "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}},
                "colonies": {"$addToSet": "$colony"},
                "residential": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "residential", "options": "i"}}, 1, 0]}},
                "commercial": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "commercial", "options": "i"}}, 1, 0]}},
                "vacant_plot": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "vacant|plot", "options": "i"}}, 1, 0]}},
                "agriculture": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "agri", "options": "i"}}, 1, 0]}},
                "mix_use": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "mix", "options": "i"}}, 1, 0]}},
                "industrial": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "^Industrial$", "options": "i"}}, 1, 0]}},
                "institutional": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "institutional", "options": "i"}}, 1, 0]}},
                "special_category": {"$sum": {"$cond": [{"$regexMatch": {"input": {"$ifNull": ["$category", ""]}, "regex": "special", "options": "i"}}, 1, 0]}},
                "owner_na": {"$sum": {"$cond": [{"$in": ["$owner_name", na_values]}, 1, 0]}},
                "mobile_na": {"$sum": {"$cond": [{"$in": ["$mobile", na_values]}, 1, 0]}}
            }}
        ]
        result = await town_db.properties.aggregate(pipeline).to_list(1)
        stats = result[0] if result else {"total": 0, "approved": 0, "pending": 0, "rejected": 0, "colonies": []}
        total = stats["total"]
        approved = stats["approved"]
        pending = stats["pending"]
        rejected = stats["rejected"]
        colonies_count = len([c for c in stats.get("colonies", []) if c])
        category_counts = {
            "residential": stats.get("residential", 0),
            "commercial": stats.get("commercial", 0),
            "vacant_plot": stats.get("vacant_plot", 0),
            "agriculture": stats.get("agriculture", 0),
            "mix_use": stats.get("mix_use", 0),
            "industrial": stats.get("industrial", 0),
            "institutional": stats.get("institutional", 0),
            "special_category": stats.get("special_category", 0)
        }
        owner_na = stats.get("owner_na", 0)
        mobile_na = stats.get("mobile_na", 0)
    
    # Employee count
    town_code = request.headers.get("x-town-code")
    if town_code:
        town = await master_db.towns.find_one({"code": town_code}, {"_id": 0})
        if town:
            employees = await master_db.users.count_documents({
                "role": {"$ne": "ADMIN"},
                "assigned_town": town["id"]
            })
        else:
            employees = 0
    else:
        employees = await master_db.users.count_documents({"role": {"$ne": "ADMIN"}})
    
    return {
        "total": total,
        "approved": approved,
        "pending": pending,
        "rejected": rejected,
        "employees": employees,
        "colonies": colonies_count,
        "category": category_counts,
        "owner_na": owner_na,
        "mobile_na": mobile_na,
        "today_surveys": today_surveys if date else 0,
        "today_approved": today_approved if date else 0,
        "today_pending": today_pending if date else 0,
        "today_rejected": today_rejected if date else 0
    }

@api_router.get("/admin/employee-progress")
async def get_employee_progress(
    request: Request,
    date: str = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    today_start = get_today_start().isoformat()
    
    # Get employees for the current town
    town_code = request.headers.get("x-town-code")
    emp_filter = {"role": {"$ne": "ADMIN"}}
    if town_code:
        town = await master_db.towns.find_one({"code": town_code}, {"_id": 0})
        if town:
            emp_filter["assigned_town"] = town["id"]
    
    employees = await master_db.users.find(emp_filter, {"_id": 0}).to_list(100)
    
    # OPTIMIZED: Use aggregation pipeline instead of N+1 queries
    emp_ids = [e["id"] for e in employees]
    
    # Batch: Get property counts per employee using aggregation
    prop_pipeline = [
        {"$match": {"assigned_employee_id": {"$in": emp_ids}}},
        {"$group": {
            "_id": "$assigned_employee_id",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": [{"$in": ["$status", ["Completed", "Approved"]]}, 1, 0]}},
            "colonies": {"$addToSet": "$ward"}
        }}
    ]
    prop_stats_cursor = await town_db.properties.aggregate(prop_pipeline).to_list(None)
    prop_stats = {s["_id"]: s for s in prop_stats_cursor}
    
    # Batch: Get today's submissions per employee using aggregation
    sub_match = {"employee_id": {"$in": emp_ids}, "status": {"$ne": "Rejected"}}
    if date:
        date_start = f"{date}T00:00:00"
        date_end = f"{date}T23:59:59"
        sub_match["submitted_at"] = {"$gte": date_start, "$lte": date_end}
    else:
        sub_match["submitted_at"] = {"$gte": today_start}
    
    sub_pipeline = [
        {"$match": sub_match},
        {"$group": {"_id": "$employee_id", "count": {"$sum": 1}}}
    ]
    sub_stats_cursor = await town_db.submissions.aggregate(sub_pipeline).to_list(None)
    sub_stats = {s["_id"]: s["count"] for s in sub_stats_cursor}
    
    # Batch: Get OVERALL (all-time) submission counts per employee
    overall_pipeline = [
        {"$match": {"employee_id": {"$in": emp_ids}}},
        {"$group": {"_id": "$employee_id", "count": {"$sum": 1}}}
    ]
    overall_stats_cursor = await town_db.submissions.aggregate(overall_pipeline).to_list(None)
    overall_stats = {s["_id"]: s["count"] for s in overall_stats_cursor}
    
    progress = []
    for emp in employees:
        eid = emp["id"]
        ps = prop_stats.get(eid, {"total": 0, "completed": 0, "colonies": []})
        assigned_colonies = [c for c in ps.get("colonies", []) if c]
        
        progress.append({
            "employee_id": eid,
            "employee_name": emp["name"],
            "employee_mobile": emp.get("mobile", ""),
            "role": emp["role"],
            "total_assigned": ps["total"],
            "completed": ps["completed"],
            "overall_completed": overall_stats.get(eid, 0),
            "pending": ps["total"] - ps["completed"],
            "today_completed": sub_stats.get(eid, 0),
            "assigned_colonies": assigned_colonies,
            "colony_count": len(assigned_colonies)
        })
    
    return progress

@api_router.get("/admin/employee-progress/{employee_id}/colonies")
async def get_employee_colony_progress(employee_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Get detailed colony-wise progress for a specific employee"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    
    employee = await master_db.users.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    pipeline = [
        {"$match": {"assigned_employee_id": employee_id}},
        {"$group": {
            "_id": "$ward",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": [{"$in": ["$status", ["Completed", "Approved"]]}, 1, 0]}},
            "pending": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    colony_stats = await town_db.properties.aggregate(pipeline).to_list(None)
    
    colonies = []
    for c in colony_stats:
        if c["_id"]:
            percentage = round((c["completed"] / c["total"]) * 100) if c["total"] > 0 else 0
            colonies.append({
                "colony": c["_id"],
                "total": c["total"],
                "completed": c["completed"],
                "pending": c["pending"],
                "rejected": c["rejected"],
                "percentage": percentage
            })
    
    return {
        "employee_id": employee_id,
        "employee_name": employee["name"],
        "role": employee["role"],
        "colonies": colonies,
        "total_colonies": len(colonies)
    }

@api_router.post("/admin/employee/remove-from-colony")
async def remove_employee_from_colony(
    request: Request,
    employee_id: str = Form(...),
    colony: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    """Remove an employee from a specific colony - handles both single and multi-employee assignments"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = get_db()
    
    employee = await master_db.users.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    emp_name = employee.get("name", "Unknown")
    
    # Find ALL properties in this colony assigned to this employee (single or multi)
    properties = await town_db.properties.find({
        "ward": colony,
        "$or": [
            {"assigned_employee_id": employee_id},
            {"assigned_employee_ids": employee_id}
        ]
    }, {"_id": 0, "id": 1, "assigned_employee_ids": 1, "assigned_employee_id": 1}).to_list(None)
    
    if not properties:
        raise HTTPException(status_code=404, detail=f"No properties found for {emp_name} in {colony}")
    
    updated_count = 0
    for prop in properties:
        existing_emp_ids = prop.get("assigned_employee_ids") or []
        new_emp_ids = [eid for eid in existing_emp_ids if eid != employee_id]
        
        if new_emp_ids:
            # Still has other employees assigned
            all_employees = await master_db.users.find({"id": {"$in": new_emp_ids}}, {"_id": 0, "name": 1}).to_list(None)
            combined_names = ", ".join([e["name"] for e in all_employees])
            await town_db.properties.update_one(
                {"id": prop["id"]},
                {"$set": {
                    "assigned_employee_ids": new_emp_ids,
                    "assigned_employee_id": new_emp_ids[0],
                    "assigned_employee_name": combined_names
                }}
            )
        else:
            # No employees left, clear all assignment fields
            await town_db.properties.update_one(
                {"id": prop["id"]},
                {"$set": {
                    "assigned_employee_ids": [],
                    "assigned_employee_id": None,
                    "assigned_employee_name": None,
                    "assignment_date": None
                }}
            )
        updated_count += 1
    
    return {
        "message": f"Removed {emp_name} from {colony}",
        "properties_unassigned": updated_count
    }

# ============== SUBMISSIONS ROUTES ==============

@api_router.get("/admin/areas")
async def list_areas(request: Request, current_user: dict = Depends(get_current_user)):
    # Allow ADMIN, SUPERVISOR, and MC_OFFICER to view areas
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor access required")
    
    town_code = get_current_town_code()
    cache_key = f"areas_{town_code}"
    cached = colonies_cache.get(cache_key)
    if cached:
        return cached
    
    town_db = await get_town_data_db(request)
    areas = await town_db.properties.distinct("ward")
    areas = sorted([a for a in areas if a])
    result = {"areas": areas}
    colonies_cache.set(cache_key, result)
    return result

@api_router.get("/admin/towns")
async def list_towns(request: Request, current_user: dict = Depends(get_current_user)):
    """Get list of unique towns from properties"""
    # Allow ADMIN, SUPERVISOR, and MC_OFFICER to view towns
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor access required")
    
    town_db = await get_town_data_db(request)
    towns = await town_db.properties.distinct("town")
    towns = sorted([t for t in towns if t])
    return {"towns": towns}

@api_router.get("/admin/town-stats")
async def get_town_stats(request: Request, current_user: dict = Depends(get_current_user)):
    """Get town-wise property statistics for dashboard"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    pipeline = [
        {"$match": {"town": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {
            "_id": "$town",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": [{"$in": ["$status", ["Completed", "Approved"]]}, 1, 0]}},
            "pending": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, 1, 0]}},
            "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "In Progress"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}}
        }},
        {"$sort": {"total": -1}}
    ]
    
    result = await town_db.properties.aggregate(pipeline).to_list(None)
    towns = [
        {"name": r["_id"], "total": r["total"], "completed": r["completed"],
         "pending": r["pending"], "in_progress": r["in_progress"], "rejected": r["rejected"]}
        for r in result
    ]
    return {"towns": towns}

@api_router.get("/admin/submission-stats")
async def get_submission_stats(
    request: Request,
    date: str = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = await get_town_data_db(request)
    query = {}
    if date:
        date_start = f"{date}T00:00:00"
        date_end = f"{date}T23:59:59"
        query["submitted_at"] = {"$gte": date_start, "$lte": date_end}
    
    total = await town_db.submissions.count_documents(query)
    status_pipeline = [
        {"$match": query},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]
    status_counts = {s["_id"]: s["count"] for s in await town_db.submissions.aggregate(status_pipeline).to_list(None)}
    pending = status_counts.get("Pending", 0)
    approved = status_counts.get("Approved", 0)
    completed = status_counts.get("Completed", 0)
    rejected = status_counts.get("Rejected", 0)
    
    return {
        "total": total,
        "pending": pending + completed,
        "approved": approved,
        "rejected": rejected
    }

@api_router.get("/admin/submissions")
async def list_submissions(
    batch_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    colony: Optional[str] = None,  # Colony filter
    search: Optional[str] = None,  # Search by serial number, property ID, owner name
    special_condition: Optional[str] = None,  # house_locked, owner_denied, normal
    self_certified: Optional[str] = None,  # yes, no
    photo_status: Optional[str] = None,  # with_photos, without_photos
    duplicate_filter: Optional[str] = None,  # same_mobile, same_owner
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if employee_id and employee_id.strip():
        query["employee_id"] = employee_id
    if status and status.strip():
        query["status"] = status
    if date_from:
        query["submitted_at"] = {"$gte": date_from}
    if date_to:
        if "submitted_at" in query:
            query["submitted_at"]["$lte"] = date_to + "T23:59:59"
        else:
            query["submitted_at"] = {"$lte": date_to + "T23:59:59"}
    
    # Special condition filter (house_locked, owner_denied, normal)
    if special_condition and special_condition.strip():
        if special_condition == "normal":
            query["$or"] = [
                {"special_condition": {"$exists": False}},
                {"special_condition": None},
                {"special_condition": ""}
            ]
        else:
            query["special_condition"] = special_condition
    
    # Self certified filter
    if self_certified and self_certified.strip():
        if self_certified == "yes":
            query["self_certified"] = "Yes"
        elif self_certified == "no":
            query["$or"] = [
                {"self_certified": {"$exists": False}},
                {"self_certified": None},
                {"self_certified": ""},
                {"self_certified": "No"}
            ]
    
    # Photo status filter
    if photo_status and photo_status.strip():
        if photo_status == "with_photos":
            query["photos"] = {"$exists": True, "$nin": [[], None]}
        elif photo_status == "without_photos":
            query["$or"] = [
                {"photos": {"$exists": False}},
                {"photos": []},
                {"photos": None}
            ]
    
    # If search is provided, search in properties AND employees
    search_property_ids = None
    search_employee_ids = None
    if search and search.strip():
        search_term = search.strip()
        
        # Search in properties collection
        search_query = {
            "$or": [
                {"id": {"$regex": search_term, "$options": "i"}},
                {"property_id": {"$regex": search_term, "$options": "i"}},
                {"owner_name": {"$regex": search_term, "$options": "i"}},
                {"mobile": {"$regex": search_term, "$options": "i"}},
                {"bill_sr_no": {"$regex": search_term, "$options": "i"}}
            ]
        }
        # Try to search by serial number if it's a number
        try:
            serial_num = int(search_term)
            search_query["$or"].append({"serial_number": serial_num})
        except ValueError:
            pass
        
        matching_properties = await get_db().properties.find(search_query, {"id": 1, "_id": 0}).to_list(None)
        search_property_ids = [p["id"] for p in matching_properties]
        
        # Search in employees/users collection by name or username
        employee_search_query = {
            "$or": [
                {"name": {"$regex": search_term, "$options": "i"}},
                {"username": {"$regex": search_term, "$options": "i"}},
                {"mobile": {"$regex": search_term, "$options": "i"}}
            ]
        }
        matching_employees = await master_db.users.find(employee_search_query, {"id": 1, "_id": 0}).to_list(None)
        search_employee_ids = [e["id"] for e in matching_employees]
        
        # Build combined query - match either property OR employee
        if search_property_ids or search_employee_ids:
            search_conditions = []
            if search_property_ids:
                search_conditions.append({"property_record_id": {"$in": search_property_ids}})
            if search_employee_ids:
                search_conditions.append({"employee_id": {"$in": search_employee_ids}})
            
            if "$or" in query:
                # Combine with existing $or
                query["$and"] = [{"$or": query.pop("$or")}, {"$or": search_conditions}]
            else:
                query["$or"] = search_conditions
        else:
            # No matching properties or employees found
            return {
                "submissions": [],
                "total": 0,
                "page": page,
                "pages": 0
            }
    
    # If colony filter is provided, first get property IDs in that colony
    property_ids_in_colony = None
    if colony and colony.strip():
        properties_in_colony = await get_db().properties.find(
            {"ward": colony}, 
            {"id": 1, "_id": 0}
        ).to_list(None)
        property_ids_in_colony = [p["id"] for p in properties_in_colony]
        if property_ids_in_colony:
            if "property_record_id" in query:
                # Intersect with existing filter
                existing_ids = set(query["property_record_id"].get("$in", []))
                query["property_record_id"]["$in"] = list(existing_ids & set(property_ids_in_colony)) if existing_ids else property_ids_in_colony
            else:
                query["property_record_id"] = {"$in": property_ids_in_colony}
        else:
            # No properties in this colony, return empty
            return {
                "submissions": [],
                "total": 0,
                "page": page,
                "pages": 0
            }
    
    skip = (page - 1) * limit
    
    # Use estimated count for unfiltered queries (much faster)
    if not query:
        total = await get_db().submissions.estimated_document_count()
    else:
        total = await get_db().submissions.count_documents(query)
    
    submissions = await get_db().submissions.find(query, {"_id": 0}).sort("submitted_at", -1).skip(skip).limit(limit).to_list(limit)
    
    # OPTIMIZED: Batch fetch property details - only essential fields
    prop_ids = [s["property_record_id"] for s in submissions if s.get("property_record_id")]
    if prop_ids:
        props_cursor = await get_db().properties.find(
            {"id": {"$in": prop_ids}},
            {"_id": 0, "id": 1, "owner_name": 1, "mobile": 1, "ward": 1, "serial_number": 1, "bill_sr_no": 1, "property_id": 1, "colony": 1, "serial_na": 1, "latitude": 1, "longitude": 1, "amount": 1, "total_area": 1, "category": 1, "photo_url": 1}
        ).to_list(None)
        props_map = {p["id"]: p for p in props_cursor}
        
        # Also fetch from bills collection for missing data (amount, category, total_area)
        prop_pids = [p.get("property_id") for p in props_cursor if p.get("property_id")]
        bills_data = {}
        if prop_pids:
            bills_cursor = await get_db().bills.find(
                {"property_id": {"$in": prop_pids}},
                {"_id": 0, "property_id": 1, "total_outstanding": 1, "category": 1, "total_area": 1, "amount": 1}
            ).to_list(None)
            for b in bills_cursor:
                pid = b.get("property_id", "")
                if pid and pid not in bills_data:
                    bills_data[pid] = b
    else:
        props_map = {}
        bills_data = {}
    
    for sub in submissions:
        prop = props_map.get(sub.get("property_record_id"))
        if prop:
            pid = prop.get("property_id", "")
            bill = bills_data.get(pid, {})
            
            sub["property_owner_name"] = prop.get("owner_name", "")
            sub["property_mobile"] = prop.get("mobile", "")
            sub["property_address"] = prop.get("address", "")
            # Amount: prefer bill's total_outstanding > property amount
            prop_amount = prop.get("amount") or "0"
            bill_amount = bill.get("total_outstanding") or bill.get("amount") or ""
            sub["property_amount"] = bill_amount if bill_amount and bill_amount != "0" else prop_amount
            sub["property_ward"] = prop.get("ward", "")
            sub["colony"] = prop.get("colony") or prop.get("ward", "")
            # Area: prefer bill's total_area > property total_area
            sub["total_area"] = bill.get("total_area") or prop.get("total_area", "")
            # Category: prefer bill's category > property category
            sub["category"] = bill.get("category") or prop.get("category", "")
            sub["serial_number"] = prop.get("serial_number", 0)
            sub["bill_sr_no"] = prop.get("bill_sr_no", "")
            sub["property_serial_number"] = prop.get("serial_number", 0)
            sub["property_serial_na"] = prop.get("serial_na", False)
            sub["property_bill_sr_no"] = prop.get("bill_sr_no", "N/A")
            sub["property_photo_url"] = prop.get("photo_url", "")
            sub["property_latitude"] = prop.get("latitude")
            sub["property_longitude"] = prop.get("longitude")
    
    # Duplicate filter - applied after property enrichment
    if duplicate_filter and duplicate_filter.strip():
        if duplicate_filter == "same_mobile":
            submissions = [s for s in submissions if s.get("receiver_mobile") and s.get("property_mobile") and s["receiver_mobile"].strip() == s["property_mobile"].strip()]
        elif duplicate_filter == "same_owner":
            submissions = [s for s in submissions if s.get("receiver_name") and s.get("property_owner_name") and s["receiver_name"].strip().lower() == s["property_owner_name"].strip().lower()]
        total = len(submissions)
    
    return {
        "submissions": submissions,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@api_router.get("/admin/submissions/export")
async def export_submissions(
    request: Request,
    employee_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    colony: Optional[str] = None,
    search: Optional[str] = None,
    special_condition: Optional[str] = None,
    self_certified: Optional[str] = None,
    photo_status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Export submissions to Excel with all filters applied"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if employee_id and employee_id.strip():
        query["employee_id"] = employee_id
    if status and status.strip():
        query["status"] = status
    if date_from:
        query["submitted_at"] = {"$gte": date_from}
    if date_to:
        if "submitted_at" in query:
            query["submitted_at"]["$lte"] = date_to + "T23:59:59"
        else:
            query["submitted_at"] = {"$lte": date_to + "T23:59:59"}
    
    # Special condition filter
    if special_condition and special_condition.strip():
        if special_condition == "normal":
            query["$or"] = [
                {"special_condition": {"$exists": False}},
                {"special_condition": None},
                {"special_condition": ""}
            ]
        else:
            query["special_condition"] = special_condition
    
    # Self certified filter
    if self_certified and self_certified.strip():
        if self_certified == "yes":
            query["self_certified"] = "Yes"
        elif self_certified == "no":
            query["$or"] = [
                {"self_certified": {"$exists": False}},
                {"self_certified": None},
                {"self_certified": ""},
                {"self_certified": "No"}
            ]
    
    # Photo status filter
    if photo_status and photo_status.strip():
        if photo_status == "with_photos":
            query["photos"] = {"$exists": True, "$nin": [[], None]}
        elif photo_status == "without_photos":
            query["$or"] = [
                {"photos": {"$exists": False}},
                {"photos": []},
                {"photos": None}
            ]
    
    # Search filter
    if search and search.strip():
        search_term = search.strip()
        search_query = {
            "$or": [
                {"id": {"$regex": search_term, "$options": "i"}},
                {"owner_name": {"$regex": search_term, "$options": "i"}},
                {"mobile": {"$regex": search_term, "$options": "i"}},
                {"bill_sr_no": {"$regex": search_term, "$options": "i"}}
            ]
        }
        try:
            serial_num = int(search_term)
            search_query["$or"].append({"serial_number": serial_num})
        except ValueError:
            pass
        
        matching_properties = await get_db().properties.find(search_query, {"id": 1, "_id": 0}).to_list(None)
        search_property_ids = [p["id"] for p in matching_properties]
        if search_property_ids:
            query["property_record_id"] = {"$in": search_property_ids}
    
    # Colony filter
    if colony and colony.strip():
        properties_in_colony = await get_db().properties.find(
            {"ward": colony}, 
            {"id": 1, "_id": 0}
        ).to_list(None)
        property_ids_in_colony = [p["id"] for p in properties_in_colony]
        if property_ids_in_colony:
            if "property_record_id" in query:
                existing_ids = set(query["property_record_id"].get("$in", []))
                query["property_record_id"]["$in"] = list(existing_ids & set(property_ids_in_colony)) if existing_ids else property_ids_in_colony
            else:
                query["property_record_id"] = {"$in": property_ids_in_colony}
    
    # Fetch all submissions (no pagination for export)
    submissions = await get_db().submissions.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(None)
    
    # Enrich with property and employee details
    employee_cache = {}
    for sub in submissions:
        if sub.get("property_record_id"):
            prop = await get_db().properties.find_one({"id": sub["property_record_id"]}, {"_id": 0})
            if prop:
                sub["property_owner_name"] = prop.get("owner_name", "")
                sub["property_mobile"] = prop.get("mobile", "")
                sub["property_address"] = prop.get("address", "")
                sub["property_ward"] = prop.get("ward", "")
                sub["colony"] = prop.get("colony") or prop.get("ward", "")
                sub["serial_number"] = prop.get("serial_number", 0)
                sub["bill_sr_no"] = prop.get("bill_sr_no", "")
                sub["category"] = prop.get("category", "")
            
            # Fallback: If category still empty, try bills collection
            if not sub.get("category"):
                bill = await get_db().bills.find_one({"property_id": sub.get("property_id", sub.get("property_record_id", ""))}, {"category": 1, "_id": 0})
                if bill:
                    sub["category"] = bill.get("category", "")
        
        # Get employee name
        emp_id = sub.get("employee_id")
        if emp_id:
            if emp_id not in employee_cache:
                emp = await master_db.users.find_one({"id": emp_id}, {"name": 1, "_id": 0})
                employee_cache[emp_id] = emp.get("name", "Unknown") if emp else "Unknown"
            sub["employee_name"] = employee_cache[emp_id]
    
    # Create Excel file
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Submissions"
    
    # Get base URL for photos dynamically from request
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    base_url = os.environ.get("BASE_URL", f"{forwarded_proto}://{forwarded_host}")
    
    # Headers - Added Latitude, Longitude, Property Status, Property Use
    headers = [
        "Sr No", "Serial Number", "Bill Sr No", "Property ID", "Owner Name", "Owner Mobile",
        "Address", "Colony Name", "Category",
        "Receiver Name", "Receiver Mobile", "Relation",
        "House Status", "Property Use", "Special Condition",
        "Self Satisfied", "Self Certified",
        "Employee Name", "Survey Status",
        "Remarks", "Aadhar Number", "Family ID",
        "Original Lat", "Original Lon", "Survey Lat", "Survey Lon",
        "Submit Date", "Submit Time",
        "Photo 1", "Photo 2", "Photo 3", "Photo 4"
    ]
    
    # Style headers
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )
    
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border
    
    # Data rows
    for row_num, sub in enumerate(submissions, 2):
        special_cond = sub.get("special_condition", "")
        special_cond_display = (
            "Property Locked" if special_cond in ["property_locked", "house_locked"] else 
            "Owner Denied" if special_cond == "owner_denied" else 
            "Vacant Plot" if special_cond == "vacant_plot" else 
            "Wrong Location" if special_cond == "wrong_location" else 
            special_cond.replace("_", " ").title() if special_cond else ""
        )
        
        house_status = sub.get("house_status", "")
        house_status_display = house_status.replace("_", " ").title() if house_status else ""
        
        property_use = sub.get("property_use", "")
        property_use_display = (
            f"Other: {sub.get('property_use_remarks', '')}" if property_use == "other" else
            property_use.replace("_", " ").title() if property_use else ""
        )
        
        self_satisfied = sub.get("self_satisfied")
        self_satisfied_display = "Yes" if self_satisfied is True else ("No" if self_satisfied is False else "")
        
        self_cert = sub.get("self_cert_verified") or sub.get("self_certified")
        self_cert_display = "Yes" if self_cert is True else ("No" if self_cert is False else "")
        
        receiver_name = sub.get("receiver_name") or sub.get("respondent_name", "")
        receiver_mobile = sub.get("receiver_mobile") or sub.get("new_mobile") or sub.get("respondent_phone", "")
        
        photos = sub.get("photos", [])
        photo_urls = []
        for p in (photos or []):
            url = ""
            if isinstance(p, dict) and p.get("file_url"):
                url = p.get("file_url")
            elif isinstance(p, str):
                url = p
            if url:
                if url.startswith("/"):
                    photo_urls.append(f"{base_url}{url}")
                elif url.startswith("http"):
                    photo_urls.append(f"{base_url}/api/proxy-image?url={quote(url, safe='')}")
        while len(photo_urls) < 4:
            photo_urls.append("")
        
        submitted_at = sub.get("submitted_at", "")
        submitted_date = ""
        submitted_time = ""
        if submitted_at:
            try:
                from datetime import datetime as dt_parse
                from datetime import timedelta
                if "T" in str(submitted_at):
                    dt_obj = dt_parse.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
                    ist = dt_obj + timedelta(hours=5, minutes=30)
                    submitted_date = ist.strftime("%d/%m/%Y")
                    submitted_time = ist.strftime("%I:%M %p")
                else:
                    submitted_date = str(submitted_at)[:10]
            except Exception:
                submitted_date = str(submitted_at)[:10] if len(str(submitted_at)) >= 10 else str(submitted_at)
        
        prop_lat = sub.get("property_latitude", "")
        prop_lon = sub.get("property_longitude", "")
        
        row_data = [
            row_num - 1,
            sub.get("serial_number", ""),
            sub.get("bill_sr_no", ""),
            sub.get("property_id", sub.get("property_record_id", "")),
            sub.get("property_owner_name", ""),
            sub.get("property_mobile", ""),
            sub.get("property_address", ""),
            sub.get("colony", sub.get("property_ward", "")),
            sub.get("category", ""),
            receiver_name,
            receiver_mobile,
            sub.get("relation", ""),
            house_status_display,
            property_use_display,
            special_cond_display,
            self_satisfied_display,
            self_cert_display,
            sub.get("employee_name", ""),
            sub.get("status", "Pending"),
            sub.get("remarks", sub.get("review_remarks", "")),
            sub.get("aadhar_number", ""),
            sub.get("family_id", ""),
            prop_lat,
            prop_lon,
            sub.get("latitude", ""),
            sub.get("longitude", ""),
            submitted_date,
            submitted_time,
            photo_urls[0],
            photo_urls[1],
            photo_urls[2],
            photo_urls[3],
        ]
        
        for col, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col, value=value)
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='left')
            if col >= 29 and col <= 32 and value and str(value).startswith("http"):
                cell.hyperlink = str(value)
                cell.font = Font(color="0563C1", underline="single")
    
    column_widths = [6, 10, 10, 12, 22, 14, 30, 18, 14, 20, 14, 12, 12, 14, 16, 10, 10, 16, 10, 25, 14, 12, 12, 12, 12, 12, 12, 12, 16, 16, 16, 16]
    for col, width in enumerate(column_widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = width
    
    # Save to bytes
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"submissions_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.post("/admin/submissions/approve")
async def approve_reject_submission(data: SubmissionApproval, request: Request, current_user: dict = Depends(get_current_user)):
    # Allow ADMIN, SUPERVISOR, and MC_OFFICER to approve/reject
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin/Supervisor/MC Officer access required")
    
    submission = await get_db().submissions.find_one({"id": data.submission_id}, {"_id": 0})
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    if data.action == "REJECT" and not data.remarks:
        raise HTTPException(status_code=400, detail="Remarks are required for rejection")
    
    new_status = "Approved" if data.action == "APPROVE" else ("Rejected" if data.action == "REJECT" else "Pending")
    
    update_data = {
        "status": new_status,
        "reviewed_by": current_user["id"],
        "reviewed_at": datetime.now(timezone.utc).isoformat()
    }
    
    if data.remarks:
        update_data["review_remarks"] = data.remarks
    elif data.action == "APPROVE":
        update_data["review_remarks"] = ""
    
    await get_db().submissions.update_one(
        {"id": data.submission_id},
        {"$set": update_data}
    )
    
    # Update property status and include rejection remarks
    prop_update = {"status": new_status}
    
    # Lock the property if approved (prevents re-submission)
    if data.action == "APPROVE":
        prop_update["locked"] = True
        prop_update["locked_at"] = datetime.now(timezone.utc).isoformat()
        prop_update["locked_by"] = current_user["id"]
    elif data.action == "REJECT":
        if data.remarks:
            prop_update["reject_remarks"] = data.remarks
        prop_update["locked"] = False
        # Reset property to Pending so it's available for re-submission
        prop_update["status"] = "Pending"
        # Keep the rejected submission for audit trail (do NOT delete)
    elif data.action == "PENDING":
        prop_update["locked"] = False
    
    await get_db().properties.update_one(
        {"id": submission["property_record_id"]},
        {"$set": prop_update}
    )
    await record_audit(current_user, f"SUBMISSION_{data.action}", "submission", data.submission_id,
                       {"property_record_id": submission.get("property_record_id"), "before": {"status": submission.get("status")},
                        "after": {"status": new_status}, "remarks": data.remarks}, request)
    
    if data.action == "REJECT":
        return {"message": "Submission rejected and property reset to Pending for re-submission"}
    return {"message": f"Submission {new_status.lower()}"}


@api_router.post("/admin/submissions/approve-all")
async def approve_all_submissions(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Approve ALL submissions matching filters in one go"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    body = await request.json()
    query = {}
    
    if body.get("status"):
        query["status"] = body["status"]
    if body.get("colony") and body["colony"].strip():
        query["colony"] = body["colony"]
    if body.get("employee_id") and body["employee_id"].strip():
        query["employee_id"] = body["employee_id"]
    
    # Approve all matching submissions
    sub_result = await get_db().submissions.update_many(
        query,
        {"$set": {
            "status": "Approved",
            "reviewed_by": current_user["id"],
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "review_remarks": ""
        }}
    )
    
    # Also update properties - get all matching submission property_record_ids
    matching_subs = await get_db().submissions.find(
        query, {"_id": 0, "property_record_id": 1}
    ).to_list(None)
    prop_ids = [s["property_record_id"] for s in matching_subs if s.get("property_record_id")]
    
    if prop_ids:
        await get_db().properties.update_many(
            {"id": {"$in": prop_ids}},
            {"$set": {
                "status": "Approved",
                "locked": True,
                "locked_at": datetime.now(timezone.utc).isoformat(),
                "locked_by": current_user["id"]
            }}
        )
    
    await record_audit(current_user, "SUBMISSION_APPROVE_ALL", "submission", None,
                       {"filters": query, "count": sub_result.modified_count}, request)
    return {"message": f"Approved {sub_result.modified_count} submissions", "count": sub_result.modified_count}


@api_router.post("/admin/cleanup-rejected")
async def cleanup_rejected_submissions(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Delete all rejected submissions and reset their properties to Pending"""
    if current_user["role"] not in ["ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = get_db()
    
    # Find all rejected submissions
    rejected_subs = await town_db.submissions.find(
        {"status": "Rejected"}, {"_id": 0, "id": 1, "property_record_id": 1}
    ).to_list(None)
    
    if not rejected_subs:
        return {"message": "No rejected submissions found", "deleted": 0, "properties_reset": 0}
    
    prop_ids = [s["property_record_id"] for s in rejected_subs if s.get("property_record_id")]
    
    # Delete all rejected submissions
    del_result = await town_db.submissions.delete_many({"status": "Rejected"})
    
    # Reset properties to Pending
    prop_result = await town_db.properties.update_many(
        {"id": {"$in": prop_ids}},
        {"$set": {"status": "Pending", "locked": False, "reject_remarks": None}}
    )
    
    await record_audit(current_user, "SUBMISSIONS_CLEANUP_REJECTED", "submission", None,
                       {"deleted": del_result.deleted_count, "properties_reset": prop_result.modified_count}, request)
    return {
        "message": f"Deleted {del_result.deleted_count} rejected submissions, reset {prop_result.modified_count} properties to Pending",
        "deleted": del_result.deleted_count,
        "properties_reset": prop_result.modified_count
    }

@api_router.put("/admin/submissions/{submission_id}")
async def edit_submission(
    submission_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in SUBMISSION_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required for editing submissions")
    
    data = await request.json()
    
    update_data = {}
    allowed_fields = [
        "receiver_name", "receiver_mobile", "relation",
        "correct_colony_name", "self_satisfied",
        "remarks", "latitude", "longitude",
        "new_owner_name", "new_mobile",
        "special_condition", "house_status",
        "property_use", "property_use_remarks",
        "status"
    ]
    
    for field in allowed_fields:
        if field in data:
            value = data[field]
            # Convert latitude/longitude to float if provided
            if field in ["latitude", "longitude"] and value:
                try:
                    update_data[field] = float(value)
                except ValueError:
                    pass
            else:
                update_data[field] = value
    
    # Handle photos update
    if "photos" in data:
        update_data["photos"] = data["photos"]
    
    update_data["edited_by"] = current_user["id"]
    update_data["edited_at"] = datetime.now(timezone.utc).isoformat()
    
    await get_db().submissions.update_one(
        {"id": submission_id},
        {"$set": update_data}
    )
    await record_audit(current_user, "SUBMISSION_EDIT", "submission", submission_id,
                       {"fields": sorted(k for k in update_data if k not in ("edited_by", "edited_at"))}, request)
    
    return {"message": "Submission updated"}

@api_router.post("/admin/submissions/upload-photo")
async def upload_submission_photo(
    file: UploadFile = File(...),
    submission_id: str = Form(...),
    photo_type: str = Form("HOUSE"),
    current_user: dict = Depends(get_current_user)
):
    """Upload a new photo to a submission (admin only) - saves to GridFS"""
    if current_user["role"] not in SUBMISSION_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required for editing submissions")
    
    # Read file content
    content = await file.read()
    
    # Save to GridFS
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{submission_id}_{photo_type.lower()}_{timestamp}.jpg"
    file_id = await save_file_to_gridfs(content, filename, file.content_type or "image/jpeg")
    
    file_url = make_file_url(file_id)
    
    # Add photo to submission
    photo_data = {
        "file_url": file_url,
        "file_id": file_id,
        "photo_type": photo_type
    }
    
    await get_db().submissions.update_one(
        {"id": submission_id},
        {"$push": {"photos": photo_data}}
    )
    
    return {"message": "Photo uploaded", "file_url": file_url, "file_id": file_id}

@api_router.put("/admin/properties/{property_id}")
async def edit_property(
    property_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    data = await request.json()
    
    update_data = {}
    allowed_fields = [
        "property_id", "owner_name", "mobile", "address", "amount", "ward"
    ]
    
    for field in allowed_fields:
        if field in data and data[field]:
            update_data[field] = data[field]
    
    update_data["edited_by"] = current_user["id"]
    update_data["edited_at"] = datetime.now(timezone.utc).isoformat()
    
    await get_db().properties.update_one(
        {"id": property_id},
        {"$set": update_data}
    )
    
    return {"message": "Property updated"}

# ============== EXPORT ROUTES ==============

@api_router.get("/admin/export")
async def export_data(
    request: Request,
    batch_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    status: Optional[str] = "Approved",
    colony: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in EXPORT_ROLES:
        raise HTTPException(status_code=403, detail="Export access required (Admin or MC Officer)")
    
    prop_query = {}
    if batch_id and batch_id.strip():
        prop_query["batch_id"] = batch_id
    if employee_id and employee_id.strip():
        prop_query["assigned_employee_id"] = employee_id
    if colony and colony.strip():
        prop_query["ward"] = colony
    
    submission_query = {}
    if status and status.strip():
        submission_query["status"] = status
    if date_from:
        submission_query["submitted_at"] = {"$gte": date_from}
    if date_to:
        if "submitted_at" in submission_query:
            submission_query["submitted_at"]["$lte"] = date_to
        else:
            submission_query["submitted_at"] = {"$lte": date_to}
    
    if submission_query:
        submissions = await get_db().submissions.find(submission_query, {"property_record_id": 1, "_id": 0}).to_list(100000)
        property_ids = [s["property_record_id"] for s in submissions]
        if not property_ids:
            wb = Workbook()
            ws = wb.active
            ws.cell(row=1, column=1, value="No submissions found matching the filters")
            export_path = UPLOAD_DIR / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            wb.save(export_path)
            return FileResponse(path=str(export_path), filename=f"property_survey_export_{datetime.now().strftime('%Y%m%d')}.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if "id" in prop_query:
            existing_ids = set(prop_query["id"]["$in"]) if isinstance(prop_query["id"], dict) else {prop_query["id"]}
            prop_query["id"] = {"$in": list(existing_ids.intersection(set(property_ids)))}
        else:
            prop_query["id"] = {"$in": property_ids}
    
    properties = await get_db().properties.find(prop_query, {"_id": 0}).to_list(100000)
    
    # Batch fetch submissions
    prop_ids = [p["id"] for p in properties]
    all_subs = await get_db().submissions.find({"property_record_id": {"$in": prop_ids}}, {"_id": 0}).to_list(100000)
    sub_map = {s["property_record_id"]: s for s in all_subs}
    
    base_url = str(os.environ.get("BASE_URL", "")).rstrip("/")
    if not base_url:
        fwd_proto = request.headers.get("x-forwarded-proto", "https")
        fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
        base_url = f"{fwd_proto}://{fwd_host}"
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Property Survey Data"
    
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    thin_border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    
    headers = [
        "Sr No", "Property ID", "Serial No", "Bill Sr No", "Owner Name", "Owner Mobile", "Address",
        "Total Area", "Amount", "Colony Name", "Category", "Assigned Employee",
        "Receiver Name", "Receiver Mobile", "Relation",
        "House Status", "Property Use", "Special Condition",
        "Self Satisfied", "Self Certified", "Employee Name", "Survey Status",
        "Remarks", "Aadhar Number", "Family ID",
        "Original Lat", "Original Lon", "Survey Lat", "Survey Lon",
        "Submit Date", "Submit Time",
        "Photo 1", "Photo 2", "Photo 3", "Photo 4",
        "Approval Status", "Review Remarks", "Ward No"
    ]
    
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border
    
    for row_idx, prop in enumerate(properties, 2):
        sub = sub_map.get(prop["id"], {})
        
        # Special condition
        sc = sub.get("special_condition", "")
        sc_display = ("Property Locked" if sc in ["property_locked", "house_locked"] else 
                      "Owner Denied" if sc == "owner_denied" else
                      "Vacant Plot" if sc == "vacant_plot" else
                      "Wrong Location" if sc == "wrong_location" else
                      sc.replace("_", " ").title() if sc else "")
        
        house_st = sub.get("house_status", "")
        house_display = house_st.replace("_", " ").title() if house_st else ""
        
        prop_use = sub.get("property_use", "")
        prop_use_display = (f"Other: {sub.get('property_use_remarks','')}" if prop_use == "other" else
                            prop_use.replace("_", " ").title() if prop_use else "")
        
        self_sat = sub.get("self_satisfied")
        self_sat_d = "Yes" if self_sat is True else ("No" if self_sat is False else "")
        
        self_cert = sub.get("self_cert_verified") or sub.get("self_certified")
        self_cert_d = "Yes" if self_cert is True else ("No" if self_cert is False else "")
        
        recv_name = sub.get("receiver_name") or sub.get("respondent_name", "")
        recv_mobile = sub.get("receiver_mobile") or sub.get("new_mobile") or sub.get("respondent_phone", "")
        
        # Photos - local photos direct, external via proxy
        photos = sub.get("photos", [])
        photo_urls = []
        for p in (photos or []):
            url = ""
            if isinstance(p, dict) and p.get("file_url"):
                url = p["file_url"]
            elif isinstance(p, str):
                url = p
            if url:
                if url.startswith("/"):
                    photo_urls.append(f"{base_url}{url}")
                elif url.startswith("http"):
                    photo_urls.append(f"{base_url}/api/proxy-image?url={quote(url, safe='')}")
        while len(photo_urls) < 4:
            photo_urls.append("")
        
        # Date/Time IST
        submitted_at = sub.get("submitted_at", "")
        sub_date = ""
        sub_time = ""
        if submitted_at:
            try:
                from datetime import datetime as dt_p
                from datetime import timedelta as td
                if "T" in str(submitted_at):
                    dt_obj = dt_p.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
                    ist = dt_obj + td(hours=5, minutes=30)
                    sub_date = ist.strftime("%d/%m/%Y")
                    sub_time = ist.strftime("%I:%M %p")
                else:
                    sub_date = str(submitted_at)[:10]
            except Exception:
                sub_date = str(submitted_at)[:10]
        
        row = [
            row_idx - 1,
            prop.get("property_id", ""),
            prop.get("serial_number", ""),
            prop.get("bill_sr_no", ""),
            prop.get("owner_name", ""),
            prop.get("mobile", ""),
            prop.get("address", ""),
            prop.get("total_area", ""),
            prop.get("amount", ""),
            prop.get("colony", ""),
            prop.get("category", ""),
            prop.get("assigned_employee_name", ""),
            recv_name,
            recv_mobile,
            sub.get("relation", ""),
            house_display,
            prop_use_display,
            sc_display,
            self_sat_d,
            self_cert_d,
            sub.get("employee_name", ""),
            prop.get("status", ""),
            sub.get("remarks", ""),
            sub.get("aadhar_number", ""),
            sub.get("family_id", ""),
            prop.get("latitude", ""),
            prop.get("longitude", ""),
            sub.get("latitude", ""),
            sub.get("longitude", ""),
            sub_date,
            sub_time,
            photo_urls[0],
            photo_urls[1],
            photo_urls[2],
            photo_urls[3],
            sub.get("status", ""),
            sub.get("review_remarks", ""),
            (ward_master.ward_for_colony(prop.get("colony"))
             or (str(prop.get("ward")).strip() if str(prop.get("ward", "")).strip().isdigit() else "")),
        ]
        
        for col, value in enumerate(row, 1):
            cell = ws.cell(row=row_idx, column=col, value=value)
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='left')
            if col >= 32 and col <= 35 and value and str(value).startswith("http"):
                cell.hyperlink = str(value)
                cell.font = Font(color="0563C1", underline="single")
    
    col_widths = [6, 12, 8, 10, 22, 14, 30, 10, 10, 18, 14, 16, 20, 14, 12, 12, 14, 16, 10, 10, 16, 10, 25, 14, 12, 12, 12, 12, 12, 12, 12, 16, 16, 16, 16, 10, 25, 8]
    for col, w in enumerate(col_widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w
    
    export_path = UPLOAD_DIR / f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    wb.save(export_path)
    
    return FileResponse(
        path=str(export_path),
        filename=f"property_survey_export_{datetime.now().strftime('%Y%m%d')}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

# Helper function to add watermark to photo
def add_watermark_to_photo(photo_path, latitude, longitude, submitted_at):
    try:
        img = PILImage.open(photo_path)
        
        # Resize large images for PDF compression (max 800px wide)
        max_size = 800
        if img.width > max_size or img.height > max_size:
            ratio = min(max_size / img.width, max_size / img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, PILImage.LANCZOS)
        
        draw = ImageDraw.Draw(img)
        
        if isinstance(submitted_at, str):
            try:
                dt = datetime.fromisoformat(submitted_at.replace('Z', '+00:00'))
            except (ValueError, TypeError):
                dt = datetime.now()
        else:
            dt = submitted_at or datetime.now()
        
        date_str = dt.strftime("%d/%m/%Y")
        time_str = dt.strftime("%I:%M:%S %p")
        
        watermark_lines = [
            f"Date: {date_str}",
            f"Time: {time_str}",
            f"Lat: {latitude:.6f}" if latitude else "Lat: N/A",
            f"Long: {longitude:.6f}" if longitude else "Long: N/A"
        ]
        
        font_size = max(14, min(img.width, img.height) // 30)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()
        
        padding = font_size // 2
        line_height = font_size + 4
        
        max_text_width = max([draw.textlength(line, font=font) for line in watermark_lines])
        box_width = int(max_text_width + padding * 2)
        box_height = line_height * len(watermark_lines) + padding * 2
        
        box_x = padding
        box_y = img.height - box_height - padding
        
        overlay = PILImage.new('RGBA', img.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle(
            [box_x, box_y, box_x + box_width, box_y + box_height],
            fill=(0, 0, 0, 180)
        )
        
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        img = PILImage.alpha_composite(img, overlay)
        draw = ImageDraw.Draw(img)
        
        for i, line in enumerate(watermark_lines):
            draw.text(
                (box_x + padding, box_y + padding + i * line_height),
                line,
                font=font,
                fill=(255, 255, 255, 255)
            )
        
        img = img.convert('RGB')
        
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
        img.save(temp_file.name, 'JPEG', quality=45, optimize=True)
        return temp_file.name
    except Exception as e:
        logger.error(f"Error adding watermark: {e}")
        return photo_path

@api_router.get("/admin/export-pdf")
async def export_pdf(
    batch_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    status: Optional[str] = "Approved",  # Default to Approved
    colony: Optional[str] = None,  # Colony filter
    date_from: Optional[str] = None,  # Date filter
    date_to: Optional[str] = None,  # Date filter
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] not in EXPORT_ROLES:
        raise HTTPException(status_code=403, detail="Export access required (Admin or MC Officer)")
    
    # Build submission query with status and date filters
    submission_query = {"status": status if status and status.strip() else "Approved"}
    if date_from:
        submission_query["submitted_at"] = {"$gte": date_from}
    if date_to:
        if "submitted_at" in submission_query:
            submission_query["submitted_at"]["$lte"] = date_to
        else:
            submission_query["submitted_at"] = {"$lte": date_to}
    
    submissions = await get_db().submissions.find(submission_query, {"_id": 0}).to_list(10000)
    
    if not submissions:
        # Return empty PDF with message
        pdf_path = UPLOAD_DIR / f"survey_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        doc = SimpleDocTemplate(str(pdf_path), pagesize=A4)
        styles = getSampleStyleSheet()
        story = [Paragraph("No submissions found matching the filters", styles['Heading1'])]
        doc.build(story)
        return FileResponse(
            path=str(pdf_path),
            filename=f"approved_survey_report_{datetime.now().strftime('%Y%m%d')}.pdf",
            media_type="application/pdf"
        )
    
    # Get property IDs from submissions
    property_ids = [s["property_record_id"] for s in submissions]
    
    # Build property query
    prop_query = {"id": {"$in": property_ids}}
    if batch_id and batch_id.strip():
        prop_query["batch_id"] = batch_id
    if employee_id and employee_id.strip():
        prop_query["assigned_employee_id"] = employee_id
    if colony and colony.strip():
        prop_query["ward"] = colony
    
    properties = await get_db().properties.find(prop_query, {"_id": 0}).to_list(10000)
    
    pdf_path = UPLOAD_DIR / f"survey_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=15*mm,
        bottomMargin=15*mm
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('CustomTitle', parent=styles['Heading1'], fontSize=14, spaceAfter=10, alignment=TA_CENTER, textColor=colors.HexColor('#0f172a'))
    heading_style = ParagraphStyle('CustomHeading', parent=styles['Heading2'], fontSize=11, spaceAfter=5, textColor=colors.HexColor('#1e40af'))
    normal_style = ParagraphStyle('CustomNormal', parent=styles['Normal'], fontSize=8, spaceAfter=3)
    
    story = []
    
    story.append(Paragraph("PHED Survey & Notice Distribution Report", title_style))
    story.append(Paragraph(f"Generated on: {datetime.now().strftime('%d/%m/%Y %I:%M %p')}", normal_style))
    story.append(Spacer(1, 20))
    
    for prop in properties:
        submission = await get_db().submissions.find_one({"property_record_id": prop["id"]}, {"_id": 0})
        
        if not submission:
            continue
        
        story.append(Paragraph(f"Property ID: {prop.get('property_id', 'N/A')}", heading_style))
        
        # Special condition display
        sc = submission.get("special_condition", "")
        sc_display = ("Property Locked" if sc in ["property_locked", "house_locked"] else 
                      "Owner Denied" if sc == "owner_denied" else
                      "Vacant Plot" if sc == "vacant_plot" else
                      "Wrong Location" if sc == "wrong_location" else
                      sc.replace("_", " ").title() if sc else "N/A")
        
        house_st = submission.get("house_status", "")
        house_display = house_st.replace("_", " ").title() if house_st else "N/A"
        
        prop_use = submission.get("property_use", "")
        prop_use_display = (f"Other: {submission.get('property_use_remarks','')}" if prop_use == "other" else
                            prop_use.replace("_", " ").title() if prop_use else "N/A")
        
        self_sat = submission.get("self_satisfied", "")
        self_sat_d = "Yes" if self_sat in [True, "yes", "Yes"] else ("No" if self_sat in [False, "no", "No"] else str(self_sat) if self_sat else "N/A")
        
        # Property Info table
        prop_data = [
            ["Owner Name", prop.get("owner_name", "N/A")],
            ["Mobile", prop.get("mobile", "N/A")],
            ["Address", prop.get("address", "N/A")],
            ["Colony Name", prop.get("ward", "N/A")],
            ["Category", prop.get("category", "N/A")],
            ["Total Area", str(prop.get("total_area", "N/A"))],
            ["Amount", str(prop.get("amount", "N/A"))],
            ["Serial No", str(prop.get("serial_number", "N/A"))],
            ["Bill Sr No", str(prop.get("bill_sr_no", "N/A"))],
            ["Original Latitude", str(prop.get("latitude", "N/A"))],
            ["Original Longitude", str(prop.get("longitude", "N/A"))],
        ]
        
        prop_table = Table(prop_data, colWidths=[75*mm, 95*mm])
        prop_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#0f172a')),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('PADDING', (0, 0), (-1, -1), 5),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(prop_table)
        story.append(Spacer(1, 6))
        
        # Submit date/time IST
        submitted_at = submission.get("submitted_at", "")
        sub_date_time = "N/A"
        if submitted_at:
            try:
                from datetime import datetime as dt_p, timedelta as td
                if "T" in str(submitted_at):
                    dt_obj = dt_p.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
                    ist = dt_obj + td(hours=5, minutes=30)
                    sub_date_time = ist.strftime("%d/%m/%Y %I:%M %p")
                else:
                    sub_date_time = str(submitted_at)[:10]
            except Exception:
                sub_date_time = str(submitted_at)[:10]
        
        story.append(Paragraph("Survey Information", heading_style))
        survey_data = [
            ["Receiver Name", submission.get("receiver_name", "N/A")],
            ["Receiver Mobile", submission.get("new_mobile", submission.get("receiver_mobile", "N/A"))],
            ["Relation", submission.get("relation", "N/A")],
            ["House Status", house_display],
            ["Property Use", prop_use_display],
            ["Special Condition", sc_display],
            ["Self Satisfied", self_sat_d],
            ["Submitted By", submission.get("employee_name", "N/A")],
            ["Submitted At", sub_date_time],
            ["Survey Latitude", str(submission.get("latitude", "N/A"))],
            ["Survey Longitude", str(submission.get("longitude", "N/A"))],
            ["Status", submission.get("status", "Pending")],
        ]
        
        if submission.get("remarks"):
            survey_data.append(["Remarks", submission.get("remarks")])
        if submission.get("review_remarks"):
            survey_data.append(["Review Remarks", submission.get("review_remarks")])
        if submission.get("aadhar_number"):
            survey_data.append(["Aadhar Number", submission.get("aadhar_number")])
        if submission.get("family_id"):
            survey_data.append(["Family ID", submission.get("family_id")])
        
        survey_table = Table(survey_data, colWidths=[75*mm, 95*mm])
        survey_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#0f172a')),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('PADDING', (0, 0), (-1, -1), 5),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(survey_table)
        story.append(Spacer(1, 8))
        
        photos = submission.get("photos", [])
        if photos:
            story.append(Paragraph("Photo Evidence (with GPS & Timestamp)", heading_style))
            
            for photo in photos:
                photo_url = photo.get("file_url", "")
                photo_type = photo.get("photo_type", "PHOTO")
                file_id = photo.get("file_id")
                
                temp_photo_path = None
                
                # Handle GridFS files (new format with town code or legacy)
                if file_id or photo_url.startswith("/api/file/"):
                    try:
                        if file_id:
                            grid_file_id = file_id
                        else:
                            # Parse: /api/file/{file_id} or /api/file/{town_code}/{file_id}
                            parts = photo_url.replace("/api/file/", "").split("/")
                            grid_file_id = parts[-1]  # last part is always file_id
                        
                        # Try current context DB first
                        content, filename, _ = await get_file_from_gridfs(grid_file_id)
                        
                        # If not found, try with town code from URL
                        if content is None and len(parts) > 1 if not file_id else False:
                            town_code_from_url = parts[0]
                            town_fs_temp = get_town_gridfs(town_code_from_url)
                            grid_out = await town_fs_temp.open_download_stream(ObjectId(grid_file_id))
                            content = await grid_out.read()
                            filename = grid_out.filename
                        
                        if content:
                            temp_photo_path = UPLOAD_DIR / f"temp_pdf_{uuid.uuid4()}{Path(filename).suffix}"
                            async with aiofiles.open(temp_photo_path, 'wb') as f:
                                await f.write(content)
                    except Exception as e:
                        logger.error(f"Error fetching GridFS photo: {e}")
                
                # Handle legacy local files
                elif photo_url.startswith("/api/uploads/"):
                    filename = photo_url.replace("/api/uploads/", "")
                    photo_path = UPLOAD_DIR / filename
                    if photo_path.exists():
                        temp_photo_path = photo_path
                
                if temp_photo_path and temp_photo_path.exists():
                    watermarked_path = add_watermark_to_photo(
                        str(temp_photo_path),
                        submission.get("latitude"),
                        submission.get("longitude"),
                        submission.get("submitted_at")
                    )
                    
                    try:
                        img = RLImage(watermarked_path, width=65*mm, height=50*mm)
                        story.append(Paragraph(f"<b>{photo_type}</b>", normal_style))
                        story.append(img)
                        story.append(Spacer(1, 5))
                    except Exception as e:
                        logger.error(f"Error adding photo to PDF: {e}")
                    finally:
                        # Cleanup temp files from GridFS
                        if file_id or photo_url.startswith("/api/file/"):
                            try:
                                if temp_photo_path.exists():
                                    temp_photo_path.unlink()
                            except (ValueError, TypeError):
                                pass
        
        signature_url = submission.get("signature_url")
        if signature_url:
            story.append(Paragraph("Property Holder Signature", heading_style))
            
            temp_sig_path = None
            
            # Handle GridFS signature (new format with town code or legacy)
            if signature_url.startswith("/api/file/"):
                try:
                    parts = signature_url.replace("/api/file/", "").split("/")
                    sig_file_id = parts[-1]  # last part is file_id
                    content, filename, _ = await get_file_from_gridfs(sig_file_id)
                    if content is None and len(parts) > 1:
                        town_fs_temp = get_town_gridfs(parts[0])
                        grid_out = await town_fs_temp.open_download_stream(ObjectId(sig_file_id))
                        content = await grid_out.read()
                    if content:
                        temp_sig_path = UPLOAD_DIR / f"temp_sig_{uuid.uuid4()}.png"
                        async with aiofiles.open(temp_sig_path, 'wb') as f:
                            await f.write(content)
                except Exception as e:
                    logger.error(f"Error fetching GridFS signature: {e}")
            
            # Handle legacy local files
            elif signature_url.startswith("/api/uploads/"):
                sig_filename = signature_url.replace("/api/uploads/", "")
                sig_path = UPLOAD_DIR / sig_filename
                if sig_path.exists():
                    temp_sig_path = sig_path
            
            if temp_sig_path and temp_sig_path.exists():
                try:
                    sig_img = RLImage(str(temp_sig_path), width=60*mm, height=30*mm)
                    sig_table = Table([[sig_img]], colWidths=[170*mm])
                    sig_table.setStyle(TableStyle([
                        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
                        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
                        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                        ('PADDING', (0, 0), (-1, -1), 10),
                    ]))
                    story.append(sig_table)
                except Exception as e:
                    logger.error(f"Error adding signature to PDF: {e}")
                finally:
                    # Cleanup temp files from GridFS
                    if signature_url.startswith("/api/file/"):
                        try:
                            if temp_sig_path.exists():
                                temp_sig_path.unlink()
                        except (ValueError, TypeError):
                            pass
        
        story.append(PageBreak())
    
    doc.build(story)
    
    return FileResponse(
        path=str(pdf_path),
        filename=f"property_survey_report_{datetime.now().strftime('%Y%m%d')}.pdf",
        media_type="application/pdf"
    )

# ============== EMPLOYEE ROUTES ==============

@api_router.get("/employee/properties")
async def get_employee_properties(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,  # Increased default for map view
    current_user: dict = Depends(get_current_user)
):
    # Check both single assigned_employee_id and array assigned_employee_ids
    query = {
        "$or": [
            {"assigned_employee_id": current_user["id"]},
            {"assigned_employee_ids": current_user["id"]}
        ]
    }
    if status and status.strip():
        query["status"] = status
    if search:
        query["$and"] = query.get("$and", []) + [{
            "$or": [
                {"property_id": {"$regex": search, "$options": "i"}},
                {"owner_name": {"$regex": search, "$options": "i"}},
                {"mobile": {"$regex": search, "$options": "i"}},
                {"colony": {"$regex": search, "$options": "i"}},
                {"address": {"$regex": search, "$options": "i"}}
            ]
        }]
    
    # Optimized projection - only return fields needed for map and list view
    projection = {
        "_id": 0,
        "id": 1,
        "property_id": 1,
        "owner_name": 1,
        "mobile": 1,
        "address": 1,
        "colony": 1,
        "ward": 1,
        "latitude": 1,
        "longitude": 1,
        "status": 1,
        "serial_number": 1,
        "bill_sr_no": 1,
        "amount": 1,
        "category": 1,
        "total_area": 1,
        "photo_url": 1,
        "polygon": 1,
        "polygon_centroid": 1,
        "phed_survey_status": 1,
        "phed_survey_type": 1,
        "phed_survey_state": 1,
        "phed_outcome": 1
    }
    
    skip = (page - 1) * limit
    total = await get_db().properties.count_documents(query)
    
    # Use sort for consistent ordering - pending first, then by serial number
    properties = await get_db().properties.find(query, projection).sort([
        ("status", 1),  # Pending first
        ("serial_number", 1)
    ]).skip(skip).limit(limit).to_list(limit)
    
    return {
        "properties": properties,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@api_router.get("/employee/property/{property_id}")
async def get_property_detail(property_id: str, current_user: dict = Depends(get_current_user)):
    prop = await get_db().properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Check if employee is assigned (either single or in array)
    is_assigned = (
        prop.get("assigned_employee_id") == current_user["id"] or
        current_user["id"] in (prop.get("assigned_employee_ids") or [])
    )
    if current_user["role"] != "ADMIN" and not is_assigned:
        raise HTTPException(status_code=403, detail="Access denied")
    
    submission = await get_db().submissions.find_one(
        {"property_record_id": property_id, "status": {"$ne": "Rejected"}}, {"_id": 0}
    )
    
    return {
        "property": prop,
        "submission": submission
    }

@api_router.post("/employee/submit/{property_id}")
async def submit_survey(
    property_id: str,
    # Survey fields - Simplified as per requirements
    receiver_name: str = Form(""),
    receiver_mobile: str = Form(""),
    relation: str = Form(""),
    correct_colony_name: str = Form(None),
    remarks: str = Form(None),
    self_satisfied: str = Form(""),
    special_condition: str = Form(None),  # 'property_locked', 'owner_denied', 'vacant_plot', or 'wrong_location'
    house_status: str = Form(None),  # 'kachha', 'pakka', or 'vacant_plot'
    property_use: str = Form(None),  # 'residential', 'commercial', 'mix_use', or 'other'
    property_use_remarks: str = Form(None),  # remarks for 'other' property use
    wrong_location: str = Form("false"),  # 'true' if property ID at wrong location
    # Self Certification fields
    self_cert_status: str = Form(None),  # 'done', 'later', 'deny', 'already_certified'
    self_cert_mobile: str = Form(None),
    self_cert_otp: str = Form(None),
    latitude: float = Form(...),
    longitude: float = Form(...),
    house_photo: UploadFile = File(None),  # Now optional
    receiver_photo: UploadFile = File(None),  # Receiver photo - optional
    gate_photo: UploadFile = File(None),   # Now optional
    signature: UploadFile = File(None),    # Now optional
    extra_photos: List[UploadFile] = File(default=[]),
    authorization: str = Form(...),
    # Legacy fields - keep for backward compatibility
    new_owner_name: str = Form(None),
    new_mobile: str = Form(None),
    old_property_id: str = Form(None),
    family_id: str = Form(None),
    aadhar_number: str = Form(None),
    ward_number: str = Form(None)
):
    current_user = await get_current_user(authorization)
    
    prop = await get_db().properties.find_one({"id": property_id}, {
        "_id": 0, "id": 1, "property_id": 1, "batch_id": 1, "owner_name": 1,
        "mobile": 1, "locked": 1, "status": 1, "assigned_employee_id": 1,
        "assigned_employee_ids": 1, "self_certified": 1, "latitude": 1, "longitude": 1
    })
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Check if property is locked (survey already completed and approved)
    if prop.get("locked") is True:
        raise HTTPException(status_code=403, detail="This property is locked. Survey already completed.")
    
    # Check if property status is Completed or Approved - prevent re-submission
    if prop.get("status") in ["Completed", "Approved"]:
        raise HTTPException(status_code=403, detail="This property survey is already completed. Cannot re-submit.")
    
    # Check if employee is assigned (either single or in array)
    is_assigned = (
        prop.get("assigned_employee_id") == current_user["id"] or
        current_user["id"] in (prop.get("assigned_employee_ids") or [])
    )
    if current_user["role"] != "ADMIN" and not is_assigned:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Geofence (server-side, cannot be bypassed from the client): surveyors whose account has
    # gps_radius_required=True must physically be within SURVEY_RADIUS_METERS of the property.
    # Admin sets this per surveyor; False = office/remote submission allowed.
    if (current_user["role"] == "SURVEYOR" and current_user.get("gps_radius_required", True) is not False
            and special_condition != 'wrong_location'
            and prop.get("latitude") is not None and prop.get("longitude") is not None):
        try:
            dist_m = haversine_distance(latitude, longitude, float(prop["latitude"]), float(prop["longitude"]))
        except (TypeError, ValueError):
            dist_m = None
        if dist_m is not None and dist_m > SURVEY_RADIUS_METERS:
            raise HTTPException(
                status_code=403,
                detail=f"You must be within {SURVEY_RADIUS_METERS} m of the property to submit (you are {round(dist_m)} m away)")
    
    # Check if special condition allows skipping required fields
    is_special_condition = special_condition in ['property_locked', 'owner_denied', 'vacant_plot', 'wrong_location']
    
    # Validate required fields only if not special condition
    if not is_special_condition:
        if not receiver_name or not relation or not receiver_mobile or not self_satisfied:
            raise HTTPException(status_code=400, detail="Receiver name, mobile, relation and satisfaction status are required")
        if not house_photo:
            raise HTTPException(status_code=400, detail="Property photo is required")
    
    photos = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    signature_url = None
    
    # Save photos to town GridFS (durable across pod restarts/redeploys)
    async def save_photo_fast(photo_type, content, filename):
        file_id = await save_file_to_gridfs(content, filename, "image/jpeg")
        return {"photo_type": photo_type, "file_url": make_file_url(file_id), "file_id": file_id}
    
    upload_tasks = []
    
    # House photo
    if house_photo and house_photo.filename:
        content = await house_photo.read()
        house_filename = f"{property_id}_house_{timestamp}.jpg"
        upload_tasks.append(save_photo_fast("HOUSE", content, house_filename))
    
    # Receiver photo
    if receiver_photo and receiver_photo.filename:
        content = await receiver_photo.read()
        receiver_filename = f"{property_id}_receiver_{timestamp}.jpg"
        upload_tasks.append(save_photo_fast("RECEIVER", content, receiver_filename))
    
    # Gate photo
    if gate_photo and gate_photo.filename:
        content = await gate_photo.read()
        gate_filename = f"{property_id}_gate_{timestamp}.jpg"
        upload_tasks.append(save_photo_fast("GATE", content, gate_filename))
    
    # Extra photos
    for idx, photo in enumerate(extra_photos):
        if photo.filename:
            content = await photo.read()
            extra_filename = f"{property_id}_extra{idx}_{timestamp}.jpg"
            upload_tasks.append(save_photo_fast("EXTRA", content, extra_filename))
    
    # Signature
    if signature and signature.filename:
        sig_content = await signature.read()
        sig_filename = f"{property_id}_signature_{timestamp}.png"
        upload_tasks.append(save_photo_fast("SIGNATURE", sig_content, sig_filename))
    
    # Save all photos in parallel (filesystem is very fast)
    if upload_tasks:
        results = await asyncio.gather(*upload_tasks)
        for r in results:
            if r["photo_type"] == "SIGNATURE":
                signature_url = r["file_url"]
            else:
                photos.append(r)
    
    # Set receiver name based on special condition if empty
    final_receiver_name = receiver_name
    if is_special_condition and not receiver_name:
        final_receiver_name = "Property Locked" if special_condition == 'property_locked' else "Owner Denied" if special_condition == 'owner_denied' else "Vacant Plot" if special_condition == 'vacant_plot' else "Wrong Location"
    
    # Create submission with new fields
    submission_doc = {
        "id": str(uuid.uuid4()),
        "property_record_id": property_id,
        "property_id": prop["property_id"],
        "batch_id": prop["batch_id"],
        "employee_id": current_user["id"],
        "employee_name": current_user["name"],
        # Survey fields - NEW simplified structure
        "receiver_name": final_receiver_name,
        "receiver_mobile": receiver_mobile,
        "relation": relation or ("N/A" if is_special_condition else ""),
        "correct_colony_name": correct_colony_name,
        "remarks": remarks,
        "self_satisfied": self_satisfied or ("N/A" if is_special_condition else "yes"),
        "special_condition": special_condition,  # property_locked, owner_denied, vacant_plot, wrong_location
        "house_status": house_status,  # kachha, pakka, or vacant_plot
        "property_use": property_use,  # residential, commercial, mix_use, other
        "property_use_remarks": property_use_remarks,  # remarks for 'other' property use
        "wrong_location": wrong_location == "true",  # boolean - property ID at wrong GPS location
        # Self Certification data
        "self_cert_status": self_cert_status,  # done, later, deny, already_certified
        "self_cert_mobile": self_cert_mobile if self_cert_status == 'done' else None,
        "self_cert_otp": self_cert_otp if self_cert_status == 'done' else None,
        "self_cert_verified": True if self_cert_status == 'done' and self_cert_otp else False,
        "latitude": latitude,
        "longitude": longitude,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "photos": photos,
        "signature_url": signature_url,
        "status": "Pending",
        # Legacy fields for backward compat
        "new_owner_name": new_owner_name or prop.get("owner_name"),
        "new_mobile": new_mobile or prop.get("mobile"),
        "old_property_id": old_property_id,
        "family_id": family_id,
        "aadhar_number": aadhar_number,
        "ward_number": ward_number
    }
    
    # Check if a non-rejected submission already exists (rejected ones are kept as audit trail)
    existing = await get_db().submissions.find_one(
        {"property_record_id": property_id, "status": {"$ne": "Rejected"}}, {"_id": 1}
    )
    if existing:
        sub_task = get_db().submissions.update_one(
            {"property_record_id": property_id, "status": {"$ne": "Rejected"}},
            {"$set": submission_doc}
        )
    else:
        sub_task = get_db().submissions.insert_one(submission_doc)
    
    prop_task = get_db().properties.update_one(
        {"id": property_id},
        {"$set": {"status": "In Progress"}}
    )
    
    await asyncio.gather(sub_task, prop_task)
    
    # Clear map cache so other users see updated status
    await clear_map_cache()
    
    return {"message": "Survey submitted successfully", "submission_id": submission_doc["id"]}

@api_router.post("/employee/reject/{property_id}")
async def reject_property(property_id: str, remarks: str = Form(...), authorization: str = Form(...)):
    current_user = await get_current_user(authorization)
    
    prop = await get_db().properties.find_one({"id": property_id}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Check if employee is assigned (either single or in array)
    is_assigned = (
        prop.get("assigned_employee_id") == current_user["id"] or
        current_user["id"] in (prop.get("assigned_employee_ids") or [])
    )
    if current_user["role"] != "ADMIN" and not is_assigned:
        raise HTTPException(status_code=403, detail="Access denied")
    
    await get_db().properties.update_one(
        {"id": property_id},
        {"$set": {"status": "Rejected", "reject_remarks": remarks}}
    )
    
    return {"message": "Property rejected"}

@api_router.get("/employee/progress")
async def get_employee_own_progress(current_user: dict = Depends(get_current_user)):
    today_start = get_today_start().isoformat()
    
    # Query for properties assigned to this employee (single or in array)
    assign_query = {
        "$or": [
            {"assigned_employee_id": current_user["id"]},
            {"assigned_employee_ids": current_user["id"]}
        ]
    }
    
    # Single aggregation for all property status counts
    stat_pipeline = [
        {"$match": assign_query},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]
    stat_counts = {s["_id"]: s["count"] for s in await get_db().properties.aggregate(stat_pipeline).to_list(None)}
    total = sum(stat_counts.values())
    completed = stat_counts.get("Completed", 0)
    pending = stat_counts.get("Pending", 0)
    rejected = stat_counts.get("Rejected", 0)
    in_progress = stat_counts.get("In Progress", 0)
    _approved = stat_counts.get("Approved", 0)
    
    # Today's completed
    today_completed = await get_db().submissions.count_documents({
        "employee_id": current_user["id"],
        "submitted_at": {"$gte": today_start}
    })
    
    # Total completed (all time)
    total_completed = await get_db().submissions.count_documents({
        "employee_id": current_user["id"]
    })
    
    return {
        "total_assigned": total,
        "completed": completed,
        "pending": pending,
        "rejected": rejected,
        "in_progress": in_progress,
        "today_completed": today_completed,
        "total_completed": total_completed
    }

@api_router.get("/employee/daily-progress")
async def get_employee_daily_progress(
    month: int = None,
    year: int = None,
    current_user: dict = Depends(get_current_user)
):
    """Get employee's own date-wise survey count for a given month"""
    from calendar import monthrange
    now = datetime.now(timezone.utc)
    m = month or now.month
    y = year or now.year
    days_in_month = monthrange(y, m)[1]
    
    month_start = f"{y}-{m:02d}-01T00:00:00"
    if m == 12:
        month_end = f"{y + 1}-01-01T00:00:00"
    else:
        month_end = f"{y}-{m + 1:02d}-01T00:00:00"
    
    subs = await get_db().submissions.find(
        {
            "employee_id": current_user["id"],
            "submitted_at": {"$gte": month_start, "$lt": month_end}
        },
        {"_id": 0, "submitted_at": 1, "special_condition": 1}
    ).to_list(None)
    
    daily = {}
    conditions = {"normal": 0, "locked": 0, "denied": 0, "vacant": 0, "wrong": 0}
    
    for sub in subs:
        sub_at = sub.get("submitted_at", "")
        sc = sub.get("special_condition", "")
        
        if sub_at:
            try:
                if "T" in str(sub_at):
                    dt_obj = datetime.fromisoformat(str(sub_at).replace("Z", "+00:00"))
                    ist = dt_obj + timedelta(hours=5, minutes=30)
                    day = ist.day
                else:
                    day = int(str(sub_at)[8:10])
                daily[day] = daily.get(day, 0) + 1
            except (ValueError, TypeError):
                pass
        
        if sc in ["property_locked", "house_locked"]:
            conditions["locked"] += 1
        elif sc == "owner_denied":
            conditions["denied"] += 1
        elif sc == "vacant_plot":
            conditions["vacant"] += 1
        elif sc == "wrong_location":
            conditions["wrong"] += 1
        else:
            conditions["normal"] += 1
    
    daily_list = []
    for d in range(1, days_in_month + 1):
        daily_list.append({"day": d, "count": daily.get(d, 0)})
    
    return {
        "month": m,
        "year": y,
        "total": len(subs),
        "daily": daily_list,
        "conditions": conditions,
        "days_in_month": days_in_month
    }

# ============== ATTENDANCE ROUTES ==============

@api_router.get("/employee/attendance/today")
async def check_today_attendance(current_user: dict = Depends(get_current_user)):
    """Check if employee has marked attendance today"""
    today_date = get_today_start().strftime("%Y-%m-%d")
    
    attendance = await get_db().attendance.find_one({
        "employee_id": current_user["id"],
        "date": today_date
    }, {"_id": 0})
    
    return {
        "marked": attendance is not None,
        "has_attendance": attendance is not None,
        "attendance": attendance
    }

@api_router.post("/employee/attendance")
async def mark_attendance(
    selfie: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    authorization: str = Form(...)
):
    """Mark one-time daily attendance with selfie"""
    current_user = await get_current_user(authorization)
    today_date = get_today_start().strftime("%Y-%m-%d")
    
    # Check if already marked
    existing = await get_db().attendance.find_one({
        "employee_id": current_user["id"],
        "date": today_date
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Attendance already marked for today")
    
    # Save selfie TO GRIDFS
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    selfie_filename = f"attendance_{current_user['id']}_{timestamp}{Path(selfie.filename).suffix}"
    content = await selfie.read()
    file_id = await save_file_to_gridfs(content, selfie_filename, selfie.content_type or "image/jpeg")
    selfie_url = make_file_url(file_id)
    
    # Create attendance record
    attendance_doc = {
        "id": str(uuid.uuid4()),
        "employee_id": current_user["id"],
        "employee_name": current_user["name"],
        "date": today_date,
        "marked_at": datetime.now(timezone.utc).isoformat(),
        "selfie_url": selfie_url,
        "selfie_file_id": file_id,
        "latitude": latitude,
        "longitude": longitude
    }
    
    await get_db().attendance.insert_one(attendance_doc)
    
    return {
        "message": "Attendance marked successfully",
        "attendance_id": attendance_doc["id"],
        "marked_at": attendance_doc["marked_at"]
    }

@api_router.get("/admin/attendance")
async def get_attendance_records(
    date: Optional[str] = None,
    employee_id: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get attendance records (admin/supervisor only)"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if date:
        query["date"] = date
    if employee_id and employee_id.strip():
        query["employee_id"] = employee_id
    
    skip = (page - 1) * limit
    total = await get_db().attendance.count_documents(query)
    records = await get_db().attendance.find(query, {"_id": 0}).sort("marked_at", -1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "attendance": records,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

# ============== PDF BILL PROCESSING ==============

# Helper: Enlarge "Total Outstanding" cell text by 20% on a PDF page
def enlarge_total_outstanding(page, scale_factor=1.2):
    """Find the Total Outstanding cell in bottom-right and increase text size by given factor"""
    try:
        rotation = page.rotation
        text_dict = page.get_text("dict")
        
        # Find the "Total Outstanding as on" span to locate the cell
        total_span = None
        for block in text_dict["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if "Total Outstanding as on" in span.get("text", ""):
                        total_span = span
                        break
                if total_span:
                    break
            if total_span:
                break
        
        if not total_span:
            return
        
        # Define the cell boundary from the anchor span
        cell_y_end = total_span["bbox"][3]
        cell_y_start = total_span["bbox"][1] - 50
        cell_x_start = total_span["bbox"][0]
        
        # Collect all text spans within this cell
        target_spans = []
        for block in text_dict["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    bbox = span["bbox"]
                    if (bbox[1] >= cell_y_start and bbox[3] <= cell_y_end + 5 and
                        bbox[0] >= cell_x_start - 5):
                        target_spans.append(span)
        
        if not target_spans:
            return
        
        # Redact original text (preserves borders/graphics)
        for span in target_spans:
            bbox = fitz.Rect(span["bbox"])
            expanded = bbox + (-0.5, -0.5, 0.5, 0.5)
            page.add_redact_annot(expanded, fill=(1, 1, 1))
        
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        
        # Re-insert text at enlarged size
        for span in target_spans:
            origin = fitz.Point(span["origin"])
            new_size = span["size"] * scale_factor
            page.insert_text(
                origin, span["text"],
                fontsize=new_size,
                fontname="hebo",
                color=(0, 0, 0),
                rotate=rotation
            )
    except Exception as e:
        logger.warning(f"Could not enlarge Total Outstanding text: {e}")

# Helper function to extract BillSrNo from page using block-based extraction
def extract_bill_sr_no_from_page(page) -> str:
    """Extract BillSrNo from PDF page using position-aware extraction"""
    try:
        blocks = page.get_text("dict")["blocks"]
        billsr_y = None
        billsr_x = None
        
        # First find the BillSrNo label position
        for block in blocks:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip().lower()
                        if 'billsrno' in text or 'bill sr no' in text:
                            bbox = span["bbox"]
                            billsr_y = bbox[1]  # y position
                            billsr_x = bbox[2]  # x position (right edge of label)
                            # Check if number is on same line after ":"
                            full_text = span["text"]
                            match = re.search(r'[:\s]+(\d+)\s*$', full_text)
                            if match:
                                return match.group(1)
        
        # If we found BillSrNo label, look for a number nearby
        if billsr_y is not None:
            candidates = []
            for block in blocks:
                if "lines" in block:
                    for line in block["lines"]:
                        for span in line["spans"]:
                            text = span["text"].strip()
                            bbox = span["bbox"]
                            # Look for standalone numbers in similar y position (within 20 pixels)
                            if text.isdigit() and abs(bbox[1] - billsr_y) < 20:
                                # Prefer numbers to the right of the label
                                if billsr_x is None or bbox[0] >= billsr_x - 50:
                                    candidates.append((abs(bbox[1] - billsr_y), text))
            
            if candidates:
                # Return the closest number
                candidates.sort(key=lambda x: x[0])
                return candidates[0][1]
        
        return ""
    except Exception:
        return ""

# Helper function to extract bill data from PDF text
def extract_bill_data(text: str, page_num: int, page=None) -> dict:
    """Extract structured bill data from PDF page text"""
    
    def find_value(patterns, text, default=""):
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                return match.group(1).strip()
        return default
    
    # Extract coordinates (latitude : longitude format)
    coords_match = re.search(r'(\d+\.\d+)\s*:\s*(\d+\.\d+)', text)
    latitude = float(coords_match.group(1)) if coords_match else None
    longitude = float(coords_match.group(2)) if coords_match else None
    
    # Try to extract BillSrNo using block-based extraction first
    bill_sr_no = ""
    if page is not None:
        bill_sr_no = extract_bill_sr_no_from_page(page)
    
    # Fallback to regex if block extraction failed
    if not bill_sr_no:
        bill_sr_no = find_value([
            r'BillSrNo\.?\s*[:\s]*\s*(\d+)',      # BillSrNo. : 112 or BillSrNo : 112
            r'Bill\s*Sr\s*No\.?\s*[:\s]*(\d+)',   # Bill Sr No. : 112
            r'Bill\s*Serial\s*No\.?\s*[:\s]*(\d+)' # Bill Serial No. : 112
        ], text)
    
    bill_data = {
        "bill_sr_no": bill_sr_no,
        "property_id": find_value([r'Property\s*Id[:\s]*([A-Z0-9]+)', r'PropertyId[:\s]*([A-Z0-9]+)'], text),
        "old_property_id": find_value([r'Old\s*Property\s*Id[:\s]*([A-Z0-9/-]+)', r'OldPropertyId[:\s]*([A-Z0-9/-]+)'], text),
        "financial_year": find_value([r'Financial\s*Year[:\s]*(\d{4}-\d{2,4})', r'FY[:\s]*(\d{4}-\d{2,4})'], text, "2025-26"),
        "print_date": find_value([r'Print\s*Date[:\s]*([0-9/\-]+)', r'Date[:\s]*([0-9/\-]+)'], text),
        "latitude": latitude,
        "longitude": longitude,
        "mobile": find_value([r'Mobile\s*No[:\s]*(\d{10})', r'Mobile[:\s]*(\d{10})', r'Phone[:\s]*(\d{10})'], text),
        "colony": find_value([r'Colony\s*Name[:\s]*([^\n]+)', r'Colony[:\s]*([^\n]+)'], text),
        "owner_name": find_value([r'Owner\s*Name[:\s]*([^\n]+)', r'Owner[:\s]*([^\n]+)'], text),
        "plot_address": find_value([r'Plot\s*Address[:\s]*([^\n]+)', r'Address[:\s]*([^\n]+)'], text),
        "permanent_address": find_value([r'Permanent\s*Address[:\s]*([^\n]+)'], text),
        "total_area": find_value([r'Total\s*Area[:\s]*([0-9.]+\s*SqYard)', r'Area[:\s]*([0-9.]+)'], text),
        "category": find_value([r'Category[:\s]*([^\n,]+)', r'Type[:\s]*([^\n,]+)'], text),
        "authorized_status": find_value([r'Authorized\s*Status[:\s]*([^\n]+)'], text),
        "total_outstanding": find_value([
            r'Total\s*Outstanding\s*as\s*on\s*date[^=]*=\s*([0-9,.-]+)',  # Total Outstanding as on date (PO+AO+...)= 3179.16
            r'Total\s*Outstanding[:\s]*Rs?\.?\s*([0-9,.-]+)', 
            r'Outstanding[:\s]*Rs?\.?\s*([0-9,.-]+)'
        ], text),
        "property_tax_outstanding": find_value([r'Property\s*&?\s*Fire\s*Tax\s*Outstanding[^\d]*([0-9,.-]+)'], text),
        "outstanding_property_arrear": find_value([r'Outstanding\s*Property\s*Tax\s*Arrear[^\d]*([0-9,.-]+)', r'AO[=:\s]*([0-9,.-]+)'], text),
        "outstanding_fire_arrear": find_value([r'Outstanding\s*Fire\s*Tax\s*Arrear[^\d]*([0-9,.-]+)', r'FO[=:\s]*([0-9,.-]+)'], text),
        "outstanding_interest": find_value([r'Outstanding\s*Interest\s*on\s*Arrear[^\d]*([0-9,.-]+)', r'IO[=:\s]*([0-9,.-]+)'], text),
        "outstanding_garbage": find_value([r'Outstanding\s*Garbage\s*Collection\s*Charges[^\d]*([0-9,.-]+)', r'SO1[=:\s]*([0-9,.-]+)'], text),
        "page_number": page_num
    }
    
    return bill_data

# Calculate distance between two GPS points (Haversine formula)
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

# Sort bills by GPS route (nearest neighbor algorithm with location grouping)
def sort_by_gps_route(bills: list) -> list:
    if not bills:
        return bills
    
    # Separate bills with and without GPS
    valid_bills = [b for b in bills if b.get('latitude') and b.get('longitude')]
    no_gps_bills = [b for b in bills if not b.get('latitude') or not b.get('longitude')]
    
    if not valid_bills:
        return bills
    
    # Group bills by unique GPS location (round to 6 decimal places)
    location_groups = {}
    for bill in valid_bills:
        # Round coordinates to group nearby points (within ~0.1 meter)
        key = (round(bill['latitude'], 6), round(bill['longitude'], 6))
        if key not in location_groups:
            location_groups[key] = []
        location_groups[key].append(bill)
    
    # Get list of unique locations
    unique_locations = list(location_groups.keys())
    
    if len(unique_locations) <= 1:
        # All bills at same location, just return them
        return valid_bills + no_gps_bills
    
    # Find starting point - use the northwestern-most point (highest lat, lowest long)
    # This gives a consistent starting point
    start_idx = 0
    best_score = float('-inf')
    for i, loc in enumerate(unique_locations):
        score = loc[0] - loc[1] * 0.1  # Favor north and west
        if score > best_score:
            best_score = score
            start_idx = i
    
    # Sort unique locations using nearest neighbor algorithm
    sorted_locations = [unique_locations[start_idx]]
    remaining_locations = unique_locations[:start_idx] + unique_locations[start_idx+1:]
    
    while remaining_locations:
        last_loc = sorted_locations[-1]
        
        # Find nearest location
        nearest_idx = 0
        nearest_dist = float('inf')
        
        for i, loc in enumerate(remaining_locations):
            dist = haversine_distance(last_loc[0], last_loc[1], loc[0], loc[1])
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_idx = i
        
        sorted_locations.append(remaining_locations.pop(nearest_idx))
    
    # Build final sorted list with all bills from each location in order
    sorted_bills = []
    for loc in sorted_locations:
        # Get all bills at this location and add them
        bills_at_loc = location_groups[loc]
        sorted_bills.extend(bills_at_loc)
    
    # Add bills without GPS at the end
    sorted_bills.extend(no_gps_bills)
    
    return sorted_bills

@api_router.post("/admin/bills/upload-pdf")
async def upload_pdf_bills(
    file: UploadFile = File(...),
    batch_name: str = Form(...),
    authorization: str = Form(...)
):
    """Upload multi-page PDF and extract bill data from each page (ADMIN only)"""
    current_user = await get_current_user(authorization)
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Only Admin can upload PDF bills")
    
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")
    
    # Save uploaded PDF
    content = await file.read()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_filename = f"bills_{timestamp}.pdf"
    
    # Source of truth is GridFS; local copy is only a processing cache
    await _uploads_fs.upload_from_stream(pdf_filename, content)
    pdf_path = await ensure_upload_local(pdf_filename)
    
    # Create batch record
    batch_id = str(uuid.uuid4())
    batch_doc = {
        "id": batch_id,
        "name": batch_name,
        "type": "PDF_BILLS",
        "pdf_filename": pdf_filename,
        "pdf_url": f"/api/uploads/{pdf_filename}",
        "uploaded_by": current_user["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "status": "ACTIVE",
        "total_records": 0,
        "skip_stats": {
            "skipped_na_empty": 0,
            "skipped_vacant": 0,
            "na_serial_count": 0
        }
    }
    
    # Helper function to check if owner name is valid (not NA or empty)
    def is_valid_owner_name(name):
        """Check if owner name is valid - be LENIENT to avoid skipping good data"""
        if not name:
            return False
        name_clean = name.strip()
        name_upper = name_clean.upper()
        # Only skip if EXACTLY matches these invalid values
        invalid_values = ['NA', 'N/A', 'N.A.', '-', '--', '']
        return name_upper not in invalid_values and len(name_clean) > 0
    
    def should_skip_record(owner_name, category=""):
        """Determine if a record should be skipped - be CONSERVATIVE"""
        owner = (owner_name or "").strip().lower()
        cat = (category or "").strip().lower()
        
        # Only skip if owner is completely empty/invalid AND category is vacant
        if not owner or owner in ['na', 'n/a', '-', '--']:
            # Even if owner is NA, keep residential properties
            if 'residential' in cat or 'commercial' in cat:
                return False
            return True
        
        # Skip ONLY if explicitly marked as vacant plot with no owner
        if ('vacant' in cat or 'empty' in cat) and (not owner or len(owner) <= 2):
            return True
        
        return False
    
    # Extract text from each page using PyMuPDF
    bills = []
    skipped_count = 0
    na_serial_count = 0
    
    # Load self-certified PIDs from BOTH database sources
    self_certified_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
    self_certified_pids = set(doc["pid"].upper() for doc in self_certified_docs if doc.get("pid"))
    
    # Also check properties collection for self_certified = True or "Yes"
    async for prop in get_db().properties.find(
        {"$or": [{"self_certified": True}, {"self_certified": "Yes"}]},
        {"property_id": 1}
    ):
        if prop.get("property_id"):
            self_certified_pids.add(str(prop["property_id"]).upper())
    
    logger.info(f"PDF upload: {len(self_certified_pids)} self-certified PIDs found from all sources")
    
    self_certified_count = 0
    not_self_certified_count = 0
    
    try:
        pdf_doc = fitz.open(str(pdf_path))
        
        # Vacant plot keywords to check - be more specific
        VACANT_KEYWORDS = ["vacant plot", "empty plot", "खाली प्लॉट"]
        
        def is_vacant_plot(owner_name, category=""):
            """Check if a bill represents a vacant plot - be STRICT, only skip obvious vacant plots"""
            owner = (owner_name or "").strip().lower()
            cat = (category or "").strip().lower()
            
            # Only skip if category explicitly says vacant AND owner is empty/invalid
            if "vacant" in cat and (not owner or owner in ['na', 'n/a', '-', 'nil']):
                return True
            
            # Check for exact vacant plot phrases
            for keyword in VACANT_KEYWORDS:
                if keyword in owner:
                    return True
            
            return False
        
        skipped_vacant = 0
        
        # First pass: Extract all bill data - BE LENIENT, include most records
        for page_num in range(len(pdf_doc)):
            page = pdf_doc[page_num]
            text = page.get_text()
            
            # Extract bill data (pass page for block-based BillSrNo extraction)
            bill_data = extract_bill_data(text, page_num + 1, page)

            # Use batch_name as colony - ensures separate uploads stay separate
            # e.g., "Vijay Nagar" and "Vijay Nagar Part 1" remain distinct colonies
            bill_data["colony"] = batch_name.strip()

            # Upload ALL records - no skipping during upload
            # Filtering is done at PDF print time via skip_empty_names option
            
            bill_data["id"] = str(uuid.uuid4())
            bill_data["batch_id"] = batch_id
            bill_data["page_num"] = page_num + 1  # Store original page number
            
            # Check if serial number is valid
            pdf_serial = bill_data.get("bill_sr_no", "").strip()
            if pdf_serial and pdf_serial.isdigit():
                bill_data["serial_number"] = int(pdf_serial)
                bill_data["serial_na"] = False
                bill_data["bill_sr_no"] = pdf_serial
            else:
                bill_data["serial_number"] = 0
                bill_data["serial_na"] = True
                bill_data["bill_sr_no"] = "N0"  # Temporary, will be updated in second pass
                na_serial_count += 1
            
            bill_data["created_at"] = datetime.now(timezone.utc).isoformat()
            bill_data["status"] = "Pending"
            bill_data["gps_arranged"] = False
            
            # Check if this property is self-certified
            bill_prop_id = bill_data.get("property_id", "")
            is_self_certified = bill_prop_id.upper() in self_certified_pids if bill_prop_id else False
            bill_data["self_certified"] = is_self_certified
            if is_self_certified:
                self_certified_count += 1
            else:
                not_self_certified_count += 1
            
            bills.append(bill_data)
        
        pdf_doc.close()
        
        # Second pass: Fix N/A serials to use nearest valid serial BY GPS LOCATION
        # Get all valid serial numbers with their GPS coordinates
        valid_serials_with_gps = []
        for i, b in enumerate(bills):
            if not b["serial_na"] and b.get("latitude") and b.get("longitude"):
                valid_serials_with_gps.append({
                    "serial": b["serial_number"],
                    "lat": b["latitude"],
                    "lng": b["longitude"]
                })
        
        if valid_serials_with_gps:
            for i, bill in enumerate(bills):
                if bill["serial_na"] and bill.get("latitude") and bill.get("longitude"):
                    # Find the nearest valid serial based on GPS distance
                    nearest_serial = 0
                    min_distance = float('inf')
                    
                    bill_lat = bill["latitude"]
                    bill_lng = bill["longitude"]
                    
                    for vs in valid_serials_with_gps:
                        # Calculate simple Euclidean distance (good enough for nearby points)
                        dist = ((vs["lat"] - bill_lat) ** 2 + (vs["lng"] - bill_lng) ** 2) ** 0.5
                        if dist < min_distance:
                            min_distance = dist
                            nearest_serial = vs["serial"]
                    
                    bill["bill_sr_no"] = f"N{nearest_serial}"
                elif bill["serial_na"]:
                    # No GPS, use first valid serial as fallback
                    bill["bill_sr_no"] = f"N{valid_serials_with_gps[0]['serial'] if valid_serials_with_gps else 0}"
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")
    
    # Build upload message
    upload_message = f"Uploaded {len(bills)} bills successfully."
    if skipped_vacant > 0:
        upload_message += f" Skipped {skipped_vacant} vacant plots."
    if self_certified_count > 0:
        upload_message += f" {self_certified_count} self-certified."
    if not_self_certified_count > 0:
        upload_message += f" {not_self_certified_count} not self-certified."
    
    # Insert bills into database
    if bills:
        await get_db().bills.insert_many(bills)
        batch_doc["total_records"] = len(bills)
        batch_doc["skip_stats"] = {
            "skipped_na_empty": skipped_count,
            "skipped_vacant": skipped_vacant,
            "na_serial_count": na_serial_count,
            "total_skipped": skipped_count + skipped_vacant,
            "self_certified_count": self_certified_count,
            "not_self_certified_count": not_self_certified_count,
            "upload_message": upload_message
        }
    
    await get_db().batches.insert_one(batch_doc)
    
    # Get unique colonies with their bill counts
    colony_stats = {}
    for b in bills:
        colony_name = b.get("colony", "").strip()
        if colony_name:
            if colony_name not in colony_stats:
                colony_stats[colony_name] = {"total": 0, "na_serial": 0}
            colony_stats[colony_name]["total"] += 1
            if b.get("serial_na"):
                colony_stats[colony_name]["na_serial"] += 1
    
    # Get unique colonies
    colonies = list(set([b.get("colony", "").strip() for b in bills if b.get("colony")]))
    
    return {
        "batch_id": batch_id,
        "name": batch_name,
        "total_bills": len(bills),
        "skipped_bills": skipped_count,
        "skipped_vacant": skipped_vacant,
        "na_serial_bills": na_serial_count,
        "self_certified": self_certified_count,
        "not_self_certified": not_self_certified_count,
        "colonies": colonies,
        "message": upload_message
    }

@api_router.get("/admin/bills/export-excel")
async def export_bills_excel(
    batch_id: Optional[str] = None,
    colony: Optional[str] = None,
    self_cert_filter: Optional[str] = None,  # 'self_certified', 'not_self_certified', 'all'
    current_user: dict = Depends(get_current_user)
):
    """Export bills to Excel with optional self-certification filter"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Build query
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id.strip()
    if colony and colony.strip():
        query["colony"] = colony.strip()
    
    # Apply self-certification filter
    if self_cert_filter == "self_certified":
        query["self_certified"] = True
    elif self_cert_filter == "not_self_certified":
        query["$or"] = [{"self_certified": False}, {"self_certified": {"$exists": False}}]
    
    # Get bills
    bills = await get_db().bills.find(query, {"_id": 0}).to_list(None)
    
    # Get count for the filter description
    filter_desc = "All Bills"
    if self_cert_filter == "self_certified":
        filter_desc = "Self-Certified Only"
    elif self_cert_filter == "not_self_certified":
        filter_desc = "Not Self-Certified Only"
    
    if not bills:
        raise HTTPException(
            status_code=404, 
            detail=f"No bills found for '{filter_desc}' filter. Colony: {colony or 'All'}. Please check if there are any {filter_desc.lower()} records."
        )
    
    # Create DataFrame
    df_data = []
    for bill in bills:
        df_data.append({
            "Serial No": bill.get("serial_number", ""),
            "Bill Sr No": bill.get("bill_sr_no", ""),
            "Property ID": bill.get("property_id", ""),
            "Owner Name": bill.get("owner_name", ""),
            "Mobile": bill.get("mobile", ""),
            "Colony": bill.get("colony", ""),
            "Category": bill.get("category", ""),
            "Plot Address": bill.get("plot_address", ""),
            "Total Area": bill.get("total_area", ""),
            "Total Outstanding": bill.get("total_outstanding", ""),
            "Self Certified": "Yes" if bill.get("self_certified") else "No",
            "Serial NA": "Yes" if bill.get("serial_na") else "No",
            "Latitude": bill.get("latitude", ""),
            "Longitude": bill.get("longitude", "")
        })
    
    df = pd.DataFrame(df_data)
    
    # Generate filename
    filter_suffix = ""
    if self_cert_filter == "self_certified":
        filter_suffix = "_self_certified"
    elif self_cert_filter == "not_self_certified":
        filter_suffix = "_not_self_certified"
    
    colony_suffix = f"_{colony.replace(' ', '_')}" if colony and colony.strip() else ""
    filename = f"bills_export{colony_suffix}{filter_suffix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    export_path = UPLOAD_DIR / filename
    
    df.to_excel(str(export_path), index=False)
    
    return FileResponse(
        path=str(export_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename
    )


@api_router.post("/admin/auto-complete-surveys")
async def auto_complete_surveys(
    request: Request,
    colony: Optional[str] = None,
    employee_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Auto-complete pending surveys using existing property data and old photos"""
    if current_user["role"] not in ["ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Parse request body for additional options
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    
    selected_employee_id = body.get("employee_id") or employee_id
    selected_employee_name = body.get("employee_name", "")
    selected_date = body.get("date", "")  # Custom date for submitted_at
    
    # Look up employee name if ID provided
    if selected_employee_id and not selected_employee_name:
        emp = await master_db.users.find_one({"id": selected_employee_id}, {"_id": 0, "name": 1})
        if emp:
            selected_employee_name = emp.get("name", "")
    
    town_db = get_db()
    
    # Find pending properties
    query = {"status": {"$in": ["Pending", None]}}
    if colony:
        query["$or"] = [
            {"colony": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}},
            {"ward": {"$regex": f"^{re.escape(colony)}$", "$options": "i"}}
        ]
    
    pending_props = await town_db.properties.find(query, {"_id": 0}).to_list(None)
    
    if not pending_props:
        return {"message": "No pending properties found", "completed": 0, "skipped": 0, "total_pending": 0}
    
    completed_count = 0
    skipped_count = 0
    
    # Use selected date or current timestamp
    if selected_date:
        timestamp = f"{selected_date}T12:00:00+00:00"
    else:
        timestamp = datetime.now(timezone.utc).isoformat()
    
    na_values = {"", "na", "n/a", "none", "unknown", "-", "nil"}
    
    bulk_submissions = []
    bulk_prop_updates = []
    
    for prop in pending_props:
        prop_id = prop.get("id", "")
        if not prop_id:
            skipped_count += 1
            continue
        
        # Check if submission already exists
        existing = await town_db.submissions.find_one({"property_record_id": prop_id}, {"_id": 1})
        if existing:
            skipped_count += 1
            continue
        
        # Build photo list from old photo_url if available
        photos = []
        old_photo = prop.get("photo_url")
        if old_photo and str(old_photo).strip():
            photos.append({"photo_type": "HOUSE", "file_url": old_photo})
        
        # Handle owner name logic
        owner_name = str(prop.get("owner_name", "")).strip()
        is_owner_na = owner_name.lower() in na_values or not owner_name
        
        # Check if property is a vacant plot (from category or other field)
        is_vacant = False
        category = str(prop.get("category", "")).strip().lower()
        if "vacant" in category or "plot" in category:
            is_vacant = True
        
        # Map category to property_use (keep original category)
        if "commercial" in category:
            property_use = "commercial"
        elif "mix" in category:
            property_use = "mix_use"
        elif "vacant" in category or "plot" in category:
            property_use = "residential"
        else:
            property_use = "residential"
        
        # Set receiver name, relation, special condition based on owner status
        if is_owner_na and is_vacant:
            receiver_name = "Vacant Plot"
            relation = "Other"
            special_condition = "vacant_plot"
            house_status = "vacant_plot"
        elif is_owner_na:
            receiver_name = "Property Locked"
            relation = "Other"
            special_condition = "property_locked"
            house_status = "pakka"
        else:
            receiver_name = owner_name
            relation = "Self"
            special_condition = ""
            house_status = "pakka"
        
        # Use selected employee or property's assigned employee
        emp_id = selected_employee_id or prop.get("assigned_employee_id", "auto_complete")
        emp_name = selected_employee_name or prop.get("assigned_employee_name", "Auto Complete")
        
        submission = {
            "id": str(uuid.uuid4()),
            "property_record_id": prop_id,
            "property_id": prop.get("property_id", ""),
            "batch_id": prop.get("batch_id", ""),
            "employee_id": emp_id,
            "employee_name": emp_name,
            "receiver_name": receiver_name,
            "receiver_mobile": prop.get("mobile", ""),
            "relation": relation,
            "self_satisfied": "yes",
            "house_status": house_status,
            "property_use": property_use,
            "special_condition": special_condition,
            "photos": photos,
            "latitude": prop.get("latitude"),
            "longitude": prop.get("longitude"),
            "remarks": "",
            "status": "Approved",
            "submitted_at": timestamp,
            "approved_at": timestamp,
            "approved_by": current_user["id"],
            "auto_completed": True
        }
        
        bulk_submissions.append(submission)
        bulk_prop_updates.append(prop_id)
        completed_count += 1
    
    # Bulk insert submissions
    if bulk_submissions:
        batch_size = 500
        for i in range(0, len(bulk_submissions), batch_size):
            batch = bulk_submissions[i:i+batch_size]
            await town_db.submissions.insert_many(batch)
        
        # Bulk update property statuses to Approved
        await town_db.properties.update_many(
            {"id": {"$in": bulk_prop_updates}},
            {"$set": {"status": "Approved"}}
        )
    
    return {
        "message": f"Auto-completed {completed_count} surveys (Status: Approved)",
        "completed": completed_count,
        "skipped": skipped_count,
        "total_pending": len(pending_props)
    }



@api_router.get("/admin/colony-progress/export-excel")
async def export_colony_progress_excel(
    current_user: dict = Depends(get_current_user)
):
    """Export colony-wise survey progress for the entire town as Excel"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get all colonies with their property counts using aggregation
    na_owner_list = [None, "", "NA", "N/A", "na", "n/a", "UNKNOWN", "unknown"]
    prop_pipeline = [
        {"$match": {"ward": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {
            "_id": "$ward",
            "total": {"$sum": 1},
            "approved": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed"]]}, 1, 0]}},
            "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "In Progress"]}, 1, 0]}},
            "pending": {"$sum": {"$cond": [{"$eq": ["$status", "Pending"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}},
            "with_gps": {"$sum": {"$cond": [{"$and": [
                {"$ne": ["$latitude", None]},
                {"$ne": ["$longitude", None]}
            ]}, 1, 0]}},
            "valid_serial": {"$sum": {"$cond": [{"$and": [{"$ne": ["$serial_na", True]}, {"$gt": ["$serial_number", 0]}]}, 1, 0]}},
            "na_serial": {"$sum": {"$cond": [{"$eq": ["$serial_na", True]}, 1, 0]}},
            "owner_na": {"$sum": {"$cond": [{"$in": ["$owner_name", na_owner_list]}, 1, 0]}},
            "unique_owners": {"$addToSet": "$owner_name"},
            "assigned_employees": {"$addToSet": "$assigned_employee_name"},
            "cat_residential": {"$sum": {"$cond": [{"$eq": ["$category", "Residential"]}, 1, 0]}},
            "cat_commercial": {"$sum": {"$cond": [{"$eq": ["$category", "Commercial"]}, 1, 0]}},
            "cat_mix_use": {"$sum": {"$cond": [{"$eq": ["$category", "Mix Use"]}, 1, 0]}},
            "cat_vacant_plot": {"$sum": {"$cond": [{"$eq": ["$category", "Vacant Plot"]}, 1, 0]}},
            "cat_industrial": {"$sum": {"$cond": [{"$eq": ["$category", "Industrial"]}, 1, 0]}},
            "cat_institutional": {"$sum": {"$cond": [{"$eq": ["$category", "Institutional"]}, 1, 0]}},
            "cat_special": {"$sum": {"$cond": [{"$eq": ["$category", "Special Category"]}, 1, 0]}},
            "self_cert_yes": {"$sum": {"$cond": [{"$eq": ["$self_certified", True]}, 1, 0]}},
            "self_cert_no": {"$sum": {"$cond": [{"$ne": ["$self_certified", True]}, 1, 0]}}
        }},
        {"$sort": {"_id": 1}}
    ]
    colony_stats = await get_db().properties.aggregate(prop_pipeline).to_list(None)
    
    if not colony_stats:
        raise HTTPException(status_code=404, detail="No colony data found")
    
    # Get actual surveyor names from submissions (who did the survey)
    # First build colony map from properties: property internal id -> colony/ward
    all_props = await get_db().properties.find(
        {"ward": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "ward": 1}
    ).to_list(None)
    prop_colony_map = {p["id"]: p["ward"] for p in all_props}
    
    # Get surveyor names from submissions grouped by colony
    survey_names_pipeline = [
        {"$match": {"employee_name": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {
            "_id": "$property_record_id",
            "employee_name": {"$first": "$employee_name"}
        }}
    ]
    sub_results = await get_db().submissions.aggregate(survey_names_pipeline).to_list(None)
    
    # Build colony -> set of surveyor names
    colony_surveyors = {}
    for s in sub_results:
        colony = prop_colony_map.get(s["_id"])
        if colony and s.get("employee_name"):
            if colony not in colony_surveyors:
                colony_surveyors[colony] = set()
            colony_surveyors[colony].add(s["employee_name"])
    
    # Build Excel
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Colony Survey Progress"
    
    headers = [
        "Sr No", "Colony Name", "Total Properties", "Survey Done", 
        "In Progress", "Pending", "Rejected", "Completion %",
        "Residential", "Commercial", "Mix Use", "Vacant Plot",
        "Industrial", "Institutional", "Special Category",
        "Self Cert Yes", "Self Cert No",
        "Valid Serial", "NA Serial", "With GPS", "Unique Owners",
        "Owner NA", "Survey Done By", "Status"
    ]
    
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2E7D32", end_color="2E7D32", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border
    
    # Grand totals
    grand_total = grand_done = grand_progress = grand_pending = grand_rejected = 0
    grand_valid = grand_na = grand_owner_na = 0
    grand_res = grand_com = grand_mix = grand_vacant = grand_ind = grand_inst = grand_spec = 0
    grand_sc_yes = grand_sc_no = 0
    
    for row_num, stat in enumerate(colony_stats, 2):
        total = stat["total"]
        done = stat["approved"]
        in_prog = stat["in_progress"]
        pending = stat["pending"]
        rejected = stat["rejected"]
        valid_serial = stat.get("valid_serial", 0)
        na_serial = stat.get("na_serial", 0)
        owner_na = stat.get("owner_na", 0)
        cat_res = stat.get("cat_residential", 0)
        cat_com = stat.get("cat_commercial", 0)
        cat_mix = stat.get("cat_mix_use", 0)
        cat_vac = stat.get("cat_vacant_plot", 0)
        cat_ind = stat.get("cat_industrial", 0)
        cat_inst = stat.get("cat_institutional", 0)
        cat_spec = stat.get("cat_special", 0)
        sc_yes = stat.get("self_cert_yes", 0)
        sc_no = stat.get("self_cert_no", 0)
        completion = round((done / total * 100), 1) if total > 0 else 0
        unique_owners = len([o for o in stat.get("unique_owners", []) if o and str(o).strip()])
        surveyors = sorted(colony_surveyors.get(stat["_id"], set()))
        
        # Determine colony status
        if done == total and total > 0:
            status_text = "Complete"
        elif done + in_prog > 0:
            status_text = "In Progress"
        else:
            status_text = "Not Started"
        
        grand_total += total
        grand_done += done
        grand_progress += in_prog
        grand_pending += pending
        grand_rejected += rejected
        grand_valid += valid_serial
        grand_na += na_serial
        grand_owner_na += owner_na
        grand_res += cat_res
        grand_com += cat_com
        grand_mix += cat_mix
        grand_vacant += cat_vac
        grand_ind += cat_ind
        grand_inst += cat_inst
        grand_spec += cat_spec
        grand_sc_yes += sc_yes
        grand_sc_no += sc_no
        
        row_data = [
            row_num - 1,
            stat["_id"],
            total,
            done,
            in_prog,
            pending,
            rejected,
            f"{completion}%",
            cat_res,
            cat_com,
            cat_mix,
            cat_vac,
            cat_ind,
            cat_inst,
            cat_spec,
            sc_yes,
            sc_no,
            valid_serial,
            na_serial,
            stat["with_gps"],
            unique_owners,
            owner_na,
            ", ".join(surveyors[:5]) + (f" +{len(surveyors)-5}" if len(surveyors) > 5 else ""),
            status_text
        ]
        
        for col, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_num, column=col, value=value)
            cell.border = thin_border
            cell.alignment = Alignment(horizontal='left')
            if col == 24:  # Status column
                if value == "Complete":
                    cell.font = Font(color="2E7D32", bold=True)
                elif value == "In Progress":
                    cell.font = Font(color="E65100", bold=True)
                else:
                    cell.font = Font(color="C62828", bold=True)
            if col == 8:
                cell.alignment = Alignment(horizontal='center')
    
    # Add totals row
    total_row = len(colony_stats) + 2
    grand_completion = round((grand_done / grand_total * 100), 1) if grand_total > 0 else 0
    totals = [
        "", "GRAND TOTAL", grand_total, grand_done, grand_progress, grand_pending, grand_rejected, f"{grand_completion}%",
        grand_res, grand_com, grand_mix, grand_vacant, grand_ind, grand_inst, grand_spec,
        grand_sc_yes, grand_sc_no,
        grand_valid, grand_na, "", "", grand_owner_na, "", ""
    ]
    total_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    for col, value in enumerate(totals, 1):
        cell = ws.cell(row=total_row, column=col, value=value)
        cell.border = thin_border
        cell.font = Font(bold=True)
        cell.fill = total_fill
    
    # Column widths
    widths = [6, 30, 14, 12, 12, 12, 10, 12, 12, 12, 10, 12, 12, 14, 16, 14, 12, 12, 10, 10, 12, 10, 35, 14]
    for col, width in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = width
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"colony_survey_progress_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/admin/bills")
async def list_bills(
    batch_id: Optional[str] = None,
    colony: Optional[str] = None,
    town: Optional[str] = None,
    status: Optional[str] = None,
    sorted_by_route: bool = False,
    page: int = 1,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get bills with optional filtering"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    if town and town.strip():
        query["town"] = town
    if status and status.strip():
        query["status"] = status
    
    total = await get_db().bills.count_documents(query)
    
    if sorted_by_route:
        # Get all matching bills and sort by GPS route
        all_bills = await get_db().bills.find(query, {"_id": 0}).to_list(None)
        sorted_bills = sort_by_gps_route(all_bills)
        
        # Assign new serial numbers
        for i, bill in enumerate(sorted_bills):
            bill["route_serial"] = i + 1
        
        # Paginate
        start = (page - 1) * limit
        bills = sorted_bills[start:start + limit]
    else:
        # Sort by page_number to maintain original PDF sequence
        bills = await get_db().bills.find(query, {"_id": 0}).sort("page_number", 1).skip((page - 1) * limit).limit(limit).to_list(limit)
    
    return {
        "bills": bills,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@api_router.get("/admin/bills/colonies")
async def get_bill_colonies(
    batch_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get unique colonies from bills"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    
    colonies = await get_db().bills.distinct("colony", query)
    colonies = [c for c in colonies if c and c.strip()]
    
    return {"colonies": sorted(colonies)}

@api_router.get("/admin/bills/batch-stats/{batch_id}")
async def get_batch_stats(
    batch_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get batch statistics including skip information"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    batch = await get_db().batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Get colony-wise stats
    pipeline = [
        {"$match": {"batch_id": batch_id}},
        {"$group": {
            "_id": "$colony",
            "total": {"$sum": 1},
            "na_serial": {"$sum": {"$cond": ["$serial_na", 1, 0]}},
            "valid_serial": {"$sum": {"$cond": ["$serial_na", 0, 1]}}
        }},
        {"$sort": {"_id": 1}}
    ]
    colony_stats = await get_db().bills.aggregate(pipeline).to_list(None)
    
    return {
        "batch": batch,
        "skip_stats": batch.get("skip_stats", {}),
        "colony_stats": [
            {
                "colony": stat["_id"] or "Unknown",
                "total_bills": stat["total"],
                "na_serial_bills": stat["na_serial"],
                "valid_serial_bills": stat["valid_serial"]
            }
            for stat in colony_stats
        ]
    }

@api_router.get("/admin/bills/colony-stats/{colony_name}")
async def get_colony_stats(
    colony_name: str,
    current_user: dict = Depends(get_current_user)
):
    """Get statistics for a specific colony including skip information"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from urllib.parse import unquote
    colony_name = unquote(colony_name)
    
    # OPTIMIZED: Single aggregation for all colony stats
    na_owner_values = [None, "", "NA", "N/A", "na", "n/a"]
    stats_pipeline = [
        {"$match": {"colony": colony_name}},
        {"$group": {
            "_id": None,
            "total_bills": {"$sum": 1},
            "na_serial_count": {"$sum": {"$cond": [{"$eq": ["$serial_na", True]}, 1, 0]}},
            "valid_serial_count": {"$sum": {"$cond": [
                {"$and": [{"$ne": ["$serial_na", True]}, {"$gt": ["$serial_number", 0]}]}, 1, 0
            ]}},
            "with_gps": {"$sum": {"$cond": [
                {"$and": [{"$ne": ["$latitude", None]}, {"$ifNull": ["$latitude", False]}]}, 1, 0
            ]}},
            "unique_owners": {"$addToSet": "$owner_name"},
            "owner_na_count": {"$sum": {"$cond": [{"$in": ["$owner_name", na_owner_values]}, 1, 0]}},
            "self_certified_count": {"$sum": {"$cond": [{"$eq": ["$self_certified", True]}, 1, 0]}},
            "not_self_certified_count": {"$sum": {"$cond": [
                {"$or": [{"$eq": ["$self_certified", False]}, {"$not": {"$ifNull": ["$self_certified", False]}}]}, 1, 0
            ]}}
        }}
    ]
    stats_result = await get_db().bills.aggregate(stats_pipeline).to_list(1)
    stats = stats_result[0] if stats_result else {
        "total_bills": 0, "na_serial_count": 0, "valid_serial_count": 0,
        "with_gps": 0, "unique_owners": [], "owner_na_count": 0,
        "self_certified_count": 0, "not_self_certified_count": 0
    }
    
    total_bills = stats["total_bills"]
    na_serial_count = stats["na_serial_count"]
    valid_serial_count = stats["valid_serial_count"]
    with_gps = stats["with_gps"]
    unique_owners_count = len([o for o in stats.get("unique_owners", []) if o and str(o).strip()])
    owner_na_count = stats["owner_na_count"]
    self_certified_count = stats["self_certified_count"]
    not_self_certified_count = stats["not_self_certified_count"]
    
    # Get category breakdown
    category_pipeline = [
        {"$match": {"colony": colony_name}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    category_stats = await get_db().bills.aggregate(category_pipeline).to_list(None)
    
    # Get batch info for this colony (to get skip stats and messages)
    batch_ids = await get_db().bills.distinct("batch_id", {"colony": colony_name})
    skip_stats = {"skipped_na_empty": 0, "skipped_vacant": 0, "na_serial_count": na_serial_count}
    upload_messages = []
    add_to_properties_messages = []
    
    for batch_id in batch_ids:
        if batch_id:
            batch = await get_db().batches.find_one(
                {"id": batch_id}, 
                {"_id": 0, "name": 1, "skip_stats": 1, "add_to_properties_stats": 1}
            )
            if batch:
                batch_name = batch.get("name", "Unknown Batch")
                # Get PDF upload stats
                if batch.get("skip_stats"):
                    bs = batch["skip_stats"]
                    skip_stats["skipped_na_empty"] += bs.get("skipped_na_empty", 0)
                    skip_stats["skipped_vacant"] += bs.get("skipped_vacant", 0)
                    if bs.get("upload_message"):
                        upload_messages.append({
                            "batch_name": batch_name,
                            "message": bs["upload_message"]
                        })
                # Get Add to Properties stats
                if batch.get("add_to_properties_stats"):
                    aps = batch["add_to_properties_stats"]
                    if aps.get("message"):
                        add_to_properties_messages.append({
                            "batch_name": batch_name,
                            "message": aps["message"],
                            "stats": aps
                        })
    
    return {
        "colony": colony_name,
        "total_bills": total_bills,
        "na_serial_count": na_serial_count,
        "valid_serial_count": valid_serial_count,
        "with_gps": with_gps,
        "unique_owners": unique_owners_count,
        "owner_na_count": owner_na_count,
        "self_certified_count": self_certified_count,
        "not_self_certified_count": not_self_certified_count,
        "skip_stats": skip_stats,
        "upload_messages": upload_messages,
        "add_to_properties_messages": add_to_properties_messages,
        "category_breakdown": [
            {"category": stat["_id"] or "Unknown", "count": stat["count"]}
            for stat in category_stats
        ]
    }

@api_router.get("/admin/bills/all-stats")
async def get_all_bills_stats(
    current_user: dict = Depends(get_current_user)
):
    """Get statistics for ALL bills across all colonies"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    na_owner_values = [None, "", "NA", "N/A", "na", "n/a"]
    stats_pipeline = [
        {"$group": {
            "_id": None,
            "total_bills": {"$sum": 1},
            "na_serial_count": {"$sum": {"$cond": [{"$eq": ["$serial_na", True]}, 1, 0]}},
            "valid_serial_count": {"$sum": {"$cond": [
                {"$and": [{"$ne": ["$serial_na", True]}, {"$gt": ["$serial_number", 0]}]}, 1, 0
            ]}},
            "with_gps": {"$sum": {"$cond": [
                {"$and": [{"$ne": ["$latitude", None]}, {"$ifNull": ["$latitude", False]}]}, 1, 0
            ]}},
            "unique_owners": {"$addToSet": "$owner_name"},
            "owner_na_count": {"$sum": {"$cond": [{"$in": ["$owner_name", na_owner_values]}, 1, 0]}},
            "self_certified_count": {"$sum": {"$cond": [{"$eq": ["$self_certified", True]}, 1, 0]}},
            "not_self_certified_count": {"$sum": {"$cond": [
                {"$or": [{"$eq": ["$self_certified", False]}, {"$not": {"$ifNull": ["$self_certified", False]}}]}, 1, 0
            ]}}
        }}
    ]
    stats_result = await get_db().bills.aggregate(stats_pipeline).to_list(1)
    stats = stats_result[0] if stats_result else {
        "total_bills": 0, "na_serial_count": 0, "valid_serial_count": 0,
        "with_gps": 0, "unique_owners": [], "owner_na_count": 0,
        "self_certified_count": 0, "not_self_certified_count": 0
    }
    
    unique_owners_count = len([o for o in stats.get("unique_owners", []) if o and str(o).strip()])
    
    # Category breakdown
    category_pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    category_stats = await get_db().bills.aggregate(category_pipeline).to_list(None)
    
    return {
        "colony": "All Colonies",
        "total_bills": stats["total_bills"],
        "na_serial_count": stats["na_serial_count"],
        "valid_serial_count": stats["valid_serial_count"],
        "with_gps": stats["with_gps"],
        "unique_owners": unique_owners_count,
        "owner_na_count": stats["owner_na_count"],
        "self_certified_count": stats.get("self_certified_count", 0),
        "not_self_certified_count": stats.get("not_self_certified_count", 0),
        "skip_stats": {},
        "upload_messages": [],
        "add_to_properties_messages": [],
        "category_breakdown": [
            {"category": stat["_id"] or "Unknown", "count": stat["count"]}
            for stat in category_stats
        ]
    }



@api_router.put("/admin/bills/{bill_id}")
async def update_bill(
    bill_id: str,
    current_user: dict = Depends(get_current_user),
    owner_name: str = Form(None),
    mobile: str = Form(None),
    plot_address: str = Form(None),
    permanent_address: str = Form(None),
    category: str = Form(None),
    total_area: str = Form(None),
    total_outstanding: str = Form(None),
    colony: str = Form(None)
):
    """Edit bill data"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    bill = await get_db().bills.find_one({"id": bill_id})
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if owner_name is not None:
        update_data["owner_name"] = owner_name
    if mobile is not None:
        update_data["mobile"] = mobile
    if plot_address is not None:
        update_data["plot_address"] = plot_address
    if permanent_address is not None:
        update_data["permanent_address"] = permanent_address
    if category is not None:
        update_data["category"] = category
    if total_area is not None:
        update_data["total_area"] = total_area
    if total_outstanding is not None:
        update_data["total_outstanding"] = total_outstanding
    if colony is not None:
        update_data["colony"] = colony
    
    await get_db().bills.update_one({"id": bill_id}, {"$set": update_data})
    
    return {"message": "Bill updated successfully"}

@api_router.post("/admin/bills/arrange-by-route")
async def arrange_bills_by_route(
    batch_id: str = Form(None),
    colony: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Arrange bills by GPS route and assign new serial numbers (excludes N/A serial bills)"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Get all matching bills
    all_bills = await get_db().bills.find(query, {"_id": 0}).to_list(None)
    
    if not all_bills:
        raise HTTPException(status_code=404, detail="No bills found")
    
    # Separate bills with valid serial numbers from N/A serial bills
    valid_bills = [b for b in all_bills if not b.get("serial_na", False)]
    na_bills = [b for b in all_bills if b.get("serial_na", False)]
    
    if not valid_bills:
        raise HTTPException(status_code=400, detail="No bills with valid serial numbers to arrange")
    
    # Sort valid bills by GPS route
    sorted_bills = sort_by_gps_route(valid_bills)
    
    # Update serial numbers for sorted bills and mark as GPS arranged
    for i, bill in enumerate(sorted_bills):
        await get_db().bills.update_one(
            {"id": bill["id"]},
            {"$set": {"serial_number": i + 1, "gps_arranged": True}}
        )
    
    # Mark N/A bills as skipped from ordering
    for bill in na_bills:
        await get_db().bills.update_one(
            {"id": bill["id"]},
            {"$set": {"gps_arranged": False, "skipped_from_order": True}}
        )
    
    return {
        "message": f"Arranged {len(sorted_bills)} bills by GPS route. {len(na_bills)} bills with N/A serial skipped.",
        "total_arranged": len(sorted_bills),
        "skipped_na": len(na_bills)
    }

@api_router.post("/admin/bills/generate-serial-by-gps")
async def generate_serial_by_gps(
    batch_id: str = Form(None),
    colony: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Generate new serial numbers for ALL bills (including NA) based on GPS route order"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    all_bills = await get_db().bills.find(query, {"_id": 0}).to_list(None)
    
    if not all_bills:
        raise HTTPException(status_code=404, detail="No bills found")
    
    # Sort ALL bills by GPS route (including NA serial ones)
    sorted_bills = sort_by_gps_route(all_bills)
    
    # Assign new serial numbers 1, 2, 3... to ALL bills AND matching properties
    prop_updated = 0
    for i, bill in enumerate(sorted_bills):
        new_serial = i + 1
        # Update bill
        await get_db().bills.update_one(
            {"id": bill["id"]},
            {"$set": {
                "serial_number": new_serial,
                "serial_na": False,
                "gps_arranged": True,
                "gps_serial_generated": True
            }}
        )
        # Also update matching property so map shows serial number
        prop_id = bill.get("property_id", "")
        if prop_id:
            res = await get_db().properties.update_one(
                {"property_id": prop_id},
                {"$set": {
                    "serial_number": new_serial,
                    "bill_sr_no": new_serial,
                    "gps_serial_generated": True
                }}
            )
            if res.modified_count > 0:
                prop_updated += 1
    
    return {
        "message": f"Generated serial numbers 1 to {len(sorted_bills)} for all bills based on GPS route. {prop_updated} properties updated on map.",
        "total_generated": len(sorted_bills),
        "properties_updated": prop_updated
    }

@api_router.post("/admin/bills/generate-pdf")
async def generate_arranged_pdf(
    batch_id: str = Form(None),
    colony: str = Form(None),
    bills_per_page: int = Form(1),
    print_serial: str = Form("true"),
    self_certified_filter: str = Form("all"),
    skip_na_names: str = Form("true"),
    skip_vacant: str = Form("true"),
    custom_note: str = Form(""),
    note_color: str = Form("#cc0000"),
    note_target: str = Form("not_self_certified"),
    all_bills_note: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    """Generate PDF with invoices. 3 per page = landscape bills scaled & stacked vertically on A4."""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Only Admin can generate PDF")
    
    should_print_serial = print_serial.lower() == "true"
    should_skip_na = skip_na_names.lower() == "true"
    should_skip_vacant = skip_vacant.lower() == "true"
    has_all_bills_note = bool(all_bills_note and all_bills_note.strip())
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Must have at least batch or colony filter
    if "batch_id" not in query and "colony" not in query:
        raise HTTPException(status_code=400, detail="Pehle Batch ya Colony select karein")
    
    # Add self_certified filter
    if self_certified_filter == "self_certified":
        query["self_certified"] = True
    elif self_certified_filter == "not_self_certified":
        query["self_certified"] = {"$ne": True}
    
    bills = await get_db().bills.find(query, {"_id": 0}).to_list(None)
    
    # Sort by serial_number if GPS serials were generated, otherwise by page_number
    has_gps_serials = any(b.get("gps_serial_generated") for b in bills)
    if has_gps_serials:
        bills.sort(key=lambda b: b.get("serial_number", 0))
    else:
        bills.sort(key=lambda b: b.get("page_number", 0))
    
    if not bills:
        raise HTTPException(status_code=404, detail="No bills found")
    
    # Helper functions to skip vacant plots and invalid owner names (same as Add to Properties)
    def should_skip_for_pdf(bill):
        """Skip vacant plots and bills with no valid owner name"""
        owner = (bill.get("owner_name") or "").strip().lower()
        category = (bill.get("category") or "").strip().lower()
        
        # Skip if no owner name or invalid owner
        if not owner or owner in ['na', 'n/a', 'n.a.', '-', '--', 'nil', 'none']:
            return True
        
        # Skip vacant plots
        if "vacant" in category or "empty" in category:
            return True
        if "vacant" in owner or "empty plot" in owner or "खाली" in owner:
            return True
        
        return False
    
    # Filter based on individual checkbox selections
    def should_skip(bill):
        owner = (bill.get("owner_name") or "").strip().lower()
        category = (bill.get("category") or "").strip().lower()
        if should_skip_na and (not owner or owner in ['na', 'n/a', 'n.a.', '-', '--', 'nil', 'none']):
            return True
        if should_skip_vacant and ("vacant" in category or "empty" in category or "vacant" in owner or "empty plot" in owner or "खाली" in owner):
            return True
        return False
    
    valid_bills = [b for b in bills if not should_skip(b)]
    skipped_count = len(bills) - len(valid_bills)
    
    if not valid_bills:
        raise HTTPException(status_code=404, detail=f"No valid bills found (skipped {skipped_count} records based on filters)")
    
    # Keep original bills for serial number lookup (N/A serials need ALL valid serials for nearby lookup)
    all_bills_for_serial_lookup = bills
    bills = valid_bills  # Use filtered bills for PDF generation
    
    batch = await get_db().batches.find_one({"id": bills[0]["batch_id"]})
    if not batch or not batch.get("pdf_filename"):
        raise HTTPException(status_code=404, detail="Original PDF not found")
    
    original_pdf_path = await ensure_upload_local(batch["pdf_filename"])
    if not original_pdf_path.exists():
        raise HTTPException(status_code=404, detail="Original PDF file not found")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_filename = f"arranged_{colony or 'all'}_{timestamp}.pdf"
    output_path = UPLOAD_DIR / output_filename
    
    src_pdf = fitz.open(str(original_pdf_path))
    output_pdf = fitz.open()
    
    # Build serial number lookup from ALL bills (including skipped ones)
    # This ensures N/A serials can find nearby valid serials
    valid_serials_with_gps = []
    for b in all_bills_for_serial_lookup:
        if not b.get("serial_na", False) and b.get("serial_number", 0) > 0 and b.get("latitude") and b.get("longitude"):
            valid_serials_with_gps.append({
                "serial": b["serial_number"],
                "lat": b["latitude"],
                "lng": b["longitude"]
            })
    
    def get_display_serial(bill):
        """Get display serial number:
        - If bill has a valid serial_number (not 0, not NA) → use that number (e.g., 7, 42)
        - If serial is NA/blank/0 → find nearest property with valid serial based on GPS and prefix with N (e.g., N7)
        """
        bill_serial = bill.get("serial_number") or 0
        is_serial_na = bill.get("serial_na", False) or bill_serial == 0 or bill_serial is None
        
        if not is_serial_na and bill_serial > 0:
            # Has valid serial number - use it directly (e.g., 7, 42, 156)
            return str(int(bill_serial))
        else:
            # Serial is NA/blank - find nearest property based on GPS and prefix with N
            nearest_serial = 0
            if valid_serials_with_gps and bill.get("latitude") and bill.get("longitude"):
                min_distance = float('inf')
                bill_lat = float(bill["latitude"])
                bill_lng = float(bill["longitude"])
                
                for vs in valid_serials_with_gps:
                    dist = ((vs["lat"] - bill_lat) ** 2 + (vs["lng"] - bill_lng) ** 2) ** 0.5
                    if dist < min_distance:
                        min_distance = dist
                        nearest_serial = vs["serial"]
            elif valid_serials_with_gps:
                # Fallback to first valid serial if no GPS on this bill
                nearest_serial = valid_serials_with_gps[0]["serial"]
            
            # Return N-prefix with nearest serial (e.g., N7, N42)
            if nearest_serial > 0:
                return f"N{nearest_serial}"
            else:
                return "N/A"
    
    included_count = 0
    
    # Build self-certified set efficiently with single query
    self_certified_set = set()
    try:
        sc_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
        for doc in sc_docs:
            if doc.get("pid"):
                self_certified_set.add(str(doc["pid"]).upper())
    except Exception:
        pass
    async for prop in get_db().properties.find(
        {"$or": [{"self_certified": True}, {"self_certified": "Yes"}]},
        {"property_id": 1}
    ):
        if prop.get("property_id"):
            self_certified_set.add(str(prop["property_id"]).upper())
    
    logger.info(f"PDF generation: {len(self_certified_set)} self-certified property IDs found")
    
    # Parse note color from hex to RGB tuple
    def hex_to_rgb(hex_color):
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        return (204, 0, 0)  # fallback red
    
    note_rgb = hex_to_rgb(note_color)
    
    # Pre-generate custom note image ONCE (reuse for all pages)
    note_img_path = None
    if custom_note and custom_note.strip():
        try:
            from PIL import Image, ImageDraw, ImageFont
            note_text = custom_note.strip()
            note_img_path = f"/tmp/custom_note_{timestamp}.png"
            
            font_paths = [
                '/usr/share/fonts/truetype/Gargi/Gargi.ttf',
                '/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf',
                '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf',
                '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            ]
            pil_font = None
            # Font size 14 (reduced from 22 - ~50% less)
            FONT_SIZE = 14
            for fp in font_paths:
                if os.path.exists(fp):
                    try:
                        pil_font = ImageFont.truetype(fp, FONT_SIZE)
                        break
                    except Exception:
                        continue
            if not pil_font:
                pil_font = ImageFont.load_default()
            
            # Use 2x scale for better quality rendering, then save at higher DPI
            SCALE = 2
            scaled_font = None
            for fp in font_paths:
                if os.path.exists(fp):
                    try:
                        scaled_font = ImageFont.truetype(fp, FONT_SIZE * SCALE)
                        break
                    except Exception:
                        continue
            if not scaled_font:
                scaled_font = pil_font
            
            tmp_img = Image.new('RGBA', (1, 1))
            tmp_draw = ImageDraw.Draw(tmp_img)
            bbox = tmp_draw.textbbox((0, 0), note_text, font=scaled_font)
            text_w = bbox[2] - bbox[0] + 20 * SCALE
            text_h = bbox[3] - bbox[1] + 10 * SCALE
            
            note_img = Image.new('RGBA', (text_w, text_h), (255, 255, 255, 0))
            note_draw = ImageDraw.Draw(note_img)
            note_draw.text((10 * SCALE, 2 * SCALE), note_text, fill=note_rgb, font=scaled_font)
            note_img.save(note_img_path, 'PNG', dpi=(300, 300))
            logger.info(f"Pre-generated note image: {text_w}x{text_h} color={note_rgb}")
        except Exception as e:
            logger.warning(f"Could not pre-generate note image: {e}")
            note_img_path = None
    
    # Pre-generate "All Bills Note" image (same style/size as custom note, black color, for ALL bills)
    paid_note_img_path = None
    if has_all_bills_note:
        try:
            from PIL import Image, ImageDraw, ImageFont
            paid_note_text = all_bills_note.strip()
            paid_note_img_path = f"/tmp/all_bills_note_{timestamp}.png"
            
            font_paths = [
                '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
                '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            ]
            FONT_SIZE = 7  # Same size as custom note
            SCALE = 2
            scaled_font = None
            for fp in font_paths:
                if os.path.exists(fp):
                    try:
                        scaled_font = ImageFont.truetype(fp, FONT_SIZE * SCALE)
                        break
                    except Exception:
                        continue
            if not scaled_font:
                scaled_font = ImageFont.load_default()
            
            tmp_img = Image.new('RGBA', (1, 1))
            tmp_draw = ImageDraw.Draw(tmp_img)
            bbox = tmp_draw.textbbox((0, 0), paid_note_text, font=scaled_font)
            text_w = bbox[2] - bbox[0] + 20 * SCALE
            text_h = bbox[3] - bbox[1] + 10 * SCALE
            
            paid_note_img = Image.new('RGBA', (text_w, text_h), (255, 255, 255, 0))
            paid_note_draw = ImageDraw.Draw(paid_note_img)
            paid_note_draw.text((10 * SCALE, 2 * SCALE), paid_note_text, fill=(0, 0, 0), font=scaled_font)
            paid_note_img.save(paid_note_img_path, 'PNG', dpi=(300, 300))
            logger.info(f"Pre-generated all-bills note image: {text_w}x{text_h}")
        except Exception as e:
            logger.warning(f"Could not pre-generate all-bills note image: {e}")
            paid_note_img_path = None
    
    if bills_per_page == 1:
        # ONE BILL PER PAGE - Copy original page directly, add serial overlay
        for bill in bills:
            page_num = bill.get("page_number", 1) - 1
            if page_num < 0 or page_num >= len(src_pdf):
                continue
            
            # COPY page directly to preserve original quality and size
            output_pdf.insert_pdf(src_pdf, from_page=page_num, to_page=page_num)
            new_page = output_pdf[-1]  # Get the newly inserted page
            
            # Enlarge "Total Outstanding" cell text by 20%
            enlarge_total_outstanding(new_page)
            
            # Get page rotation and dimensions
            rotation = new_page.rotation
            rect = new_page.rect
            
            # Check self-certification from bill data AND properties set
            bill_prop_id = str(bill.get("property_id", "")).upper()
            is_self_certified = bill.get("self_certified", False) or (bill_prop_id in self_certified_set)
            
            # Load font for Hindi + English support
            # Try Gargi font for proper Hindi rendering
            gargi_font = '/usr/share/fonts/truetype/Gargi/Gargi.ttf'
            samyak_font = '/usr/share/fonts/truetype/samyak-fonts/Samyak-Devanagari.ttf'
            freesans_font = '/usr/share/fonts/truetype/freefont/FreeSans.ttf'
            
            try:
                if os.path.exists(gargi_font):
                    new_page.insert_font(fontname='gargi', fontbuffer=open(gargi_font, 'rb').read())
                elif os.path.exists(samyak_font):
                    new_page.insert_font(fontname='samyak', fontbuffer=open(samyak_font, 'rb').read())
                elif os.path.exists(freesans_font):
                    new_page.insert_font(fontname='freesans', fontbuffer=open(freesans_font, 'rb').read())
            except Exception as font_err:
                logger.warning(f"Could not load custom font: {font_err}")
            
            # Add serial number (LEFT side)
            if should_print_serial:
                serial_text = get_display_serial(bill)
                font_size = 18
                
                # Position: LEFT side at top with 50px padding
                if rotation == 90:
                    visual_point = fitz.Point(80, 50)  # Left side, 50px from top
                    internal_point = visual_point * new_page.derotation_matrix
                    text_rotate = 90
                elif rotation == 270:
                    visual_point = fitz.Point(rect.width - 80, rect.height - 50)
                    internal_point = visual_point * new_page.derotation_matrix
                    text_rotate = 270
                else:
                    internal_point = fitz.Point(80, 50)
                    text_rotate = 0
                
                # Insert serial number - RED BOLD
                new_page.insert_text(
                    internal_point,
                    serial_text,
                    fontsize=font_size,
                    fontname="helv",
                    color=(1, 0, 0),
                    rotate=text_rotate
                )
            
            # Add custom note based on note_target filter
            should_add_note = False
            if note_img_path and os.path.exists(note_img_path):
                if note_target == 'all':
                    should_add_note = True
                elif note_target == 'self_certified':
                    should_add_note = is_self_certified
                else:  # not_self_certified (default)
                    should_add_note = not is_self_certified
            
            if should_add_note:
                try:
                    if rotation == 90:
                        img_rect = fitz.Rect(10, 100, 60, rect.height - 10)
                    elif rotation == 270:
                        img_rect = fitz.Rect(rect.width - 60, 10, rect.width - 10, rect.height - 100)
                    else:
                        img_rect = fitz.Rect(100, 10, rect.width - 10, 60)
                    new_page.insert_image(img_rect, filename=note_img_path, rotate=rotation)
                except Exception as e:
                    logger.warning(f"Could not add note to PDF page: {e}")
            
            # Add "All Bills Note" on ALL bills (positioned next to custom note)
            if paid_note_img_path and os.path.exists(paid_note_img_path):
                try:
                    # Offset: right next to custom note if shown, else at custom note position
                    offset = 50 if should_add_note else 0
                    if rotation == 90:
                        paid_rect = fitz.Rect(10 + offset, 100, 45 + offset, rect.height - 10)
                    elif rotation == 270:
                        paid_rect = fitz.Rect(rect.width - 45 - offset, 10, rect.width - 10 - offset, rect.height - 100)
                    else:
                        paid_rect = fitz.Rect(100, 10 + offset, rect.width - 10, 45 + offset)
                    new_page.insert_image(paid_rect, filename=paid_note_img_path, rotate=rotation)
                except Exception as e:
                    logger.warning(f"Could not add all-bills note: {e}")
            
            included_count += 1
    else:
        # 2 OR 3 BILLS PER PAGE - Compact & Print quality optimized
        # A4 dimensions - slightly reduced for compact output
        A4_WIDTH = 560  # Reduced from 595.28
        A4_HEIGHT = 792  # Reduced from 841.89
        
        # Use the requested bills_per_page (2 or 3)
        num_bills = bills_per_page if bills_per_page in [2, 3] else 3
        
        # Each slot height
        slot_height = A4_HEIGHT / num_bills
        
        current_page = None
        position = 0
        
        for bill in bills:
            page_num = bill.get("page_number", 1) - 1
            if page_num < 0 or page_num >= len(src_pdf):
                continue
            
            if position == 0:
                current_page = output_pdf.new_page(width=A4_WIDTH, height=A4_HEIGHT)
            
            # Get source page and render to image (with enlarged Total Outstanding)
            tmp_doc = fitz.open()
            tmp_doc.insert_pdf(src_pdf, from_page=page_num, to_page=page_num)
            tmp_page = tmp_doc[0]
            enlarge_total_outstanding(tmp_page)
            
            # Render at 1.5x scale for good quality (150 DPI) - balanced quality/size
            mat = fitz.Matrix(1.5, 1.5)
            pix = tmp_page.get_pixmap(matrix=mat, alpha=False)
            tmp_doc.close()
            
            # Use JPEG format with 85% quality - much smaller than PNG, good quality
            img_bytes = pix.tobytes("jpeg", jpg_quality=85)
            
            # Pixmap dimensions
            pix_width = pix.width
            pix_height = pix.height
            
            # COMPACT - efficient use of space, reduced margins
            if num_bills == 2:
                # 2 bills per page - compact
                available_width = A4_WIDTH - 4
                available_height = slot_height - 2
                scale_boost = 0.88
            else:
                # 3 bills per page - very compact
                available_width = A4_WIDTH - 4
                available_height = slot_height - 1
                scale_boost = 1.30
            
            scale_w = available_width / pix_width
            scale_h = available_height / pix_height
            scale = min(scale_w, scale_h) * scale_boost
            
            final_width = pix_width * scale
            final_height = pix_height * scale
            
            # Center in slot - minimal vertical gap
            x_offset = (A4_WIDTH - final_width) / 2
            y_start = position * slot_height
            y_offset = (slot_height - final_height) / 2 * 0.3
            
            rect = fitz.Rect(
                x_offset,
                y_start + y_offset,
                x_offset + final_width,
                y_start + y_offset + final_height
            )
            
            # Insert the JPEG image
            current_page.insert_image(rect, stream=img_bytes)
            
            # Add custom note based on note_target filter
            bill_prop_id = str(bill.get("property_id", "")).upper()
            is_self_certified = bill.get("self_certified", False) or (bill_prop_id in self_certified_set)
            
            should_add_note = False
            if note_img_path and os.path.exists(note_img_path):
                if note_target == 'all':
                    should_add_note = True
                elif note_target == 'self_certified':
                    should_add_note = is_self_certified
                else:
                    should_add_note = not is_self_certified
            
            if should_add_note:
                try:
                    note_rect = fitz.Rect(rect.x0 + 5, rect.y0 + 2, rect.x1 - 5, rect.y0 + 20)
                    current_page.insert_image(note_rect, filename=note_img_path)
                except Exception as e:
                    logger.warning(f"Could not add note to compact PDF: {e}")
            
            # Add "All Bills Note" on ALL bills (compact mode)
            if paid_note_img_path and os.path.exists(paid_note_img_path):
                try:
                    paid_y = rect.y0 + (18 if should_add_note else 2)
                    paid_rect = fitz.Rect(rect.x0 + 5, paid_y, rect.x1 - 5, paid_y + 16)
                    current_page.insert_image(paid_rect, filename=paid_note_img_path)
                except Exception as e:
                    logger.warning(f"Could not add all-bills note to compact PDF: {e}")
            
            # Add serial number overlay if enabled
            if should_print_serial:
                serial_text = get_display_serial(bill)
                
                # Draw serial number - compact and readable
                font_size = 10 if num_bills == 3 else 11
                text_x = rect.x1 - len(serial_text) * font_size * 0.5 - 3
                text_y = rect.y0 + font_size + 1
                
                # White background rectangle
                bg_rect = fitz.Rect(text_x - 2, rect.y0 + 1, rect.x1 - 1, text_y + 1)
                current_page.draw_rect(bg_rect, color=(1, 1, 1), fill=(1, 1, 1))
                
                # Red bold text
                current_page.insert_text(
                    (text_x, text_y),
                    serial_text,
                    fontsize=font_size,
                    fontname="hebo",  # Helvetica Bold
                    color=(1, 0, 0)
                )
            
            included_count += 1
            position = (position + 1) % num_bills
    
    # SAVE WITH COMPRESSION - smaller file size
    output_pdf.save(
        str(output_path),
        garbage=4,           # Maximum garbage collection
        deflate=True,        # Compress streams
        clean=True,          # Clean unused objects
        deflate_images=True, # Compress images
        deflate_fonts=True   # Compress fonts
    )
    output_pdf.close()
    src_pdf.close()
    await persist_upload(output_filename)
    
    # Cleanup temp note image
    if note_img_path and os.path.exists(note_img_path):
        try:
            os.unlink(note_img_path)
        except Exception:
            pass
    
    pages_created = (included_count + bills_per_page - 1) // bills_per_page if bills_per_page > 1 else included_count
    
    return {
        "message": f"Generated {pages_created} pages with {included_count} bills ({bills_per_page} per page)",
        "filename": output_filename,
        "download_url": f"/api/uploads/{output_filename}"
    }

@api_router.post("/admin/bills/split-by-employee")
async def split_bills_by_employee(
    batch_id: str = Form(None),
    colony: str = Form(None),
    employee_count: int = Form(...),
    sn_font_size: int = Form(48),
    sn_color: str = Form("red"),
    skip_na_names: str = Form("true"),
    skip_vacant: str = Form("true"),
    custom_note: str = Form(""),
    note_color: str = Form("#cc0000"),
    note_target: str = Form("not_self_certified"),
    all_bills_note: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    """Split bills into separate PDFs for each employee"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    should_skip_na = skip_na_names.lower() == "true"
    should_skip_vacant = skip_vacant.lower() == "true"
    
    if employee_count < 1 or employee_count > 100:
        raise HTTPException(status_code=400, detail="Employee count must be between 1 and 100")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    all_bills = await get_db().bills.find(query, {"_id": 0}).sort("serial_number", 1).to_list(None)
    
    if not all_bills:
        raise HTTPException(status_code=404, detail="No bills found")
    
    def should_skip_for_pdf(bill):
        owner = (bill.get("owner_name") or "").strip().lower()
        category = (bill.get("category") or "").strip().lower()
        if not owner or owner in ['na', 'n/a', 'n.a.', '-', '--', 'nil', 'none']:
            return True
        if "vacant" in category or "empty" in category:
            return True
        if "vacant" in owner or "empty plot" in owner or "खाली" in owner:
            return True
        return False
    
    def should_skip(bill):
        owner = (bill.get("owner_name") or "").strip().lower()
        category = (bill.get("category") or "").strip().lower()
        if should_skip_na and (not owner or owner in ['na', 'n/a', 'n.a.', '-', '--', 'nil', 'none']):
            return True
        if should_skip_vacant and ("vacant" in category or "empty" in category or "vacant" in owner or "empty plot" in owner or "खाली" in owner):
            return True
        return False
    
    if should_skip_na or should_skip_vacant:
        bills = [b for b in all_bills if not should_skip(b)]
    else:
        bills = all_bills
    
    if not bills:
        raise HTTPException(status_code=404, detail="No valid bills found after filtering")
    
    # Get original PDF
    batch = await get_db().batches.find_one({"id": bills[0]["batch_id"]})
    if not batch or not batch.get("pdf_filename"):
        raise HTTPException(status_code=404, detail="Original PDF not found")
    
    original_pdf_path = await ensure_upload_local(batch["pdf_filename"])
    if not original_pdf_path.exists():
        raise HTTPException(status_code=404, detail="Original PDF file not found")
    
    # Calculate bills per employee
    total_bills = len(bills)
    bills_per_employee = math.ceil(total_bills / employee_count)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    generated_files = []
    
    # Color mapping
    color_map = {
        "red": (1, 0, 0),
        "blue": (0, 0, 1),
        "green": (0, 0.5, 0),
        "black": (0, 0, 0),
        "orange": (1, 0.5, 0)
    }
    sn_rgb = color_map.get(sn_color.lower(), (1, 0, 0))
    
    src_pdf = fitz.open(str(original_pdf_path))
    
    has_all_bills_note = bool(all_bills_note and all_bills_note.strip())
    
    # Pre-generate "All Bills Note" image for split PDFs (same size as custom note)
    paid_note_img_split = None
    if has_all_bills_note:
        try:
            from PIL import Image, ImageDraw, ImageFont
            paid_text = all_bills_note.strip()
            paid_note_img_split = f"/tmp/all_bills_note_split_{timestamp}.png"
            font_paths = ['/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
            SCALE = 2
            FONT_SIZE = 7  # Same size as custom note
            scaled_font = None
            for fp in font_paths:
                if os.path.exists(fp):
                    try:
                        scaled_font = ImageFont.truetype(fp, FONT_SIZE * SCALE)
                        break
                    except Exception:
                        continue
            if not scaled_font:
                scaled_font = ImageFont.load_default()
            tmp_img = Image.new('RGBA', (1, 1))
            tmp_draw = ImageDraw.Draw(tmp_img)
            bbox = tmp_draw.textbbox((0, 0), paid_text, font=scaled_font)
            text_w = bbox[2] - bbox[0] + 20 * SCALE
            text_h = bbox[3] - bbox[1] + 10 * SCALE
            paid_img = Image.new('RGBA', (text_w, text_h), (255, 255, 255, 0))
            paid_draw = ImageDraw.Draw(paid_img)
            paid_draw.text((10 * SCALE, 2 * SCALE), paid_text, fill=(0, 0, 0), font=scaled_font)
            paid_img.save(paid_note_img_split, 'PNG', dpi=(300, 300))
        except Exception as e:
            logger.warning(f"Could not pre-generate all-bills note for split: {e}")
            paid_note_img_split = None

    # Build serial number lookup from ALL bills for N/A serials
    valid_serials_with_gps = []
    for b in all_bills:
        if not b.get("serial_na", False) and b.get("serial_number", 0) > 0 and b.get("latitude") and b.get("longitude"):
            valid_serials_with_gps.append({
                "serial": b["serial_number"],
                "lat": b["latitude"],
                "lng": b["longitude"]
            })
    
    def get_display_serial(bill):
        """Get display serial number:
        - If bill has a valid serial_number (not 0, not NA) → use that number (e.g., 7, 42)
        - If serial is NA/blank/0 → find nearest property with valid serial based on GPS and prefix with N (e.g., N7)
        """
        bill_serial = bill.get("serial_number") or 0
        is_serial_na = bill.get("serial_na", False) or bill_serial == 0 or bill_serial is None
        
        if not is_serial_na and bill_serial > 0:
            # Has valid serial number - use it directly (e.g., 7, 42, 156)
            return str(int(bill_serial))
        else:
            # Serial is NA/blank - find nearest property based on GPS and prefix with N
            nearest_serial = 0
            if valid_serials_with_gps and bill.get("latitude") and bill.get("longitude"):
                min_distance = float('inf')
                bill_lat = float(bill["latitude"])
                bill_lng = float(bill["longitude"])
                
                for vs in valid_serials_with_gps:
                    dist = ((vs["lat"] - bill_lat) ** 2 + (vs["lng"] - bill_lng) ** 2) ** 0.5
                    if dist < min_distance:
                        min_distance = dist
                        nearest_serial = vs["serial"]
            elif valid_serials_with_gps:
                nearest_serial = valid_serials_with_gps[0]["serial"]
            
            if nearest_serial > 0:
                return f"N{nearest_serial}"
            else:
                return "N/A"
    
    for emp_idx in range(employee_count):
        start_idx = emp_idx * bills_per_employee
        end_idx = min(start_idx + bills_per_employee, total_bills)
        
        if start_idx >= total_bills:
            break
        
        employee_bills = bills[start_idx:end_idx]
        
        output_filename = f"employee_{emp_idx + 1}_{colony or 'all'}_{timestamp}.pdf"
        output_path = UPLOAD_DIR / output_filename
        
        output_pdf = fitz.open()
        
        for bill in employee_bills:
            page_num = bill.get("page_number", 1) - 1
            if page_num < 0 or page_num >= len(src_pdf):
                continue
            
            output_pdf.insert_pdf(src_pdf, from_page=page_num, to_page=page_num)
            new_page = output_pdf[-1]
            
            # Enlarge "Total Outstanding" cell text by 20%
            enlarge_total_outstanding(new_page)
            
            # Get page rotation and dimensions
            rotation = new_page.rotation
            rect = new_page.rect
            
            # Get the serial number text
            sn_text = get_display_serial(bill)
            
            # Add Hindi message FIRST (left side), then serial number (right side)
            # Both at top with 50px padding
            _is_self_certified = bill.get("self_certified", False)
            
            # Load font for Hindi + English support
            # Try Gargi font for proper Hindi rendering
            gargi_font = '/usr/share/fonts/truetype/Gargi/Gargi.ttf'
            samyak_font = '/usr/share/fonts/truetype/samyak-fonts/Samyak-Devanagari.ttf'
            freesans_font = '/usr/share/fonts/truetype/freefont/FreeSans.ttf'
            
            try:
                if os.path.exists(gargi_font):
                    new_page.insert_font(fontname='gargi', fontbuffer=open(gargi_font, 'rb').read())
                elif os.path.exists(samyak_font):
                    new_page.insert_font(fontname='samyak', fontbuffer=open(samyak_font, 'rb').read())
                elif os.path.exists(freesans_font):
                    new_page.insert_font(fontname='freesans', fontbuffer=open(freesans_font, 'rb').read())
            except Exception as font_err:
                logger.warning(f"Could not load custom font: {font_err}")
            
            # Add serial number (RIGHT side)
            if rotation == 90:
                visual_point = fitz.Point(rect.width - 80, 50)
                internal_point = visual_point * new_page.derotation_matrix
                text_rotate = 90
            elif rotation == 270:
                visual_point = fitz.Point(80, rect.height - 50)
                internal_point = visual_point * new_page.derotation_matrix
                text_rotate = 270
            else:
                internal_point = fitz.Point(rect.width - 80, 50)
                text_rotate = 0
            
            new_page.insert_text(
                internal_point, 
                sn_text, 
                fontsize=sn_font_size, 
                color=sn_rgb, 
                fontname="helv",
                rotate=text_rotate
            )
            
            # Add "All Bills Note" on ALL bills (next to serial number area)
            if paid_note_img_split and os.path.exists(paid_note_img_split):
                try:
                    if rotation == 90:
                        paid_rect = fitz.Rect(10, 100, 45, rect.height - 10)
                    elif rotation == 270:
                        paid_rect = fitz.Rect(rect.width - 45, 10, rect.width - 10, rect.height - 100)
                    else:
                        paid_rect = fitz.Rect(100, 10, rect.width - 10, 45)
                    new_page.insert_image(paid_rect, filename=paid_note_img_split, rotate=rotation)
                except Exception as e:
                    logger.warning(f"Could not add all-bills note to split PDF: {e}")
        
        output_pdf.save(
            str(output_path),
            garbage=4,  # Maximum garbage collection
            deflate=True,  # Compress streams
            deflate_images=True,  # Compress images
            deflate_fonts=True   # Compress fonts
        )
        output_pdf.close()
        await persist_upload(output_filename)
        
        generated_files.append({
            "employee_number": emp_idx + 1,
            "filename": output_filename,
            "download_url": f"/api/uploads/{output_filename}",
            "bill_range": f"SN {employee_bills[0]['serial_number']} - {employee_bills[-1]['serial_number']}",
            "total_bills": len(employee_bills)
        })
    
    src_pdf.close()
    
    return {
        "message": f"Generated {len(generated_files)} employee PDFs",
        "total_bills": total_bills,
        "bills_per_employee": bills_per_employee,
        "files": generated_files
    }

@api_router.get("/admin/bills/map-data")
async def get_bills_map_data(
    batch_id: Optional[str] = None,
    colony: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get bill data for map display"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Only get bills with GPS coordinates
    query["latitude"] = {"$ne": None}
    query["longitude"] = {"$ne": None}
    
    bills = await get_db().bills.find(query, {
        "_id": 0,
        "id": 1,
        "serial_number": 1,
        "property_id": 1,
        "owner_name": 1,
        "mobile": 1,
        "colony": 1,
        "latitude": 1,
        "longitude": 1,
        "total_outstanding": 1,
        "category": 1
    }).sort("serial_number", 1).to_list(None)
    
    return {
        "bills": bills,
        "total": len(bills)
    }

@api_router.delete("/admin/bills/batch/{batch_id}")
async def delete_bill_batch(batch_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a bill batch and all its bills"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Delete bills
    result = await get_db().bills.delete_many({"batch_id": batch_id})
    
    # Delete batch
    await get_db().batches.delete_one({"id": batch_id})
    
    return {"message": f"Deleted batch and {result.deleted_count} bills"}

@api_router.post("/admin/bills/delete-all")
async def delete_all_bills(
    batch_id: str = Form(None),
    colony: str = Form(None),
    current_user: dict = Depends(get_current_user)
):
    """Delete all bills matching the given filters. If no filters, deletes ALL bills."""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Get count first
    count = await get_db().bills.count_documents(query)
    
    if count == 0:
        return {"message": "No bills found to delete", "deleted_count": 0}
    
    # Delete the bills
    result = await get_db().bills.delete_many(query)
    
    # Update batch record counts if batch_id specified
    if batch_id and batch_id.strip():
        remaining = await get_db().bills.count_documents({"batch_id": batch_id})
        await get_db().batches.update_one(
            {"id": batch_id},
            {"$set": {"total_records": remaining}}
        )
        # If no bills left, delete the batch
        if remaining == 0:
            await get_db().batches.delete_one({"id": batch_id})
    
    return {
        "message": f"Successfully deleted {result.deleted_count} bills",
        "deleted_count": result.deleted_count
    }

@api_router.post("/admin/bills/copy-to-properties")
async def copy_bills_to_properties(
    batch_id: str = Form(None),
    colony: str = Form(None),
    skip_duplicates: str = Form("false"),
    skip_vacant_plots: str = Form("false"),
    skip_na_names: str = Form("false"),
    skip_duplicate_gps: str = Form("false"),
    current_user: dict = Depends(get_current_user)
):
    """Copy bill data to properties collection"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    _should_skip_duplicates = skip_duplicates.lower() == "true"
    should_skip_vacant = skip_vacant_plots.lower() == "true"
    should_skip_na = skip_na_names.lower() == "true"
    should_skip_duplicate_gps = skip_duplicate_gps.lower() == "true"
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Get bills to copy
    bills = await get_db().bills.find(query, {"_id": 0}).sort("serial_number", 1).to_list(None)
    
    if not bills:
        raise HTTPException(status_code=404, detail="No bills found to copy")
    
    # ALWAYS get existing property_ids to prevent duplicates
    existing_properties = await get_db().properties.find({}, {"property_id": 1, "_id": 0}).to_list(None)
    existing_property_ids = set(p.get("property_id", "") for p in existing_properties if p.get("property_id"))
    
    # Track GPS coordinates to skip duplicates
    seen_gps = set()
    skipped_duplicate_gps = 0
    
    # Create a new batch for properties
    prop_batch_id = str(uuid.uuid4())
    prop_batch_name = f"Bills Import {colony or 'All'} - {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    
    prop_batch_doc = {
        "id": prop_batch_id,
        "name": prop_batch_name,
        "uploaded_by": current_user["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "status": "ACTIVE",
        "total_records": 0,
        "source": "PDF_BILLS"
    }
    
    # First, get all valid serial numbers with GPS from bills for nearest-serial lookup
    valid_serials_with_gps = []
    for i, b in enumerate(bills):
        if not b.get("serial_na", False) and b.get("serial_number", 0) > 0 and b.get("latitude") and b.get("longitude"):
            valid_serials_with_gps.append({
                "serial": b["serial_number"],
                "lat": b["latitude"],
                "lng": b["longitude"]
            })
    
    # Skip filters (separate for NA names and vacant plots)
    def should_skip_bill(bill):
        owner = (bill.get("owner_name") or "").strip().lower()
        category = (bill.get("category") or "").strip().lower()
        if should_skip_na and (not owner or owner in ['na', 'n/a', 'n.a.', '-', '--', 'nil', 'none']):
            return "na"
        if should_skip_vacant and ("vacant" in category or "empty" in category or "vacant" in owner or "empty plot" in owner or "खाली" in owner):
            return "vacant"
        return None
    
    # Load self-certified PIDs from database for matching
    self_certified_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
    self_certified_pids = set(doc["pid"].upper() for doc in self_certified_docs)
    self_certified_count = 0
    not_self_certified_count = 0
    
    # Convert bills to properties
    properties = []
    skipped_duplicates = 0
    skipped_vacant = 0
    
    for i, bill in enumerate(bills):
        bill_prop_id = bill.get("property_id", "")
        
        # Skip based on individual filters
        skip_reason = should_skip_bill(bill)
        if skip_reason == "na":
            skipped_vacant += 1
            continue
        if skip_reason == "vacant":
            skipped_vacant += 1
            continue
        
        # Skip duplicate GPS coordinates if option is enabled
        if should_skip_duplicate_gps:
            lat = bill.get("latitude")
            lng = bill.get("longitude")
            if lat and lng:
                # Round to 6 decimal places for comparison (about 0.1m precision)
                gps_key = f"{round(lat, 6)}_{round(lng, 6)}"
                if gps_key in seen_gps:
                    skipped_duplicate_gps += 1
                    continue
                seen_gps.add(gps_key)
        
        # Check for duplicate by property_id only (same person can own multiple properties)
        if bill_prop_id and bill_prop_id in existing_property_ids:
            skipped_duplicates += 1
            continue
        
        # Use the actual BillSrNo from PDF, or mark as N/A
        bill_serial = bill.get("serial_number", 0)
        is_serial_na = bill.get("serial_na", False) or bill_serial == 0
        
        # Format N/A serials as N-X where X is the nearest valid serial BY GPS
        if is_serial_na:
            nearest_serial = 0
            if valid_serials_with_gps and bill.get("latitude") and bill.get("longitude"):
                min_distance = float('inf')
                bill_lat = bill["latitude"]
                bill_lng = bill["longitude"]
                
                for vs in valid_serials_with_gps:
                    dist = ((vs["lat"] - bill_lat) ** 2 + (vs["lng"] - bill_lng) ** 2) ** 0.5
                    if dist < min_distance:
                        min_distance = dist
                        nearest_serial = vs["serial"]
            elif valid_serials_with_gps:
                nearest_serial = valid_serials_with_gps[0]["serial"]
            
            bill_sr_no_display = f"N{nearest_serial}"
        else:
            bill_sr_no_display = str(bill_serial)
        
        # Check if this property is self-certified
        is_self_certified = bill_prop_id.upper() in self_certified_pids if bill_prop_id else False
        if is_self_certified:
            self_certified_count += 1
        else:
            not_self_certified_count += 1
        
        prop = {
            "id": str(uuid.uuid4()),
            "batch_id": prop_batch_id,
            "serial_number": bill_serial if not is_serial_na else 0,
            "serial_na": is_serial_na,
            "bill_sr_no": bill_sr_no_display,
            "property_id": bill_prop_id if bill_prop_id else str(uuid.uuid4())[:8].upper(),
            "old_property_id": bill.get("old_property_id", ""),
            "owner_name": bill.get("owner_name", "Unknown"),
            "mobile": bill.get("mobile", ""),
            "address": bill.get("plot_address", ""),
            "colony": bill.get("colony", ""),
            "ward": bill.get("colony", ""),  # Use colony as ward
            "latitude": bill.get("latitude"),
            "longitude": bill.get("longitude"),
            "total_area": bill.get("total_area", ""),
            "category": bill.get("category", ""),
            "amount": bill.get("total_outstanding", "0"),
            "financial_year": bill.get("financial_year", "2025-2026"),
            "assigned_employee_id": None,
            "assigned_employee_name": None,
            "status": "Pending",
            "self_certified": is_self_certified,  # NEW: Self-certification status
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_bill_id": bill.get("id")  # Reference to original bill
        }
        properties.append(prop)
        
        # Add to existing set to prevent duplicates within same batch
        if bill_prop_id:
            existing_property_ids.add(bill_prop_id)
    
    # Build detailed message
    msg_parts = [f"Successfully added {len(properties)} bills to properties"]
    if self_certified_count > 0:
        msg_parts.append(f"{self_certified_count} self-certified")
    if not_self_certified_count > 0:
        msg_parts.append(f"{not_self_certified_count} not self-certified")
    if skipped_duplicates > 0:
        msg_parts.append(f"Skipped {skipped_duplicates} duplicates")
    if skipped_vacant > 0:
        msg_parts.append(f"Skipped {skipped_vacant} vacant plots")
    if skipped_duplicate_gps > 0:
        msg_parts.append(f"Skipped {skipped_duplicate_gps} duplicate GPS")
    
    # Save detailed stats to batch
    add_to_properties_stats = {
        "total_added": len(properties),
        "self_certified": self_certified_count,
        "not_self_certified": not_self_certified_count,
        "skipped_duplicates": skipped_duplicates,
        "skipped_vacant": skipped_vacant,
        "skipped_duplicate_gps": skipped_duplicate_gps,
        "message": ". ".join(msg_parts) + "."
    }
    
    # Insert properties
    if properties:
        # Auto-merge photo_url from permanent property_photos collection
        prop_pids = [p["property_id"] for p in properties if p.get("property_id")]
        if prop_pids:
            photo_docs = await get_db().property_photos.find(
                {"property_id": {"$in": prop_pids}}, {"property_id": 1, "photo_url": 1, "_id": 0}
            ).to_list(None)
            photo_map = {d["property_id"]: d["photo_url"] for d in photo_docs if d.get("photo_url")}
            
            if photo_map:
                photos_merged = 0
                for prop in properties:
                    pid = prop.get("property_id", "")
                    if pid in photo_map:
                        prop["photo_url"] = photo_map[pid]
                        photos_merged += 1
                    elif pid.upper() in photo_map:
                        prop["photo_url"] = photo_map[pid.upper()]
                        photos_merged += 1
                logger.info(f"  Auto-merged {photos_merged} photos from permanent property_photos collection")
        
        await get_db().properties.insert_many(properties)
        prop_batch_doc["total_records"] = len(properties)
        prop_batch_doc["add_to_properties_stats"] = add_to_properties_stats
        await get_db().batches.update_one({"id": prop_batch_id}, {"$set": {"total_records": len(properties)}})
    
    # Also update the source PDF batch with these stats
    if batch_id:
        await get_db().batches.update_one(
            {"id": batch_id},
            {"$set": {"add_to_properties_stats": add_to_properties_stats}}
        )
    
    await get_db().batches.insert_one(prop_batch_doc)
    
    return {
        "message": ". ".join(msg_parts) + ".",
        "batch_id": prop_batch_id,
        "batch_name": prop_batch_name,
        "total_added": len(properties),
        "self_certified": self_certified_count,
        "not_self_certified": not_self_certified_count,
        "skipped_duplicates": skipped_duplicates,
        "skipped_vacant": skipped_vacant,
        "skipped_duplicate_gps": skipped_duplicate_gps
    }


@api_router.post("/admin/properties/cleanup-duplicates")
async def cleanup_duplicate_properties(
    current_user: dict = Depends(get_current_user)
):
    """Remove duplicate properties and orphans. Reassign submissions before deleting."""
    if current_user["role"] not in ["ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = get_db()
    
    # Step 1: Build submission map - property internal id -> has submission
    submission_prop_ids = set()
    subs = await town_db.submissions.find({}, {"_id": 0, "property_record_id": 1}).to_list(None)
    for s in subs:
        if s.get("property_record_id"):
            submission_prop_ids.add(s["property_record_id"])
    
    # Step 2: Find all properties grouped by property_id (the human-readable ID from bill)
    pipeline = [
        {"$group": {
            "_id": "$property_id",
            "count": {"$sum": 1},
            "ids": {"$push": "$id"},
            "statuses": {"$push": "$status"}
        }},
        {"$match": {"count": {"$gt": 1}}}
    ]
    duplicates = await town_db.properties.aggregate(pipeline).to_list(None)
    
    total_removed = 0
    reassigned_submissions = 0
    
    for dup in duplicates:
        prop_ids = dup["ids"]
        
        # Decide which to keep: prefer one with submission, then best status, then first
        keep_id = None
        # First pass: find one with submission
        for pid in prop_ids:
            if pid in submission_prop_ids:
                keep_id = pid
                break
        
        if not keep_id:
            # Keep the one with best status
            for pid, status in zip(prop_ids, dup["statuses"]):
                if status in ["Approved", "Completed", "Submitted"]:
                    keep_id = pid
                    break
            if not keep_id:
                keep_id = prop_ids[0]
        
        # All others will be deleted
        to_delete = [pid for pid in prop_ids if pid != keep_id]
        
        # Reassign any submissions from to_delete properties to the kept property
        for del_pid in to_delete:
            if del_pid in submission_prop_ids:
                update_result = await town_db.submissions.update_many(
                    {"property_record_id": del_pid},
                    {"$set": {"property_record_id": keep_id}}
                )
                reassigned_submissions += update_result.modified_count
        
        # Now safe to delete all duplicates
        if to_delete:
            result = await town_db.properties.delete_many({"id": {"$in": to_delete}})
            total_removed += result.deleted_count
    
    # Step 3: Remove orphan properties (property_id NOT in any bill)
    bill_pids = set()
    bills = await town_db.bills.find({}, {"_id": 0, "property_id": 1}).to_list(None)
    for b in bills:
        if b.get("property_id"):
            bill_pids.add(b["property_id"])
    
    orphan_count = 0
    if bill_pids:
        # Refresh submission_prop_ids after reassignment
        subs_fresh = await town_db.submissions.find({}, {"_id": 0, "property_record_id": 1}).to_list(None)
        fresh_sub_pids = set(s["property_record_id"] for s in subs_fresh if s.get("property_record_id"))
        
        all_props = await town_db.properties.find({}, {"_id": 0, "id": 1, "property_id": 1}).to_list(None)
        orphan_ids = []
        for p in all_props:
            pid = p.get("property_id", "")
            if pid and pid not in bill_pids and p["id"] not in fresh_sub_pids:
                orphan_ids.append(p["id"])
        
        if orphan_ids:
            for i in range(0, len(orphan_ids), 500):
                batch = orphan_ids[i:i+500]
                result = await town_db.properties.delete_many({"id": {"$in": batch}})
                orphan_count += result.deleted_count
    
    # Final counts
    final_props = await town_db.properties.count_documents({})
    final_bills = await town_db.bills.count_documents({})
    
    return {
        "message": f"Cleanup complete! Removed {total_removed} duplicates + {orphan_count} orphans. Reassigned {reassigned_submissions} submissions.",
        "duplicates_removed": total_removed,
        "orphans_removed": orphan_count,
        "reassigned_submissions": reassigned_submissions,
        "final_properties_count": final_props,
        "final_bills_count": final_bills,
        "synced": final_props <= final_bills
    }


@api_router.post("/admin/bills/split-by-employees")
async def split_bills_by_specific_employees(
    batch_id: str = Form(None),
    colony: str = Form(None),
    employee_ids: str = Form(...),  # Comma-separated employee IDs
    sn_font_size: int = Form(48),
    sn_color: str = Form("red"),
    custom_note: str = Form(""),
    note_color: str = Form("#cc0000"),
    note_target: str = Form("not_self_certified"),
    all_bills_note: str = Form(""),
    current_user: dict = Depends(get_current_user)
):
    """Split bills among specific employees and generate separate PDFs"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Parse employee IDs
    emp_ids = [e.strip() for e in employee_ids.split(",") if e.strip()]
    
    if not emp_ids:
        raise HTTPException(status_code=400, detail="At least one employee must be selected")
    
    # Verify employees exist
    employees = []
    for emp_id in emp_ids:
        emp = await master_db.users.find_one({"id": emp_id}, {"_id": 0, "id": 1, "name": 1, "username": 1})
        if emp:
            employees.append(emp)
    
    if not employees:
        raise HTTPException(status_code=404, detail="No valid employees found")
    
    query = {}
    if batch_id and batch_id.strip():
        query["batch_id"] = batch_id
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony.strip())}$", "$options": "i"}
    
    # Get arranged bills
    bills = await get_db().bills.find(query, {"_id": 0}).sort("serial_number", 1).to_list(None)
    
    if not bills:
        raise HTTPException(status_code=404, detail="No bills found")
    
    # Get original PDF
    batch = await get_db().batches.find_one({"id": bills[0]["batch_id"]})
    if not batch or not batch.get("pdf_filename"):
        raise HTTPException(status_code=404, detail="Original PDF not found")
    
    original_pdf_path = await ensure_upload_local(batch["pdf_filename"])
    if not original_pdf_path.exists():
        raise HTTPException(status_code=404, detail="Original PDF file not found")
    
    # Calculate bills per employee
    total_bills = len(bills)
    employee_count = len(employees)
    bills_per_employee = math.ceil(total_bills / employee_count)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    generated_files = []
    
    # Build comprehensive self-certified property ID set
    self_certified_set = set()
    try:
        sc_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
        for doc in sc_docs:
            if doc.get("pid"):
                self_certified_set.add(str(doc["pid"]).upper())
    except Exception:
        pass
    async for prop in get_db().properties.find({"self_certified": True}, {"property_id": 1}):
        if prop.get("property_id"):
            self_certified_set.add(str(prop["property_id"]).upper())
    async for prop in get_db().properties.find({"self_certified": "Yes"}, {"property_id": 1}):
        if prop.get("property_id"):
            self_certified_set.add(str(prop["property_id"]).upper())
    
    # Color mapping
    color_map = {
        "red": (1, 0, 0),
        "blue": (0, 0, 1),
        "green": (0, 0.5, 0),
        "black": (0, 0, 0),
        "orange": (1, 0.5, 0)
    }
    sn_rgb = color_map.get(sn_color.lower(), (1, 0, 0))
    
    src_pdf = fitz.open(str(original_pdf_path))
    
    has_all_bills_note = bool(all_bills_note and all_bills_note.strip())
    
    # Pre-generate "All Bills Note" image (same size as custom note)
    paid_note_img_spec = None
    if has_all_bills_note:
        try:
            from PIL import Image, ImageDraw, ImageFont
            paid_text = all_bills_note.strip()
            paid_note_img_spec = f"/tmp/all_bills_note_spec_{timestamp}.png"
            font_paths = ['/usr/share/fonts/truetype/freefont/FreeSansBold.ttf', '/usr/share/fonts/truetype/freefont/FreeSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
            SCALE = 2
            FONT_SIZE = 7  # Same size as custom note
            scaled_font = None
            for fp in font_paths:
                if os.path.exists(fp):
                    try:
                        scaled_font = ImageFont.truetype(fp, FONT_SIZE * SCALE)
                        break
                    except Exception:
                        continue
            if not scaled_font:
                scaled_font = ImageFont.load_default()
            tmp_img = Image.new('RGBA', (1, 1))
            tmp_draw = ImageDraw.Draw(tmp_img)
            bbox = tmp_draw.textbbox((0, 0), paid_text, font=scaled_font)
            text_w = bbox[2] - bbox[0] + 20 * SCALE
            text_h = bbox[3] - bbox[1] + 10 * SCALE
            paid_img = Image.new('RGBA', (text_w, text_h), (255, 255, 255, 0))
            paid_draw = ImageDraw.Draw(paid_img)
            paid_draw.text((10 * SCALE, 2 * SCALE), paid_text, fill=(0, 0, 0), font=scaled_font)
            paid_img.save(paid_note_img_spec, 'PNG', dpi=(300, 300))
        except Exception as e:
            logger.warning(f"Could not pre-generate all-bills note for specific split: {e}")
            paid_note_img_spec = None

    # Build serial number lookup from ALL bills for N/A serials
    valid_serials_with_gps = []
    for b in bills:
        if not b.get("serial_na", False) and b.get("serial_number", 0) > 0 and b.get("latitude") and b.get("longitude"):
            valid_serials_with_gps.append({
                "serial": b["serial_number"],
                "lat": b["latitude"],
                "lng": b["longitude"]
            })
    
    def get_display_serial(bill):
        """Get display serial number:
        - If bill has a valid serial_number (not 0, not NA) → use that number (e.g., 7, 42)
        - If serial is NA/blank/0 → find nearest property with valid serial based on GPS and prefix with N (e.g., N7)
        """
        bill_serial = bill.get("serial_number") or 0
        is_serial_na = bill.get("serial_na", False) or bill_serial == 0 or bill_serial is None
        
        if not is_serial_na and bill_serial > 0:
            # Has valid serial number - use it directly (e.g., 7, 42, 156)
            return str(int(bill_serial))
        else:
            # Serial is NA/blank - find nearest property based on GPS and prefix with N
            nearest_serial = 0
            if valid_serials_with_gps and bill.get("latitude") and bill.get("longitude"):
                min_distance = float('inf')
                bill_lat = float(bill["latitude"])
                bill_lng = float(bill["longitude"])
                
                for vs in valid_serials_with_gps:
                    dist = ((vs["lat"] - bill_lat) ** 2 + (vs["lng"] - bill_lng) ** 2) ** 0.5
                    if dist < min_distance:
                        min_distance = dist
                        nearest_serial = vs["serial"]
            elif valid_serials_with_gps:
                nearest_serial = valid_serials_with_gps[0]["serial"]
            
            if nearest_serial > 0:
                return f"N{nearest_serial}"
            else:
                return "N/A"
    
    for emp_idx, emp in enumerate(employees):
        start_idx = emp_idx * bills_per_employee
        end_idx = min(start_idx + bills_per_employee, total_bills)
        
        if start_idx >= total_bills:
            break
        
        employee_bills = bills[start_idx:end_idx]
        
        # Use employee name in filename (sanitize for filename)
        emp_name_safe = re.sub(r'[^\w\-_]', '_', emp.get('name', f'emp_{emp_idx+1}'))
        output_filename = f"{emp_name_safe}_{colony or 'all'}_{timestamp}.pdf"
        output_path = UPLOAD_DIR / output_filename
        
        output_pdf = fitz.open()
        
        for bill in employee_bills:
            page_num = bill.get("page_number", 1) - 1
            if page_num < 0 or page_num >= len(src_pdf):
                continue
            
            # Simply copy the page as-is
            output_pdf.insert_pdf(src_pdf, from_page=page_num, to_page=page_num)
            new_page = output_pdf[-1]
            
            # Enlarge "Total Outstanding" cell text by 20%
            enlarge_total_outstanding(new_page)
            
            # Get page rotation and dimensions
            rotation = new_page.rotation
            rect = new_page.rect
            
            # Get the serial number text
            sn_text = get_display_serial(bill)
            
            # Check self-certification from bill data AND properties set
            bill_prop_id = str(bill.get("property_id", "")).upper()
            is_self_certified = bill.get("self_certified", False) or (bill_prop_id in self_certified_set)
            
            # Load font for Hindi + English support
            # Try Gargi font for proper Hindi rendering
            gargi_font = '/usr/share/fonts/truetype/Gargi/Gargi.ttf'
            samyak_font = '/usr/share/fonts/truetype/samyak-fonts/Samyak-Devanagari.ttf'
            freesans_font = '/usr/share/fonts/truetype/freefont/FreeSans.ttf'
            
            try:
                if os.path.exists(gargi_font):
                    new_page.insert_font(fontname='gargi', fontbuffer=open(gargi_font, 'rb').read())
                elif os.path.exists(samyak_font):
                    new_page.insert_font(fontname='samyak', fontbuffer=open(samyak_font, 'rb').read())
                elif os.path.exists(freesans_font):
                    new_page.insert_font(fontname='freesans', fontbuffer=open(freesans_font, 'rb').read())
            except Exception as font_err:
                logger.warning(f"Could not load custom font: {font_err}")
            
            # Add serial number (RIGHT side)
            if rotation == 90:
                visual_point = fitz.Point(rect.width - 80, 50)
                internal_point = visual_point * new_page.derotation_matrix
                text_rotate = 90
            elif rotation == 270:
                visual_point = fitz.Point(80, rect.height - 50)
                internal_point = visual_point * new_page.derotation_matrix
                text_rotate = 270
            else:
                internal_point = fitz.Point(rect.width - 80, 50)
                text_rotate = 0
            
            new_page.insert_text(
                internal_point, 
                sn_text, 
                fontsize=sn_font_size, 
                color=sn_rgb, 
                fontname="helv",
                rotate=text_rotate
            )
            
            # Add custom note based on note_target filter
            should_add_note = False
            if custom_note and custom_note.strip():
                if note_target == 'all':
                    should_add_note = True
                elif note_target == 'self_certified':
                    should_add_note = is_self_certified
                else:
                    should_add_note = not is_self_certified
            
            if should_add_note:
                try:
                    note_img_path_split = f"/tmp/custom_note_split_{timestamp}.png"
                    if not os.path.exists(note_img_path_split):
                        from PIL import Image, ImageDraw, ImageFont
                        note_text = custom_note.strip()
                        
                        # Parse note color
                        hex_c = note_color.lstrip('#')
                        if len(hex_c) == 6:
                            n_rgb = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4))
                        else:
                            n_rgb = (204, 0, 0)
                        
                        font_paths = [
                            '/usr/share/fonts/truetype/Gargi/Gargi.ttf',
                            '/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf',
                            '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf',
                            '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
                        ]
                        # Use 2x scale for better quality
                        FONT_SIZE = 14
                        SCALE = 2
                        scaled_font = None
                        for fp in font_paths:
                            if os.path.exists(fp):
                                try:
                                    scaled_font = ImageFont.truetype(fp, FONT_SIZE * SCALE)
                                    break
                                except Exception:
                                    continue
                        if not scaled_font:
                            scaled_font = ImageFont.load_default()
                        tmp_img = Image.new('RGBA', (1, 1))
                        tmp_draw = ImageDraw.Draw(tmp_img)
                        bbox = tmp_draw.textbbox((0, 0), note_text, font=scaled_font)
                        text_w = bbox[2] - bbox[0] + 20 * SCALE
                        text_h = bbox[3] - bbox[1] + 10 * SCALE
                        note_img = Image.new('RGBA', (text_w, text_h), (255, 255, 255, 0))
                        note_draw = ImageDraw.Draw(note_img)
                        note_draw.text((10 * SCALE, 2 * SCALE), note_text, fill=n_rgb, font=scaled_font)
                        note_img.save(note_img_path_split, 'PNG', dpi=(300, 300))
                    
                    if rotation == 90:
                        img_rect = fitz.Rect(477, 5, 542, 590)
                    elif rotation == 270:
                        img_rect = fitz.Rect(rect.width - 542, rect.height - 590, rect.width - 477, rect.height - 5)
                    else:
                        img_rect = fitz.Rect(5, rect.height - 390, rect.width - 5, rect.height - 325)
                    new_page.insert_image(img_rect, filename=note_img_path_split, rotate=rotation)
                except Exception as e:
                    logger.warning(f"Could not add custom note to split PDF: {e}")
            
            # Add "All Bills Note" on ALL bills (next to custom note)
            if paid_note_img_spec and os.path.exists(paid_note_img_spec):
                try:
                    if rotation == 90:
                        paid_rect = fitz.Rect(10, 100, 45, rect.height - 10)
                    elif rotation == 270:
                        paid_rect = fitz.Rect(rect.width - 45, 10, rect.width - 10, rect.height - 100)
                    else:
                        paid_rect = fitz.Rect(100, 10, rect.width - 10, 45)
                    new_page.insert_image(paid_rect, filename=paid_note_img_spec, rotate=rotation)
                except Exception as e:
                    logger.warning(f"Could not add all-bills note to specific split PDF: {e}")
        
        output_pdf.save(
            str(output_path),
            garbage=4,  # Maximum garbage collection
            deflate=True,  # Compress streams
            deflate_images=True,  # Compress images
            deflate_fonts=True   # Compress fonts
        )
        output_pdf.close()
        await persist_upload(output_filename)
        
        generated_files.append({
            "employee_id": emp["id"],
            "employee_name": emp.get("name", emp.get("username", f"Employee {emp_idx+1}")),
            "filename": output_filename,
            "download_url": f"/api/uploads/{output_filename}",
            "bill_range": f"SR {employee_bills[0]['serial_number']} - {employee_bills[-1]['serial_number']}",
            "total_bills": len(employee_bills)
        })
    
    src_pdf.close()
    
    return {
        "message": f"Generated PDFs for {len(generated_files)} employees",
        "total_bills": total_bills,
        "bills_per_employee": bills_per_employee,
        "files": generated_files
    }

# ============== GENERATED PDFs MANAGEMENT ==============

class GeneratedPdfRecord(BaseModel):
    colony: str
    filename: str
    download_url: str
    pdf_type: str  # "arranged_bills", "survey_report", "property_list"
    total_records: int
    file_size: Optional[int] = None

@api_router.post("/admin/generated-pdfs/save")
async def save_generated_pdf(
    colony: str = Form(...),
    filename: str = Form(...),
    download_url: str = Form(...),
    pdf_type: str = Form("arranged_bills"),
    total_records: int = Form(0),
    current_user: dict = Depends(get_current_user)
):
    """Save a generated PDF record to database for later download"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get file size if exists
    file_path = await ensure_upload_local(filename)
    file_size = file_path.stat().st_size if file_path.exists() else 0
    
    pdf_doc = {
        "id": str(uuid.uuid4()),
        "colony": colony,
        "filename": filename,
        "download_url": download_url,
        "pdf_type": pdf_type,
        "total_records": total_records,
        "file_size": file_size,
        "created_by": current_user["id"],
        "created_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await get_db().generated_pdfs.insert_one(pdf_doc)
    
    return {
        "message": "PDF record saved",
        "id": pdf_doc["id"],
        "filename": filename
    }

@api_router.get("/admin/generated-pdfs")
async def list_generated_pdfs(
    colony: Optional[str] = None,
    pdf_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """List all generated PDFs, optionally filtered by colony"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = {}
    if colony and colony.strip():
        query["colony"] = {"$regex": f"^{re.escape(colony)}$", "$options": "i"}
    if pdf_type and pdf_type.strip():
        query["pdf_type"] = pdf_type
    
    pdfs = await get_db().generated_pdfs.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    
    # Check which files still exist
    for pdf in pdfs:
        file_path = await ensure_upload_local(pdf["filename"])
        pdf["file_exists"] = file_path.exists()
        if pdf["file_exists"] and not pdf.get("file_size"):
            pdf["file_size"] = file_path.stat().st_size
    
    return {"pdfs": pdfs, "total": len(pdfs)}

@api_router.get("/admin/generated-pdfs/by-colony")
async def get_pdfs_by_colony(current_user: dict = Depends(get_current_user)):
    """Get grouped list of generated PDFs by colony"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    pipeline = [
        {"$match": {}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$colony",
            "latest_pdf": {"$first": "$$ROOT"},
            "total_pdfs": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    result = await get_db().generated_pdfs.aggregate(pipeline).to_list(None)
    
    colonies_with_pdfs = []
    for r in result:
        pdf = r["latest_pdf"]
        file_path = await ensure_upload_local(pdf["filename"])
        colonies_with_pdfs.append({
            "colony": r["_id"],
            "total_pdfs": r["total_pdfs"],
            "latest_filename": pdf["filename"],
            "latest_download_url": pdf["download_url"],
            "latest_created_at": pdf["created_at"],
            "latest_total_records": pdf.get("total_records", 0),
            "file_exists": file_path.exists()
        })
    
    return {"colonies": colonies_with_pdfs}

@api_router.delete("/admin/generated-pdfs/{pdf_id}")
async def delete_generated_pdf(pdf_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a generated PDF record and optionally the file"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    pdf = await get_db().generated_pdfs.find_one({"id": pdf_id}, {"_id": 0})
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF record not found")
    
    await delete_upload(pdf["filename"])
    
    await get_db().generated_pdfs.delete_one({"id": pdf_id})
    
    return {"message": "PDF record deleted", "filename": pdf["filename"]}

@api_router.get("/admin/generated-pdfs/download/{filename}")
async def download_generated_pdf(filename: str, current_user: dict = Depends(get_current_user)):
    """Download a previously generated PDF file"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    
    file_path = await ensure_upload_local(filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    
    return FileResponse(
        path=str(file_path),
        media_type='application/pdf',
        filename=filename,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )

# ============== INITIALIZATION ==============

@api_router.get("/")
async def root():
    return {"message": "PHED Survey & Notice Distribution API"}

# ==============================================
# SELF CERTIFICATION ENDPOINTS
# ==============================================

@api_router.post("/admin/upload-self-certification")
async def upload_self_certification(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload self-certification Excel/CSV file to store certified property IDs"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Please upload an Excel (.xlsx, .xls) or CSV file")
    
    try:
        # Read the file
        contents = await file.read()
        
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))
        
        # Find the PID column (could be 'PID (C)' or similar)
        pid_column = None
        for col in df.columns:
            if 'PID' in col.upper() or 'PROPERTY' in col.upper() and 'ID' in col.upper():
                pid_column = col
                break
        
        if not pid_column:
            # Try first column if no PID column found
            pid_column = df.columns[0] if len(df.columns) > 0 else None
        
        if not pid_column:
            raise HTTPException(status_code=400, detail="Could not find Property ID column in Excel file")
        
        # Extract unique PIDs
        pids = df[pid_column].dropna().astype(str).str.strip().str.upper().unique().tolist()
        
        if not pids:
            raise HTTPException(status_code=400, detail="No property IDs found in the file")
        
        # Store in database - create or update the self_certified_pids collection
        # First, get existing PIDs to avoid duplicates
        existing = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
        existing_pids = set(p["pid"] for p in existing)
        
        # Only insert new PIDs
        new_pids = [pid for pid in pids if pid not in existing_pids]
        
        if new_pids:
            docs = [{"pid": pid, "uploaded_at": datetime.now(timezone.utc).isoformat()} for pid in new_pids]
            await get_db().self_certified_pids.insert_many(docs)
        
        # Create index for fast lookups
        await get_db().self_certified_pids.create_index("pid")
        
        # AUTO-SYNC: Use bulk update_many instead of iterating each bill
        all_sc_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
        all_sc_pids = list(set(doc["pid"].upper() for doc in all_sc_docs if doc.get("pid")))
        
        # Also from properties collection
        sc_props = await get_db().properties.find(
            {"$or": [{"self_certified": True}, {"self_certified": "Yes"}]},
            {"property_id": 1, "_id": 0}
        ).to_list(None)
        for prop in sc_props:
            if prop.get("property_id"):
                pid = str(prop["property_id"]).upper()
                if pid not in all_sc_pids:
                    all_sc_pids.append(pid)
        
        # FAST: Two bulk updates instead of iterating each bill
        synced_true = 0
        synced_false = 0
        
        if all_sc_pids:
            # Mark matching bills as self_certified = True
            result_true = await get_db().bills.update_many(
                {"property_id": {"$in": all_sc_pids}, "self_certified": {"$ne": True}},
                {"$set": {"self_certified": True}}
            )
            synced_true = result_true.modified_count
            
            # Also try case-insensitive match for remaining
            all_sc_pids_lower = [p.lower() for p in all_sc_pids]
            
            # Mark non-matching bills as self_certified = False
            result_false = await get_db().bills.update_many(
                {"property_id": {"$nin": all_sc_pids}, "self_certified": True},
                {"$set": {"self_certified": False}}
            )
            synced_false = result_false.modified_count
            
            # Update properties collection too
            await get_db().properties.update_many(
                {"property_id": {"$in": all_sc_pids}, "self_certified": {"$ne": True}},
                {"$set": {"self_certified": True}}
            )
        
        logger.info(f"Auto-sync after upload: {synced_true} bills marked certified, {synced_false} unmarked")
        
        return {
            "message": f"Uploaded {len(new_pids)} new PIDs. Auto-synced: {synced_true} bills marked self-certified.",
            "total_in_file": len(pids),
            "new_added": len(new_pids),
            "already_existed": len(pids) - len(new_pids),
            "total_in_database": len(existing_pids) + len(new_pids),
            "bills_synced_to_true": synced_true,
            "bills_synced_to_false": synced_false
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@api_router.get("/admin/self-certification-stats")
async def get_self_certification_stats(current_user: dict = Depends(get_current_user)):
    """Get statistics about self-certified properties"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    total_certified = await get_db().self_certified_pids.count_documents({})
    
    return {
        "total_self_certified_pids": total_certified
    }

@api_router.delete("/admin/clear-self-certification")
async def clear_self_certification(current_user: dict = Depends(get_current_user)):
    """Clear all self-certification data (use with caution)"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Super Admin access required")
    
    result = await get_db().self_certified_pids.delete_many({})
    
    return {
        "message": f"Cleared {result.deleted_count} self-certified PIDs"
    }

@api_router.post("/admin/sync-self-certified")
async def sync_self_certified(current_user: dict = Depends(get_current_user)):
    """Sync self_certified status on bills from properties + self_certified_pids collections"""
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Build comprehensive self-certified set
    self_certified_pids = set()
    
    # From self_certified_pids collection
    sc_docs = await get_db().self_certified_pids.find({}, {"pid": 1, "_id": 0}).to_list(None)
    for doc in sc_docs:
        if doc.get("pid"):
            self_certified_pids.add(str(doc["pid"]).upper())
    
    # From properties collection
    async for prop in get_db().properties.find(
        {"$or": [{"self_certified": True}, {"self_certified": "Yes"}]},
        {"property_id": 1}
    ):
        if prop.get("property_id"):
            self_certified_pids.add(str(prop["property_id"]).upper())
    
    if not self_certified_pids:
        return {"message": "No self-certified PIDs found in database", "updated": 0}
    
    sc_pids_list = list(self_certified_pids)
    
    # FAST: Two bulk updates instead of iterating each bill
    result_true = await get_db().bills.update_many(
        {"property_id": {"$in": sc_pids_list}, "self_certified": {"$ne": True}},
        {"$set": {"self_certified": True}}
    )
    updated_true = result_true.modified_count
    
    result_false = await get_db().bills.update_many(
        {"property_id": {"$nin": sc_pids_list}, "self_certified": True},
        {"$set": {"self_certified": False}}
    )
    updated_false = result_false.modified_count
    
    # Also update properties collection
    await get_db().properties.update_many(
        {"property_id": {"$in": sc_pids_list}, "self_certified": {"$ne": True}},
        {"$set": {"self_certified": True}}
    )
    
    return {
        "message": f"Synced! {updated_true} bills marked self-certified, {updated_false} bills marked not-certified",
        "total_certified_pids": len(self_certified_pids),
        "updated_to_true": updated_true,
        "updated_to_false": updated_false
    }


@api_router.post("/admin/sync-property-data")
async def sync_property_data_from_bills(current_user: dict = Depends(get_current_user)):
    """Sync amount, category, total_area from bills to properties collection"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only")
    
    from pymongo import UpdateOne
    
    # Fetch all bills with relevant fields
    bills = await get_db().bills.find(
        {},
        {"_id": 0, "property_id": 1, "total_outstanding": 1, "amount": 1, "category": 1, "total_area": 1}
    ).to_list(None)
    
    bills_map = {}
    for b in bills:
        pid = b.get("property_id", "")
        if pid and pid not in bills_map:
            bills_map[pid] = b
    
    # Build bulk updates
    operations = []
    for pid, bill in bills_map.items():
        update_fields = {}
        amount = bill.get("total_outstanding") or bill.get("amount")
        if amount and str(amount) != "0":
            update_fields["amount"] = str(amount)
        category = bill.get("category")
        if category:
            update_fields["category"] = category
        total_area = bill.get("total_area")
        if total_area:
            update_fields["total_area"] = total_area
        
        if update_fields:
            operations.append(UpdateOne(
                {"property_id": pid},
                {"$set": update_fields}
            ))
    
    updated = 0
    if operations:
        # Process in batches
        batch_size = 2000
        for i in range(0, len(operations), batch_size):
            batch = operations[i:i+batch_size]
            result = await get_db().properties.bulk_write(batch, ordered=False)
            updated += result.modified_count
    
    return {
        "message": f"Synced {updated} properties with bill data (amount, category, total_area)",
        "total_bills": len(bills_map),
        "updated_properties": updated
    }


@api_router.post("/admin/upload-old-photos")
async def upload_old_photos(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload old-photo Excel file to update property photo_url for the current town.
    Expected format: Column A = Property ID, Column B = Photo URL, Row 1 = Header
    """
    if current_user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Please upload an Excel (.xlsx, .xls) file")
    
    contents = await file.read()
    df = pd.read_excel(io.BytesIO(contents), header=None)
    
    total_rows = len(df)
    num_cols = len(df.columns)
    logger.info(f"Old photos upload: {total_rows} rows, {num_cols} columns")
    
    # Log first 3 rows for debugging
    for i in range(min(3, total_rows)):
        row_data = [str(df.iloc[i, c])[:60] if pd.notna(df.iloc[i, c]) else "NaN" for c in range(min(5, num_cols))]
        logger.info(f"  Row {i}: {row_data}")
    
    # Auto-detect columns from header row
    pid_col = None
    url_col = None
    header_rows = 0
    
    # Check first row for headers
    for col_idx in range(num_cols):
        header_val = str(df.iloc[0, col_idx]).lower().strip() if pd.notna(df.iloc[0, col_idx]) else ""
        if header_val in ['property_id', 'property id', 'pid', 'prop id', 'propertyid', 'id', 'prop_id']:
            pid_col = col_idx
            header_rows = 1
        elif header_val in ['photo_url', 'photo url', 'url', 'photo', 'image', 'image_url', 'link', 'photo link', 'image link', 'img', 'image url']:
            url_col = col_idx
            header_rows = 1
    
    # If no header found, guess from data
    if pid_col is None or url_col is None:
        for col_idx in range(num_cols):
            sample_val = str(df.iloc[min(1, total_rows-1), col_idx]) if pd.notna(df.iloc[min(1, total_rows-1), col_idx]) else ""
            if sample_val.startswith("http") and url_col is None:
                url_col = col_idx
            elif not sample_val.startswith("http") and not sample_val.isdigit() and len(sample_val) > 3 and pid_col is None:
                pid_col = col_idx
        # If still not found, use defaults based on column count
        if pid_col is None:
            pid_col = 0 if num_cols == 2 else 1
        if url_col is None:
            url_col = 1 if num_cols == 2 else (2 if num_cols >= 3 else 1)
    
    logger.info(f"  Detected: pid_col={pid_col}, url_col={url_col}, header_rows={header_rows}")
    
    # FAST BULK: Read all data first, then batch update
    updates = {}  # pid -> photo_url
    skipped = 0
    sample_skipped = []
    
    for idx in range(header_rows, total_rows):
        prop_id = str(df.iloc[idx, pid_col] if pid_col < num_cols and pd.notna(df.iloc[idx, pid_col]) else "").strip()
        photo_url = str(df.iloc[idx, url_col] if url_col < num_cols and pd.notna(df.iloc[idx, url_col]) else "").strip()
        
        # Clean up prop_id
        if prop_id.endswith('.0'):
            prop_id = prop_id[:-2]
        
        if not prop_id or not photo_url or photo_url == 'nan' or photo_url == 'NaN':
            skipped += 1
            if len(sample_skipped) < 3:
                sample_skipped.append(f"Row {idx}: pid='{prop_id[:30]}', url='{photo_url[:50]}'")
            continue
        
        updates[prop_id.upper()] = photo_url
    
    logger.info(f"  Parsed {len(updates)} valid entries, {skipped} skipped")
    
    # Batch update using bulk_write for speed
    from pymongo import UpdateOne
    updated = 0
    not_found = 0
    duplicates = 0
    
    if updates:
        # FAST: Pre-fetch all existing property IDs from DB to filter
        all_update_pids = list(updates.keys())
        
        # Fetch existing properties in batches to build a lookup
        existing_props_map = {}  # db_pid_upper -> db_pid_original
        batch_size = 5000
        for i in range(0, len(all_update_pids), batch_size):
            batch = all_update_pids[i:i+batch_size]
            props = await get_db().properties.find(
                {"property_id": {"$in": batch}},
                {"property_id": 1, "photo_url": 1, "_id": 0}
            ).to_list(None)
            for p in props:
                pid = str(p.get("property_id", ""))
                existing_props_map[pid.upper()] = {
                    "original_pid": pid,
                    "current_photo": p.get("photo_url", "")
                }
        
        logger.info(f"  Found {len(existing_props_map)} matching properties in DB out of {len(all_update_pids)} in file")
        
        # Filter: only update properties that exist and need updating
        to_update = {}
        for pid, url in updates.items():
            if pid in existing_props_map:
                if existing_props_map[pid]["current_photo"] != url:
                    to_update[existing_props_map[pid]["original_pid"]] = url
                else:
                    duplicates += 1
            else:
                not_found += 1
        
        logger.info(f"  To update: {len(to_update)}, duplicates: {duplicates}, not_found: {not_found}")
        
        # Bulk update in batches using exact match (FAST)
        update_batch_size = 2000
        update_pids = list(to_update.keys())
        
        for batch_start in range(0, len(update_pids), update_batch_size):
            batch_pids = update_pids[batch_start:batch_start + update_batch_size]
            operations = []
            for pid in batch_pids:
                operations.append(UpdateOne(
                    {"property_id": pid},
                    {"$set": {"photo_url": to_update[pid]}}
                ))
            
            if operations:
                result = await get_db().properties.bulk_write(operations, ordered=False)
                updated += result.modified_count
                logger.info(f"  Batch {batch_start//update_batch_size + 1}: modified={result.modified_count}")
    
    logger.info(f"  Final: updated={updated}, not_found={not_found}, duplicates={duplicates}, skipped={skipped}")
    
    # PERMANENT STORAGE: Also save to property_photos collection (survives property re-creation)
    if updates:
        photo_ops = []
        for pid, url in updates.items():
            photo_ops.append(UpdateOne(
                {"property_id": pid},
                {"$set": {"property_id": pid, "photo_url": url}},
                upsert=True
            ))
        
        if photo_ops:
            photo_batch_size = 2000
            for i in range(0, len(photo_ops), photo_batch_size):
                batch = photo_ops[i:i+photo_batch_size]
                await get_db().property_photos.bulk_write(batch, ordered=False)
            logger.info(f"  Saved {len(photo_ops)} entries to permanent property_photos collection")
    
    return {
        "message": f"Updated {updated} properties. {duplicates} duplicates skipped. {not_found} not found. {skipped} invalid rows.",
        "updated": updated,
        "not_found": not_found,
        "skipped": skipped,
        "duplicates": duplicates,
        "total_rows": total_rows,
        "detected_pid_col": pid_col,
        "detected_url_col": url_col,
        "header_rows_skipped": header_rows,
        "sample_skipped_rows": sample_skipped if sample_skipped else []
    }

@api_router.get("/admin/missing-photos-report")
async def missing_photos_report(
    current_user: dict = Depends(get_current_user)
):
    """Download Excel report of properties missing photo_url"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    town_db = get_db()
    
    # Get properties WITHOUT photo_url
    missing = await town_db.properties.find(
        {"$or": [
            {"photo_url": {"$exists": False}},
            {"photo_url": None},
            {"photo_url": ""}
        ]},
        {"_id": 0, "property_id": 1, "owner_name": 1, "colony": 1, "mobile": 1, "serial_number": 1, "category": 1, "status": 1}
    ).to_list(None)
    
    # Get properties WITH photo_url
    with_photo = await town_db.properties.count_documents(
        {"photo_url": {"$exists": True, "$nin": [None, ""]}}
    )
    total = await town_db.properties.count_documents({})
    
    # Create Excel
    wb = Workbook()
    ws = wb.active
    ws.title = "Missing Photos"
    
    # Summary sheet info
    ws.append(["MISSING PHOTO REPORT"])
    ws.append([f"Total Properties: {total}", f"With Photo: {with_photo}", f"Missing Photo: {len(missing)}"])
    ws.append([])
    
    headers = ["Sr No", "Property ID", "Owner Name", "Colony", "Mobile", "Serial No", "Category", "Survey Status"]
    ws.append(headers)
    
    from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
    header_fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    
    for col in range(1, len(headers) + 1):
        cell = ws.cell(row=4, column=col)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = thin_border
    
    for i, prop in enumerate(missing, 1):
        row = [
            i,
            prop.get("property_id", ""),
            prop.get("owner_name", ""),
            prop.get("colony", ""),
            prop.get("mobile", ""),
            prop.get("serial_number", ""),
            prop.get("category", ""),
            prop.get("status", "Pending")
        ]
        ws.append(row)
        for col in range(1, len(row) + 1):
            ws.cell(row=i + 4, column=col).border = thin_border
    
    widths = [8, 15, 25, 25, 15, 10, 15, 15]
    for col, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=4, column=col).column_letter].width = w
    
    excel_buffer = io.BytesIO()
    wb.save(excel_buffer)
    excel_buffer.seek(0)
    
    return StreamingResponse(
        excel_buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=missing_photos_report.xlsx"}
    )



@api_router.delete("/admin/clear-old-photos")
async def clear_old_photos(current_user: dict = Depends(get_current_user)):
    """Clear all old photo URLs from properties"""
    if current_user["role"] not in ["ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await get_db().properties.update_many(
        {"photo_url": {"$exists": True, "$nin": [None, ""]}},
        {"$unset": {"photo_url": ""}}
    )
    
    return {
        "message": f"Cleared photo URLs from {result.modified_count} properties"
    }

@api_router.get("/admin/old-photos-stats")
async def get_old_photos_stats(current_user: dict = Depends(get_current_user)):
    """Get count of properties with old photo URLs"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    total_with_photos = await get_db().properties.count_documents(
        {"photo_url": {"$exists": True, "$nin": [None, ""]}}
    )
    
    return {"total_with_photos": total_with_photos}



@api_router.get("/admin/colonies")
async def get_all_colonies(current_user: dict = Depends(get_current_user)):
    """Get all distinct colony/ward names in the current town"""
    if current_user["role"] not in ADMIN_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    colonies = await get_db().properties.distinct("ward")
    colonies = [c for c in colonies if c]
    colonies.sort()
    return {"colonies": colonies}

@api_router.post("/admin/block-assign-colonies")
async def block_assign_colonies(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Assign multiple colonies to multiple surveyors"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    colony_names = data.get("colonies", [])
    employee_ids = data.get("employee_ids", [])
    
    if not colony_names or not employee_ids:
        raise HTTPException(status_code=400, detail="colonies and employee_ids are required")
    
    employees = await master_db.users.find({"id": {"$in": employee_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    emp_map = {e["id"]: e["name"] for e in employees}
    
    total_updated = 0
    results = []
    
    # Distribute colonies equally among employees
    for i, colony in enumerate(colony_names):
        emp_id = employee_ids[i % len(employee_ids)]
        emp_name = emp_map.get(emp_id, "Unknown")
        
        result = await get_db().properties.update_many(
            {"ward": colony, "$or": [
                {"assigned_employee_id": None},
                {"assigned_employee_id": {"$exists": False}},
                {"assigned_employee_id": ""}
            ]},
            {"$set": {
                "assigned_employee_id": emp_id,
                "assigned_employee_name": emp_name
            },
            "$addToSet": {"assigned_employee_ids": emp_id}}
        )
        total_updated += result.modified_count
        results.append({
            "colony": colony,
            "employee": emp_name,
            "assigned": result.modified_count
        })
    
    return {
        "message": f"Assigned {total_updated} properties across {len(colony_names)} colonies to {len(employee_ids)} surveyors",
        "total_assigned": total_updated,
        "details": results
    }

@api_router.post("/admin/block-unassign-colonies")
async def block_unassign_colonies(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Unassign all surveyors from multiple colonies"""
    if current_user["role"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    colony_names = data.get("colonies", [])
    if not colony_names:
        raise HTTPException(status_code=400, detail="colonies list is required")
    
    total_unassigned = 0
    for colony in colony_names:
        result = await get_db().properties.update_many(
            {"ward": colony},
            {"$set": {
                "assigned_employee_id": None,
                "assigned_employee_name": None,
                "assigned_employee_ids": []
            }}
        )
        total_unassigned += result.modified_count
    
    return {
        "message": f"Unassigned {total_unassigned} properties from {len(colony_names)} colonies",
        "total_unassigned": total_unassigned
    }

async def seed_defaults():
    """Idempotent: ensure a default admin and the THS town exist on fresh deployments"""
    if not await master_db.users.find_one({"role": "ADMIN"}):
        await seed_admin_from_env()
    if not await master_db.towns.find_one({"code": "THS"}):
        await master_db.towns.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Thanesar",
            "code": "THS",
            "description": "Thanesar town",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    # Ensure the 32 Thanesar wards exist so surveyors can add properties / start surveys.
    # Colonies come from the bundled ward-wise colony master (ward_master); upserted on
    # every startup so the colony->ward list stays fresh even on a clean deploy DB.
    ths_db = get_town_db("THS")
    now_iso_str = datetime.now(timezone.utc).isoformat()
    master_wards = ward_master.ward_to_colonies()
    if master_wards:
        for wn, colonies in master_wards.items():
            await ths_db.phed_wards.update_one(
                {"ward_number": wn},
                {"$set": {"name": f"Ward {wn}", "town": "Thanesar", "is_active": True,
                          "colonies": colonies, "updated_at": now_iso_str},
                 "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now_iso_str}},
                upsert=True,
            )
    elif await ths_db.phed_wards.count_documents({}) == 0:
        await ths_db.phed_wards.insert_many([
            {"id": str(uuid.uuid4()), "ward_number": str(n), "name": f"Ward {n}",
             "town": "Thanesar", "is_active": True, "colonies": [],
             "created_at": now_iso_str, "updated_at": now_iso_str}
            for n in range(1, 33)
        ])

async def seed_admin_from_env():
    """First admin comes only from env vars; fails fast if missing on a fresh DB"""
    username = os.environ.get("ADMIN_USERNAME", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "").strip()
    if not username or len(password) < 12:
        raise RuntimeError("No ADMIN user exists: set ADMIN_USERNAME and ADMIN_PASSWORD (min 12 chars) in the environment")
    if await master_db.users.find_one({"username": username}):
        logging.getLogger("app").warning("ADMIN_USERNAME already exists as non-admin; skipping seed")
        return
    admin_doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(password),
        "name": "Super Admin",
        "role": "ADMIN",
        "assigned_area": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await master_db.users.insert_one(admin_doc)
    logging.getLogger("app").info("Seeded initial ADMIN user from environment")

@api_router.get("/admin/surveyor-report")
async def surveyor_report(
    request: Request,
    month: int = None,
    year: int = None,
    surveyor_id: str = None,
    date_from: str = None,
    date_to: str = None,
    colony: str = None,
    category: str = None,
    status: str = None,
    current_user: dict = Depends(get_current_user)
):
    """Generate Surveyor Date-wise + Refusal Progress Report Excel with filters"""
    if current_user["role"] not in ["ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
    from calendar import monthrange
    
    town_db = get_db()
    now = datetime.now(timezone.utc)
    report_month = month or now.month
    report_year = year or now.year
    days_in_month = monthrange(report_year, report_month)[1]
    
    # Get town info
    town_code = request.headers.get("x-town-code", "")
    town = await master_db.towns.find_one({"code": town_code}, {"_id": 0}) if town_code else None
    town_name = town.get("name", town_code) if town else town_code
    
    # Get all employees for this town
    if town:
        employees = await master_db.users.find(
            {"role": {"$ne": "ADMIN"}, "assigned_town": town["id"]}, {"_id": 0}
        ).to_list(None)
    else:
        employees = await master_db.users.find({"role": {"$ne": "ADMIN"}}, {"_id": 0}).to_list(None)
    
    # Filter employees by surveyor_id if specified
    if surveyor_id:
        employees = [e for e in employees if e.get("id") == surveyor_id]
    
    # Build submission query with filters
    sub_query = {}
    
    # Date filtering: use date_from/date_to if provided, else use month/year
    if date_from and date_to:
        sub_query["submitted_at"] = {"$gte": f"{date_from}T00:00:00", "$lte": f"{date_to}T23:59:59"}
    else:
        month_start = f"{report_year}-{report_month:02d}-01T00:00:00"
        if report_month == 12:
            month_end = f"{report_year + 1}-01-01T00:00:00"
        else:
            month_end = f"{report_year}-{report_month + 1:02d}-01T00:00:00"
        sub_query["submitted_at"] = {"$gte": month_start, "$lt": month_end}
    
    if surveyor_id:
        sub_query["employee_id"] = surveyor_id
    if status:
        sub_query["status"] = status
    if colony:
        sub_query["colony"] = colony
    if category:
        sub_query["category"] = category
    
    all_subs = await town_db.submissions.find(
        sub_query,
        {"_id": 0, "employee_id": 1, "employee_name": 1, "submitted_at": 1,
         "special_condition": 1, "house_status": 1, "status": 1, "colony": 1, "category": 1}
    ).to_list(None)
    
    # Build employee submission maps
    emp_daily = {}  # emp_id -> {day: count}
    emp_conditions = {}  # emp_id -> {normal, locked, denied, vacant, wrong}
    emp_totals = {}  # emp_id -> total
    
    for sub in all_subs:
        eid = sub.get("employee_id", "unknown")
        sc = sub.get("special_condition", "")
        
        # Daily count
        if eid not in emp_daily:
            emp_daily[eid] = {}
            emp_conditions[eid] = {"normal": 0, "locked": 0, "denied": 0, "vacant": 0, "wrong": 0}
            emp_totals[eid] = 0
        
        emp_totals[eid] = emp_totals.get(eid, 0) + 1
        
        # Parse date
        sub_at = sub.get("submitted_at", "")
        if sub_at:
            try:
                from datetime import datetime as dt_p, timedelta as td
                if "T" in str(sub_at):
                    dt_obj = dt_p.fromisoformat(str(sub_at).replace("Z", "+00:00"))
                    ist = dt_obj + td(hours=5, minutes=30)
                    day = ist.day
                else:
                    day = int(str(sub_at)[8:10])
                emp_daily[eid][day] = emp_daily[eid].get(day, 0) + 1
            except (ValueError, TypeError):
                pass
        
        # Condition count
        if sc in ["property_locked", "house_locked"]:
            emp_conditions[eid]["locked"] += 1
        elif sc == "owner_denied":
            emp_conditions[eid]["denied"] += 1
        elif sc == "vacant_plot":
            emp_conditions[eid]["vacant"] += 1
        elif sc == "wrong_location":
            emp_conditions[eid]["wrong"] += 1
        else:
            emp_conditions[eid]["normal"] += 1
    
    # Create workbook
    wb = Workbook()
    
    # Styles
    header_fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=10)
    title_font = Font(bold=True, size=14)
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    center_align = Alignment(horizontal='center', vertical='center')
    
    # ===== Sheet 1: Date-wise Progress =====
    ws1 = wb.active
    ws1.title = "Date-wise Progress"
    ws1.merge_cells('A1:H1')
    # Build filter description for title
    filter_parts = [town_name]
    if date_from and date_to:
        filter_parts.append(f"{date_from} to {date_to}")
    else:
        filter_parts.append(f"{report_month:02d}/{report_year}")
    if surveyor_id:
        emp_name = next((e.get("name", surveyor_id) for e in employees if e.get("id") == surveyor_id), surveyor_id)
        filter_parts.append(f"Surveyor: {emp_name}")
    if colony:
        filter_parts.append(f"Colony: {colony}")
    if category:
        filter_parts.append(f"Category: {category}")
    if status:
        filter_parts.append(f"Status: {status}")
    filter_desc = " | ".join(filter_parts)

    ws1['A1'] = f"Surveyors Date-wise Progress Report - {filter_desc}"
    ws1['A1'].font = title_font
    
    headers1 = ["Sr No", "User ID", "Name", "City", "Total Forms"]
    for d in range(1, days_in_month + 1):
        headers1.append(str(d))
    
    ws1.append([])  # blank row
    ws1.append(headers1)
    header_row = 3
    for col in range(1, len(headers1) + 1):
        cell = ws1.cell(row=header_row, column=col)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = thin_border
        cell.alignment = center_align
    
    for idx, emp in enumerate(employees, 1):
        eid = emp.get("id", "")
        total = emp_totals.get(eid, 0)
        daily = emp_daily.get(eid, {})
        row = [idx, emp.get("username", ""), emp.get("name", ""), town_name, total]
        for d in range(1, days_in_month + 1):
            row.append(daily.get(d, 0))
        ws1.append(row)
        for col in range(1, len(row) + 1):
            cell = ws1.cell(row=header_row + idx, column=col)
            cell.border = thin_border
            cell.alignment = center_align
    
    # Auto width for first columns
    ws1.column_dimensions['A'].width = 8
    ws1.column_dimensions['B'].width = 15
    ws1.column_dimensions['C'].width = 20
    ws1.column_dimensions['D'].width = 15
    ws1.column_dimensions['E'].width = 12
    
    # ===== Sheet 2: Refusal Progress =====
    ws2 = wb.create_sheet("Refusal Progress")
    ws2.merge_cells('A1:H1')
    ws2['A1'] = f"Surveyors Refusal Progress Report - {filter_desc}"
    ws2['A1'].font = title_font
    
    headers2 = ["Sr No", "User ID", "Name", "City", "Total Forms",
                 "Normal Distribution", "House Locked", "Owner Denied",
                 "Vacant Plot", "Wrong Location", "Total Locked/Refused",
                 "% Locked", "% Refused", "% Vacant"]
    
    ws2.append([])
    ws2.append(headers2)
    header_row2 = 3
    for col in range(1, len(headers2) + 1):
        cell = ws2.cell(row=header_row2, column=col)
        cell.fill = header_fill
        cell.font = header_font
        cell.border = thin_border
        cell.alignment = center_align
    
    for idx, emp in enumerate(employees, 1):
        eid = emp.get("id", "")
        total = emp_totals.get(eid, 0)
        cond = emp_conditions.get(eid, {"normal": 0, "locked": 0, "denied": 0, "vacant": 0, "wrong": 0})
        total_refused = cond["locked"] + cond["denied"]
        pct_locked = round(cond["locked"] / total, 2) if total > 0 else 0
        pct_refused = round(cond["denied"] / total, 2) if total > 0 else 0
        pct_vacant = round(cond["vacant"] / total, 2) if total > 0 else 0
        
        row = [idx, emp.get("username", ""), emp.get("name", ""), town_name, total,
               cond["normal"], cond["locked"], cond["denied"], cond["vacant"], cond["wrong"],
               total_refused, pct_locked, pct_refused, pct_vacant]
        ws2.append(row)
        for col in range(1, len(row) + 1):
            cell = ws2.cell(row=header_row2 + idx, column=col)
            cell.border = thin_border
            cell.alignment = center_align
    
    # Auto width
    for col_letter in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']:
        ws2.column_dimensions[col_letter].width = 15
    
    # Save
    import time as _time
    ts = int(_time.time())
    report_path = f"/tmp/surveyor_report_{report_year}_{report_month:02d}_{ts}.xlsx"
    wb.save(report_path)
    
    return FileResponse(
        report_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"surveyor_report_{town_name}_{report_year}_{report_month:02d}.xlsx"
    )

# PHED module (wards, consumers, connections, import, surveys, dashboard, export)
from phed import phed_router  # noqa: E402
api_router.include_router(phed_router)

# Include the router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Town-Code", "X-Town-ID", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
)

logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
