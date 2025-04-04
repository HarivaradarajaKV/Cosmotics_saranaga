const pool = require('../db');

async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('Successfully connected to Supabase!');
        
        // Test query
        const result = await client.query('SELECT NOW()');
        console.log('Database time:', result.rows[0].now);
        
        // Test a table query
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE';
        `);
        console.log('Available tables:', tables.rows.map(r => r.table_name));
        
        client.release();
        await pool.end();
    } catch (error) {
        console.error('Error connecting to database:', error);
    }
}

testConnection(); 