#!/usr/bin/env python3
"""
Multi-tenant Database Migration Utilities for NSTU Property Tax System

This script helps migrate from single-database to multi-tenant architecture:
- Master DB: Global data (users, towns, access control)
- Town DBs: Town-specific data (properties, submissions, bills, etc.)

Usage:
    python migration_utils.py --help
    python migration_utils.py migrate-users
    python migration_utils.py migrate-towns
    python migration_utils.py migrate-properties --town-code THS
"""

import asyncio
import os
import sys
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import argparse
import logging

# Add parent directory to path to import server modules
sys.path.append(str(Path(__file__).parent))
from server import master_db, db, get_town_db, create_master_indexes, create_town_indexes

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def migrate_users():
    """Migrate users from legacy DB to Master DB"""
    logger.info("Starting user migration from legacy DB to Master DB...")
    
    # Get all users from legacy DB
    users = await db.users.find({}, {"_id": 0}).to_list(None)
    logger.info(f"Found {len(users)} users in legacy DB")
    
    if not users:
        logger.info("No users to migrate")
        return
    
    # Check if users already exist in master DB
    existing_users = await master_db.users.find({}, {"username": 1}).to_list(None)
    existing_usernames = {user["username"] for user in existing_users}
    
    # Filter out users that already exist
    new_users = [user for user in users if user["username"] not in existing_usernames]
    
    if new_users:
        await master_db.users.insert_many(new_users)
        logger.info(f"Migrated {len(new_users)} users to Master DB")
    else:
        logger.info("All users already exist in Master DB")
    
    # Create indexes
    await create_master_indexes()
    logger.info("User migration completed")

async def migrate_towns():
    """Migrate towns from legacy DB to Master DB"""
    logger.info("Starting town migration from legacy DB to Master DB...")
    
    # Get all towns from legacy DB
    towns = await db.towns.find({}, {"_id": 0}).to_list(None)
    logger.info(f"Found {len(towns)} towns in legacy DB")
    
    if not towns:
        logger.info("No towns to migrate")
        return
    
    # Check if towns already exist in master DB
    existing_towns = await master_db.towns.find({}, {"code": 1}).to_list(None)
    existing_codes = {town["code"] for town in existing_towns}
    
    # Filter out towns that already exist
    new_towns = [town for town in towns if town["code"] not in existing_codes]
    
    if new_towns:
        await master_db.towns.insert_many(new_towns)
        logger.info(f"Migrated {len(new_towns)} towns to Master DB")
        
        # Initialize town-specific databases
        for town in new_towns:
            town_db = get_town_db(town["code"])
            await create_town_indexes(town_db)
            logger.info(f"Initialized town DB for {town['name']} ({town['code']})")
    else:
        logger.info("All towns already exist in Master DB")
    
    logger.info("Town migration completed")

async def migrate_properties(town_code: str):
    """Migrate properties for a specific town from legacy DB to town-specific DB"""
    logger.info(f"Starting property migration for town {town_code}...")
    
    # Get town info from master DB
    town = await master_db.towns.find_one({"code": town_code.upper()})
    if not town:
        logger.error(f"Town {town_code} not found in Master DB")
        return
    
    # Get properties for this town from legacy DB
    properties = await db.properties.find({"town": town["id"]}, {"_id": 0}).to_list(None)
    logger.info(f"Found {len(properties)} properties for town {town_code} in legacy DB")
    
    if not properties:
        logger.info(f"No properties to migrate for town {town_code}")
        return
    
    # Get town-specific DB
    town_db = get_town_db(town_code.upper())
    
    # Check existing properties in town DB
    existing_count = await town_db.properties.count_documents({})
    
    if existing_count > 0:
        logger.warning(f"Town DB already has {existing_count} properties. Skipping migration.")
        return
    
    # Remove town field from properties (not needed in town-specific DB)
    for prop in properties:
        prop.pop("town", None)
    
    # Insert properties into town-specific DB
    if properties:
        await town_db.properties.insert_many(properties)
        logger.info(f"Migrated {len(properties)} properties to town DB for {town_code}")
    
    # Create indexes
    await create_town_indexes(town_db)
    logger.info(f"Property migration completed for town {town_code}")

async def migrate_submissions(town_code: str):
    """Migrate submissions for a specific town from legacy DB to town-specific DB"""
    logger.info(f"Starting submission migration for town {town_code}...")
    
    # Get town info from master DB
    town = await master_db.towns.find_one({"code": town_code.upper()})
    if not town:
        logger.error(f"Town {town_code} not found in Master DB")
        return
    
    # Get submissions for this town from legacy DB
    submissions = await db.submissions.find({"town": town["id"]}, {"_id": 0}).to_list(None)
    logger.info(f"Found {len(submissions)} submissions for town {town_code} in legacy DB")
    
    if not submissions:
        logger.info(f"No submissions to migrate for town {town_code}")
        return
    
    # Get town-specific DB
    town_db = get_town_db(town_code.upper())
    
    # Check existing submissions in town DB
    existing_count = await town_db.submissions.count_documents({})
    
    if existing_count > 0:
        logger.warning(f"Town DB already has {existing_count} submissions. Skipping migration.")
        return
    
    # Remove town field from submissions (not needed in town-specific DB)
    for submission in submissions:
        submission.pop("town", None)
    
    # Insert submissions into town-specific DB
    if submissions:
        await town_db.submissions.insert_many(submissions)
        logger.info(f"Migrated {len(submissions)} submissions to town DB for {town_code}")
    
    logger.info(f"Submission migration completed for town {town_code}")

async def list_migration_status():
    """Show current migration status"""
    logger.info("=== Migration Status ===")
    
    # Users
    legacy_users = await db.users.count_documents({})
    master_users = await master_db.users.count_documents({})
    logger.info(f"Users: Legacy DB = {legacy_users}, Master DB = {master_users}")
    
    # Towns
    legacy_towns = await db.towns.count_documents({})
    master_towns = await master_db.towns.count_documents({})
    logger.info(f"Towns: Legacy DB = {legacy_towns}, Master DB = {master_towns}")
    
    # Properties by town
    towns = await master_db.towns.find({}, {"code": 1, "name": 1}).to_list(None)
    for town in towns:
        legacy_props = await db.properties.count_documents({"town": town.get("id", "")})
        town_db = get_town_db(town["code"])
        town_props = await town_db.properties.count_documents({})
        logger.info(f"Properties for {town['name']} ({town['code']}): Legacy = {legacy_props}, Town DB = {town_props}")

async def main():
    parser = argparse.ArgumentParser(description="NSTU Multi-tenant Database Migration")
    parser.add_argument("command", choices=[
        "migrate-users", "migrate-towns", "migrate-properties", "migrate-submissions", "status"
    ], help="Migration command to run")
    parser.add_argument("--town-code", help="Town code for property/submission migration")
    
    args = parser.parse_args()
    
    # Load environment
    load_dotenv()
    
    try:
        if args.command == "migrate-users":
            await migrate_users()
        elif args.command == "migrate-towns":
            await migrate_towns()
        elif args.command == "migrate-properties":
            if not args.town_code:
                logger.error("--town-code is required for property migration")
                return
            await migrate_properties(args.town_code)
        elif args.command == "migrate-submissions":
            if not args.town_code:
                logger.error("--town-code is required for submission migration")
                return
            await migrate_submissions(args.town_code)
        elif args.command == "status":
            await list_migration_status()
    
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(main())