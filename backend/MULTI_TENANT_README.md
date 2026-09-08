# Multi-Tenant Database Architecture

## Overview

The NSTU Property Tax System now supports multi-tenant architecture with separate databases for different towns while maintaining a centralized master database for global data.

## Database Structure

### Master Database (`nstu_master`)
- **Purpose**: Global data and access control
- **Collections**:
  - `users` - All system users with town assignments
  - `towns` - Town definitions and configurations
- **Access**: Centralized authentication and user management

### Town-Specific Databases (`nstu_town_{code}`)
- **Purpose**: Town-specific operational data
- **Collections**:
  - `properties` - Property records for the town
  - `submissions` - Survey submissions for the town
  - `bills` - Bill records for the town
  - `attendance` - Employee attendance for the town
  - `batches` - Data upload batches for the town
  - `generated_pdfs` - Generated reports for the town
- **Access**: Isolated data per town

### Legacy Database (`test_database`)
- **Purpose**: Backward compatibility during migration
- **Status**: Will be phased out after complete migration

## Key Features

### 1. Data Isolation
- Each town's data is completely isolated in separate databases
- No cross-town data access or contamination
- Improved security and data privacy

### 2. Scalability
- Individual town databases can be optimized independently
- Horizontal scaling by distributing town databases
- Reduced query complexity and improved performance

### 3. Centralized User Management
- Single sign-on across all towns
- Centralized role and permission management
- Town-specific user assignments

### 4. Backward Compatibility
- Legacy database support during migration period
- Gradual migration without service interruption
- Fallback mechanisms for unmigrated data

## Database Functions

### Core Functions
```python
# Get town-specific database
town_db = get_town_db(town_code)

# Get town-specific GridFS
town_gridfs = get_town_gridfs(town_code)

# Get appropriate database based on context
properties_db = get_properties_db(user, town_code)
submissions_db = get_submissions_db(user, town_code)
```

### Index Management
```python
# Create master database indexes
await create_master_indexes()

# Create town-specific indexes
await create_town_indexes(town_db)

# Create legacy database indexes (compatibility)
await create_legacy_indexes()
```

## Migration Process

### 1. Migrate Global Data
```bash
# Migrate users to master database
python migration_utils.py migrate-users

# Migrate towns to master database
python migration_utils.py migrate-towns
```

### 2. Migrate Town-Specific Data
```bash
# Migrate properties for a specific town
python migration_utils.py migrate-properties --town-code THS

# Migrate submissions for a specific town
python migration_utils.py migrate-submissions --town-code THS
```

### 3. Check Migration Status
```bash
# View current migration status
python migration_utils.py status
```

## Environment Configuration

Add to `.env` file:
```env
MASTER_DB_NAME="nstu_master"
```

## API Changes

### Authentication
- All user authentication now uses Master DB
- JWT tokens remain the same
- User context includes town assignments

### Town Management
- Town CRUD operations use Master DB
- Town selection affects data context
- Automatic town database initialization

### Data Operations
- Properties, submissions, bills use town-specific DBs
- Automatic database selection based on user context
- Legacy fallback for unmigrated data

## Performance Benefits

### 1. Reduced Query Complexity
- Smaller datasets per database
- Faster index operations
- Improved query performance

### 2. Optimized Indexes
- Town-specific index optimization
- Reduced index size and maintenance
- Better cache utilization

### 3. Concurrent Operations
- Parallel operations across town databases
- Reduced lock contention
- Better resource utilization

## Security Improvements

### 1. Data Isolation
- Complete separation of town data
- No accidental cross-town access
- Improved audit trails

### 2. Access Control
- Centralized permission management
- Town-specific access restrictions
- Role-based data access

### 3. Backup and Recovery
- Individual town backup strategies
- Faster recovery times
- Reduced backup sizes

## Monitoring and Maintenance

### Database Health
- Monitor individual town database performance
- Track migration progress
- Identify optimization opportunities

### Index Maintenance
- Regular index analysis per town
- Automated index creation for new towns
- Performance monitoring

### Data Consistency
- Cross-reference checks between master and town DBs
- Migration validation
- Data integrity monitoring

## Future Enhancements

### 1. Geographic Distribution
- Town databases on regional servers
- Reduced latency for local operations
- Disaster recovery improvements

### 2. Advanced Caching
- Town-specific cache strategies
- Distributed caching across regions
- Smart cache invalidation

### 3. Analytics and Reporting
- Cross-town analytics from master DB
- Town-specific performance metrics
- Automated reporting pipelines

## Troubleshooting

### Common Issues

1. **Town Database Not Found**
   - Ensure town exists in master DB
   - Check town code spelling
   - Verify database initialization

2. **Migration Failures**
   - Check database connectivity
   - Verify data integrity
   - Review migration logs

3. **Performance Issues**
   - Check index status
   - Monitor query patterns
   - Analyze database sizes

### Debug Commands
```bash
# Check database connections
python -c "from server import master_db, get_town_db; print('Connections OK')"

# Verify indexes
python migration_utils.py status

# Test town database access
python -c "from server import get_town_db; db = get_town_db('THS'); print('Town DB OK')"
```