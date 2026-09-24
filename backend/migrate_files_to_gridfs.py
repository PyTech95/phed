#!/usr/bin/env python3
"""
Migration script to move files from uploads folder to MongoDB GridFS
Run this on your VPS: python3 migrate_files_to_gridfs.py
"""

import os
import asyncio
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from dotenv import load_dotenv
import mimetypes

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
fs_bucket = AsyncIOMotorGridFSBucket(db)

UPLOAD_DIR = ROOT_DIR / "uploads"

async def migrate_files():
    """Migrate all files from uploads folder to GridFS"""
    
    if not UPLOAD_DIR.exists():
        print(f"Upload directory not found: {UPLOAD_DIR}")
        return
    
    files = list(UPLOAD_DIR.glob("*"))
    print(f"Found {len(files)} files to migrate")
    
    migrated = 0
    skipped = 0
    errors = 0
    
    for file_path in files:
        if file_path.is_dir():
            continue
            
        filename = file_path.name
        
        # Check if file already exists in GridFS
        existing = await db.fs.files.find_one({"filename": filename})
        if existing:
            print(f"  SKIP (already exists): {filename}")
            skipped += 1
            continue
        
        try:
            # Read file content
            with open(file_path, "rb") as f:
                content = f.read()
            
            # Determine content type
            content_type, _ = mimetypes.guess_type(filename)
            if not content_type:
                if filename.endswith('.jpg') or filename.endswith('.jpeg'):
                    content_type = "image/jpeg"
                elif filename.endswith('.png'):
                    content_type = "image/png"
                elif filename.endswith('.pdf'):
                    content_type = "application/pdf"
                elif filename.endswith('.xlsx'):
                    content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                else:
                    content_type = "application/octet-stream"
            
            # Upload to GridFS
            file_id = await fs_bucket.upload_from_stream(
                filename,
                content,
                metadata={"content_type": content_type, "migrated": True}
            )
            
            print(f"  OK: {filename} -> GridFS ID: {file_id}")
            migrated += 1
            
        except Exception as e:
            print(f"  ERROR: {filename} - {str(e)}")
            errors += 1
    
    print("\n=== Migration Complete ===")
    print(f"Migrated: {migrated}")
    print(f"Skipped (already exists): {skipped}")
    print(f"Errors: {errors}")
    print("\nNote: Original files in uploads folder are NOT deleted.")
    print("You can delete them manually after verifying everything works.")

if __name__ == "__main__":
    asyncio.run(migrate_files())
