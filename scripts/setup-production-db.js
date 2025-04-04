require('dotenv').config({ path: '.env.production' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

async function setupProductionDatabase() {
    try {
        // Read the database.sql file
        const sqlFile = fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8');
        
        // Connect to database
        const client = await pool.connect();
        
        console.log('Connected to production database');
        
        try {
            // Begin transaction
            await client.query('BEGIN');
            
            // Split the SQL file into individual statements
            const statements = sqlFile.split(';').filter(stmt => stmt.trim());
            
            // Execute each statement
            for (let statement of statements) {
                if (statement.trim()) {
                    await client.query(statement);
                    console.log('Executed statement successfully');
                }
            }
            
            // Run additional migration scripts
            const migrationFiles = [
                '../addCategoriesTable.js',
                '../addReviewsTable.js',
                '../addBrandReviewsTable.js',
                '../addCreatedAt.js',
                '../addOrderUpdatedAt.js'
            ];
            
            for (const migrationFile of migrationFiles) {
                const migration = require(migrationFile);
                await migration(client);
                console.log(`Executed migration: ${migrationFile}`);
            }
            
            // Commit transaction
            await client.query('COMMIT');
            console.log('Production database setup completed successfully');
            
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error setting up production database:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

setupProductionDatabase(); 