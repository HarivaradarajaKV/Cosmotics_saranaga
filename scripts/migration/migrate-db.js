require('dotenv').config({ path: '.env.migration' });
const { Pool } = require('pg');

async function migrateDatabaseToSupabase() {
    // Source (local) database connection
    const sourcePool = new Pool({
        user: process.env.SOURCE_DB_USER,
        password: process.env.SOURCE_DB_PASSWORD,
        host: 'localhost',
        port: 5432,
        database: process.env.SOURCE_DB_NAME
    });

    // Target (Supabase) database connection
    const targetPool = new Pool({
        connectionString: process.env.TARGET_DB_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Starting database migration to Supabase...');
        console.log('Connecting to local database...');
        
        // Test source connection
        const sourceClient = await sourcePool.connect();
        console.log('Local database connected successfully');

        // Get all tables from source database
        const tables = await sourceClient.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND table_name NOT IN ('pg_stat_statements');
        `);

        console.log('Tables found:', tables.rows.map(r => r.table_name));

        console.log('Connecting to Supabase...');
        // Connect to target database
        const targetClient = await targetPool.connect();
        console.log('Supabase connected successfully');

        // Start transaction
        await targetClient.query('BEGIN');

        try {
            // Migrate each table
            for (const tableRow of tables.rows) {
                const tableName = tableRow.table_name;
                console.log(`Migrating table: ${tableName}`);

                try {
                    // Get table structure including constraints, primary keys, and sequences
                    const tableStructure = await sourceClient.query(`
                        SELECT 
                            c.column_name, 
                            c.data_type,
                            c.character_maximum_length,
                            c.column_default,
                            c.is_nullable,
                            CASE 
                                WHEN pk.column_name IS NOT NULL THEN true 
                                ELSE false 
                            END as is_primary_key,
                            c.column_default as sequence_default
                        FROM information_schema.columns c
                        LEFT JOIN (
                            SELECT ku.column_name
                            FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage ku
                                ON tc.constraint_name = ku.constraint_name
                            WHERE tc.constraint_type = 'PRIMARY KEY'
                            AND tc.table_name = $1
                        ) pk ON c.column_name = pk.column_name
                        WHERE c.table_name = $1 
                        AND c.table_schema = 'public'
                        ORDER BY c.ordinal_position;
                    `, [tableName]);

                    // Create sequences first
                    for (const column of tableStructure.rows) {
                        if (column.sequence_default && column.sequence_default.includes('nextval')) {
                            const sequenceName = `${tableName}_${column.column_name}_seq`;
                            await targetClient.query(`
                                DROP SEQUENCE IF EXISTS "${sequenceName}" CASCADE;
                                CREATE SEQUENCE "${sequenceName}";
                            `);
                        }
                    }

                    // Create table structure
                    let createTableSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (`;
                    const columns = tableStructure.rows.map(col => {
                        let colDef = `"${col.column_name}" ${col.data_type}`;
                        if (col.character_maximum_length) {
                            colDef += `(${col.character_maximum_length})`;
                        }
                        if (col.sequence_default && col.sequence_default.includes('nextval')) {
                            const sequenceName = `${tableName}_${col.column_name}_seq`;
                            colDef += ` DEFAULT nextval('${sequenceName}'::regclass)`;
                        } else if (col.column_default) {
                            colDef += ` DEFAULT ${col.column_default}`;
                        }
                        colDef += col.is_nullable === 'YES' ? ' NULL' : ' NOT NULL';
                        if (col.is_primary_key) {
                            colDef += ' PRIMARY KEY';
                        }
                        return colDef;
                    });
                    createTableSQL += columns.join(', ') + ')';

                    // Create table in target database
                    await targetClient.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
                    await targetClient.query(createTableSQL);

                    // Get table data
                    const { rows } = await sourceClient.query(`SELECT * FROM "${tableName}"`);
                    
                    if (rows.length > 0) {
                        // Get column names
                        const columns = Object.keys(rows[0]);
                        
                        // Insert data in batches
                        const batchSize = 50;
                        for (let i = 0; i < rows.length; i += batchSize) {
                            const batch = rows.slice(i, i + batchSize);
                            for (const row of batch) {
                                const values = columns.map(col => row[col]);
                                const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                                
                                try {
                                    await targetClient.query(`
                                        INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
                                        VALUES (${placeholders})
                                    `, values);
                                } catch (insertError) {
                                    console.error(`Error inserting row in ${tableName}:`, insertError.message);
                                    console.error('Problematic row:', row);
                                    throw insertError;
                                }
                            }
                            console.log(`Migrated ${Math.min((i + batchSize), rows.length)} of ${rows.length} rows from table ${tableName}`);
                        }

                        // Update sequences to max value
                        for (const column of tableStructure.rows) {
                            if (column.sequence_default && column.sequence_default.includes('nextval')) {
                                const sequenceName = `${tableName}_${column.column_name}_seq`;
                                await targetClient.query(`
                                    SELECT setval('"${sequenceName}"', (SELECT MAX("${column.column_name}") FROM "${tableName}"));
                                `);
                            }
                        }
                    }

                    console.log(`Completed migration of table: ${tableName}`);
                } catch (tableError) {
                    console.error(`Error migrating table ${tableName}:`, tableError.message);
                    throw tableError;
                }
            }

            // Commit transaction
            await targetClient.query('COMMIT');
            console.log('Migration completed successfully!');

        } catch (error) {
            await targetClient.query('ROLLBACK');
            throw error;
        } finally {
            targetClient.release();
            sourceClient.release();
        }

    } catch (error) {
        console.error('Error during migration:', error);
        console.error('Error details:', error.message);
        process.exit(1);
    } finally {
        await sourcePool.end();
        await targetPool.end();
    }
}

migrateDatabaseToSupabase(); 