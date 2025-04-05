const fs = require('fs').promises;
const path = require('path');
const db = require('../db');
const createMigrationTable = require('./create_migration_table');

async function getAppliedMigrations() {
    const result = await db.query('SELECT name FROM migrations ORDER BY applied_at');
    return result.rows.map(row => row.name);
}

async function markMigrationAsApplied(name) {
    await db.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
}

async function runMigrations() {
    try {
        // Ensure migration table exists
        await createMigrationTable();

        // Get list of applied migrations
        const appliedMigrations = await getAppliedMigrations();

        // Get all migration files
        const files = await fs.readdir(__dirname);
        const migrationFiles = files
            .filter(f => f.endsWith('.js') || f.endsWith('.sql'))
            .filter(f => f !== 'run_migration.js' && f !== 'create_migration_table.js')
            .sort();

        // Run pending migrations
        for (const file of migrationFiles) {
            if (!appliedMigrations.includes(file)) {
                console.log(`Running migration: ${file}`);
                
                try {
                    if (file.endsWith('.js')) {
                        // For JS migrations
                        const migration = require(path.join(__dirname, file));
                        if (typeof migration === 'function') {
                            await migration();
                        } else if (typeof migration.up === 'function') {
                            await migration.up();
                        }
                    } else if (file.endsWith('.sql')) {
                        // For SQL migrations
                        const sql = await fs.readFile(path.join(__dirname, file), 'utf8');
                        await db.query(sql);
                    }

                    // Mark migration as applied
                    await markMigrationAsApplied(file);
                    console.log(`Successfully applied migration: ${file}`);
                } catch (error) {
                    console.error(`Error applying migration ${file}:`, error);
                    throw error;
                }
            } else {
                console.log(`Skipping already applied migration: ${file}`);
            }
        }

        console.log('All migrations completed successfully');
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    }
}

// Execute if this file is run directly
if (require.main === module) {
    runMigrations()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = runMigrations; 