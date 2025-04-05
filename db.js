const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

class Database {
    constructor() {
        this.pool = null;
    }

    async initialize() {
        if (this.pool) {
            return this.pool;
        }

        try {
            // Use connection string for Heroku or local config
            const connectionConfig = isProduction ? {
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            } : {
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                host: process.env.DB_HOST,
                port: process.env.DB_PORT,
                database: process.env.DB_NAME,
                ssl: false
            };

            this.pool = new Pool({
                ...connectionConfig,
                max: isProduction ? 50 : 20,
                idleTimeoutMillis: 300000,
                connectionTimeoutMillis: 10000,
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000
            });

            // Test the connection
            await this.pool.query('SELECT 1');
            console.log(`Database connection established successfully in ${process.env.NODE_ENV} mode`);
            
            this.setupEventHandlers();
            return this.pool;
        } catch (err) {
            console.error('Failed to initialize database:', err);
            throw err;
        }
    }

    setupEventHandlers() {
        this.pool.on('error', (err, client) => {
            console.error('Unexpected error on idle client', err);
            console.error('Attempting to recover from pool error');
        });

        this.pool.on('connect', () => {
            console.log(`Database connected successfully in ${process.env.NODE_ENV} mode`);
        });

        this.pool.on('remove', () => {
            console.log('Database connection pool removed');
            if (isProduction) {
                setTimeout(() => {
                    this.pool.connect((err, client, release) => {
                        if (err) {
                            console.error('Error reconnecting to the database:', err);
                        } else {
                            console.log('Successfully reconnected to database');
                            release();
                        }
                    });
                }, 1000);
            }
        });
    }

    async query(...args) {
        if (!this.pool) {
            await this.initialize();
        }
        return this.pool.query(...args);
    }

    async getClient() {
        if (!this.pool) {
            await this.initialize();
        }
        return this.pool.connect();
    }
}

const db = new Database();

module.exports = db; 