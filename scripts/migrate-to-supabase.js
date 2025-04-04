require('dotenv').config();
const { execSync } = require('child_process');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrateToSupabase() {
    try {
        // Step 1: Dump local database
        console.log('Dumping local database...');
        const dumpCommand = `pg_dump -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -F p -f database_dump.sql`;
        execSync(dumpCommand);
        console.log('Local database dump created successfully');

        // Step 2: Connect to Supabase
        const supabasePool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        console.log('Connecting to Supabase...');
        const client = await supabasePool.connect();

        try {
            // Step 3: Read and execute dump file
            console.log('Reading dump file...');
            const sqlFile = fs.readFileSync('database_dump.sql', 'utf8');
            
            // Step 4: Execute migration in transaction
            await client.query('BEGIN');
            
            const statements = sqlFile
                .split(';')
                .filter(stmt => stmt.trim())
                .map(stmt => stmt.replace(/public\./g, '')); // Remove schema references
            
            for (let statement of statements) {
                if (statement.trim()) {
                    try {
                        await client.query(statement);
                        console.log('Executed statement successfully');
                    } catch (err) {
                        console.warn('Warning: Statement failed:', err.message);
                        // Continue with next statement unless it's a critical error
                    }
                }
            }

            // Step 5: Run additional migration scripts
            const migrationFiles = [
                '../addCategoriesTable.js',
                '../addReviewsTable.js',
                '../addBrandReviewsTable.js',
                '../addCreatedAt.js',
                '../addOrderUpdatedAt.js'
            ];
            
            for (const migrationFile of migrationFiles) {
                try {
                    const migration = require(migrationFile);
                    await migration(client);
                    console.log(`Executed migration: ${migrationFile}`);
                } catch (err) {
                    console.warn(`Warning: Migration ${migrationFile} failed:`, err.message);
                }
            }

            await client.query('COMMIT');
            console.log('Migration to Supabase completed successfully');

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
            // Clean up dump file
            fs.unlinkSync('database_dump.sql');
        }
    } catch (err) {
        console.error('Error during migration:', err);
        process.exit(1);
    }
}

migrateToSupabase(); 