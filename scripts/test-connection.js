require('dotenv').config({ path: '.env.production' });
const pool = require('../db');

async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('Successfully connected to Supabase!');
        
        // Test query
        const result = await client.query('SELECT NOW()');
        console.log('Test query result:', result.rows[0]);
        
        client.release();
        await pool.end();
    } catch (error) {
        console.error('Error connecting to Supabase:', error);
    }
}

testConnection(); 