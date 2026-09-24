"""
Multi-Tenant Database Architecture
==================================
Master DB + Town DB (Hybrid) Architecture

Master DB (global):
- users, towns, user_town_access, town_db_config, audit_login, audit_town_switch

Town DB (per town):
- properties, bills, submissions, attendance, batches, employees
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from typing import Optional, Dict
import os
from functools import lru_cache

# Global MongoDB client
_mongo_client: Optional[AsyncIOMotorClient] = None
_town_connections: Dict[str, any] = {}  # Cache for town DB connections

def get_mongo_client() -> AsyncIOMotorClient:
    """Get or create MongoDB client"""
    global _mongo_client
    if _mongo_client is None:
        mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
        _mongo_client = AsyncIOMotorClient(
            mongo_url,
            maxPoolSize=50,
            minPoolSize=10,
            maxIdleTimeMS=30000,
            serverSelectionTimeoutMS=5000
        )
    return _mongo_client

def get_master_db():
    """Get Master Database connection"""
    client = get_mongo_client()
    master_db_name = os.environ.get('MASTER_DB_NAME', 'nstu_master')
    return client[master_db_name]

def get_town_db(town_code: str):
    """Get Town-specific Database connection"""
    global _town_connections
    
    if town_code in _town_connections:
        return _town_connections[town_code]
    
    client = get_mongo_client()
    town_db_name = f"nstu_town_{town_code.lower()}"
    db = client[town_db_name]
    _town_connections[town_code] = db
    return db

def get_town_gridfs(town_code: str):
    """Get GridFS bucket for town-specific file storage"""
    town_db = get_town_db(town_code)
    return AsyncIOMotorGridFSBucket(town_db)

async def create_master_indexes(db):
    """Create indexes for Master DB"""
    try:
        # Users collection
        await db.users.create_index("id", unique=True, background=True)
        await db.users.create_index("username", unique=True, background=True)
        await db.users.create_index("role", background=True)
        
        # Towns collection
        await db.towns.create_index("id", unique=True, background=True)
        await db.towns.create_index("code", unique=True, background=True)
        await db.towns.create_index("is_active", background=True)
        
        # User Town Access
        await db.user_town_access.create_index("user_id", background=True)
        await db.user_town_access.create_index("town_id", background=True)
        await db.user_town_access.create_index([("user_id", 1), ("town_id", 1)], unique=True, background=True)
        
        # Town DB Config
        await db.town_db_config.create_index("town_id", unique=True, background=True)
        
        # Audit logs
        await db.audit_login.create_index("user_id", background=True)
        await db.audit_login.create_index("timestamp", background=True)
        await db.audit_town_switch.create_index("user_id", background=True)
        await db.audit_town_switch.create_index("timestamp", background=True)
        
        print("✅ Master DB indexes created successfully")
    except Exception as e:
        print(f"⚠️ Error creating master indexes: {e}")

async def create_town_indexes(db):
    """Create indexes for Town DB"""
    try:
        # Properties
        await db.properties.create_index("id", unique=True, background=True)
        await db.properties.create_index("property_id", background=True)
        await db.properties.create_index("ward", background=True)
        await db.properties.create_index("colony", background=True)
        await db.properties.create_index("status", background=True)
        await db.properties.create_index("assigned_employee_id", background=True)
        await db.properties.create_index("serial_number", background=True)
        await db.properties.create_index([("latitude", 1), ("longitude", 1)], background=True)
        
        # Bills
        await db.bills.create_index("id", unique=True, background=True)
        await db.bills.create_index("colony", background=True)
        await db.bills.create_index("batch_id", background=True)
        
        # Submissions
        await db.submissions.create_index("id", unique=True, background=True)
        await db.submissions.create_index("property_record_id", background=True)
        await db.submissions.create_index("employee_id", background=True)
        await db.submissions.create_index("status", background=True)
        await db.submissions.create_index("submitted_at", background=True)
        
        # Attendance
        await db.attendance.create_index("employee_id", background=True)
        await db.attendance.create_index("date", background=True)
        await db.attendance.create_index([("employee_id", 1), ("date", 1)], unique=True, background=True)
        
        # Batches
        await db.batches.create_index("id", unique=True, background=True)
        await db.batches.create_index("type", background=True)
        
        # Town Employees
        await db.employees.create_index("id", unique=True, background=True)
        await db.employees.create_index("user_id", background=True)
        
        print("✅ Town DB indexes created successfully")
    except Exception as e:
        print(f"⚠️ Error creating town indexes: {e}")

async def initialize_town_db(town_code: str):
    """Initialize a new town database with required collections and indexes"""
    town_db = get_town_db(town_code)
    await create_town_indexes(town_db)
    return town_db

# Collection names for reference
MASTER_COLLECTIONS = [
    'users',           # Global users/admins
    'towns',           # Town master list  
    'user_town_access', # User ↔ Town mapping
    'town_db_config',  # Town DB connection config
    'audit_login',     # Login audit trail
    'audit_town_switch' # Town switch audit
]

TOWN_COLLECTIONS = [
    'properties',      # Properties in town
    'bills',           # Bills/demands
    'submissions',     # Survey submissions
    'attendance',      # Employee attendance
    'batches',         # Data upload batches
    'employees',       # Town-specific employee data
    'self_certification', # Self certification records
    'generated_pdfs'   # Generated PDF records
]
