require('dotenv').config();
const { Pool } = require('pg');

async function checkDatabaseConfig() {
    console.log('Checking database configuration...');
    
    // Verify environment variables
    const requiredEnvVars = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.error('Missing required environment variables:', missingVars.join(', '));
        return false;
    }

    // Try to connect to database
    const pool = new Pool({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
    });

    try {
        const client = await pool.connect();
        console.log('Successfully connected to database');
        
        // Test query
        const result = await client.query('SELECT current_database(), current_user');
        console.log('Database:', result.rows[0].current_database);
        console.log('User:', result.rows[0].current_user);
        
        client.release();
        await pool.end();
        return true;
    } catch (error) {
        console.error('Failed to connect to database:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('Make sure the database server is running and accessible');
        } else if (error.code === '28P01') {
            console.error('Invalid username/password');
        } else if (error.code === '3D000') {
            console.error('Database does not exist');
        }
        return false;
    }
}

// Run if executed directly
if (require.main === module) {
    checkDatabaseConfig()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = checkDatabaseConfig; 