const db = require('../db');

async function createMigrationTable() {
    try {
        // Create migrations table if it doesn't exist
        await db.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Migration table created successfully');
    } catch (error) {
        console.error('Error creating migration table:', error);
        throw error;
    }
}

// Execute if this file is run directly
if (require.main === module) {
    createMigrationTable()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = createMigrationTable; 