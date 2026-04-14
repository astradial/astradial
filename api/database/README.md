# Database Migrations

This directory contains Sequelize migrations for the Multi-Tenant PBX API system. These migrations will create a complete database schema for managing organizations, users, SIP trunks, DID numbers, queues, routing rules, webhooks, and call records.

## Overview

The PBX API uses a multi-tenant architecture where each organization has isolated data while sharing the same database structure. All tables are properly indexed for performance and include comprehensive foreign key relationships.

## Migration Files

The migrations are designed to run in a specific order due to foreign key dependencies:

1. **`20241218120000-create-organizations.js`** - Base organizations table
2. **`20241218120001-create-users.js`** - Users/extensions (depends on organizations)
3. **`20241218120002-create-sip-trunks.js`** - SIP trunk configuration (depends on organizations)
4. **`20241218120003-create-queues.js`** - Call queues (depends on organizations)
5. **`20241218120004-create-routing-rules.js`** - Call routing rules (depends on organizations)
6. **`20241218120005-create-did-numbers.js`** - DID number management (depends on organizations, sip_trunks)
7. **`20241218120006-create-queue-members.js`** - Queue membership (depends on queues, users)
8. **`20241218120007-create-webhooks.js`** - Webhook configuration (depends on organizations)
9. **`20241218120008-create-call-records.js`** - Call detail records (depends on all above)

## Database Schema

### Organizations Table (`organizations`)
- **Purpose**: Multi-tenant organization management
- **Key Features**: API keys, context prefixes, limits, settings
- **Relationships**: Parent to all other tables

### Users Table (`users`)
- **Purpose**: User/extension management
- **Key Features**: SIP credentials, roles, Asterisk endpoints
- **Relationships**: Belongs to organization, member of queues

### SIP Trunks Table (`sip_trunks`)
- **Purpose**: SIP trunk configuration and management
- **Key Features**: Registration status, channel limits, transport protocols
- **Relationships**: Belongs to organization, used by DID numbers

### Queues Table (`queues`)
- **Purpose**: Call queue configuration
- **Key Features**: Asterisk queue settings, strategies, timeouts
- **Relationships**: Belongs to organization, has queue members

### Routing Rules Table (`routing_rules`)
- **Purpose**: Advanced call routing logic
- **Key Features**: Priority-based routing, JSON conditions, time restrictions
- **Relationships**: Belongs to organization

### DID Numbers Table (`did_numbers`)
- **Purpose**: Inbound DID number management and routing
- **Key Features**: Multiple routing types, analytics, emergency routing
- **Relationships**: Belongs to organization and SIP trunk

### Queue Members Table (`queue_members`)
- **Purpose**: Queue membership management
- **Key Features**: Penalty system, pause states, call statistics
- **Relationships**: Links queues and users

### Webhooks Table (`webhooks`)
- **Purpose**: Event notification configuration
- **Key Features**: Retry logic, delivery tracking, rate limiting
- **Relationships**: Belongs to organization

### Call Records Table (`call_records`)
- **Purpose**: Call detail records and analytics
- **Key Features**: Complete call tracking, cost calculation, variables
- **Relationships**: Links to organization, trunk, user, queue

## Setup and Usage

### Prerequisites
- Node.js and npm installed
- MySQL/MariaDB server running
- Database user with CREATE/ALTER permissions

### Configuration
Ensure your `.env` file contains the correct database credentials:
```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=pbx_api_db
DB_USER=pbx_api
DB_PASSWORD=pbx_secure_password
DB_DIALECT=mysql
```

### Running Migrations

1. **Validate migration syntax** (recommended first step):
   ```bash
   node validate-migrations.js
   ```

2. **Check migration status**:
   ```bash
   npx sequelize-cli db:migrate:status
   ```

3. **Run all pending migrations**:
   ```bash
   npx sequelize-cli db:migrate
   ```

4. **Rollback last migration** (if needed):
   ```bash
   npx sequelize-cli db:migrate:undo
   ```

5. **Rollback all migrations** (if needed):
   ```bash
   npx sequelize-cli db:migrate:undo:all
   ```

### Creating a Fresh Database

If you need to set up a completely fresh database:

```bash
# Create database
mysql -u root -p -e "CREATE DATABASE pbx_api_db;"

# Grant permissions
mysql -u root -p -e "GRANT ALL PRIVILEGES ON pbx_api_db.* TO 'pbx_api'@'localhost';"

# Run migrations
npx sequelize-cli db:migrate
```

## Features Implemented

### ✅ UUID Primary Keys
All tables use UUID primary keys with automatic UUIDV4 generation for better distributed system support.

### ✅ Multi-Tenant Isolation
Every table (except organizations) includes `org_id` foreign key for complete data isolation between organizations.

### ✅ Comprehensive Indexing
- Primary and foreign key indexes
- Unique constraints where appropriate
- Performance indexes for common queries
- Composite indexes for multi-column searches

### ✅ Foreign Key Constraints
- Proper CASCADE relationships
- Data integrity enforcement
- Dependency order enforcement

### ✅ JSON Configuration Fields
- Flexible settings storage
- Default values for complex objects
- Future-proof configuration expansion

### ✅ ENUM Types
- Strict validation for status fields
- Consistent value enforcement
- Database-level constraints

### ✅ Timestamp Management
- Automatic created_at/updated_at
- Custom timestamp names where needed (queue_members)

### ✅ Decimal Precision
- Proper cost calculation fields
- Financial precision for billing

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify database credentials in `.env`
   - Ensure database server is running
   - Check user permissions

2. **Migration Syntax Errors**
   - Run `node validate-migrations.js` to check syntax
   - Verify all required Sequelize imports

3. **Foreign Key Constraint Violations**
   - Migrations must run in the correct order
   - Ensure parent tables exist before creating child tables

4. **Permission Denied Errors**
   - Database user needs CREATE, ALTER, INDEX permissions
   - Check MySQL/MariaDB user grants

### Useful Commands

```bash
# Show all tables
npx sequelize-cli db:migrate:status

# Generate new migration
npx sequelize-cli migration:generate --name migration-name

# Seed database (if seeders exist)
npx sequelize-cli db:seed:all

# Show migration history
npx sequelize-cli db:migrate:status
```

## Schema Validation

The included `validate-migrations.js` script performs comprehensive validation:
- Syntax checking for all migration files
- Dependency order verification
- Method existence validation
- Migration completeness check

## Next Steps

After running migrations:
1. Verify all tables were created correctly
2. Check indexes and foreign keys
3. Test with sample data
4. Set up any initial seed data
5. Configure application models to match schema

## Support

For issues or questions about the database schema:
1. Check the migration validation output
2. Review the individual migration files
3. Verify foreign key relationships
4. Test with a clean database environment