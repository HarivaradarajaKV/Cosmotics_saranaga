const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();

// Root endpoint for basic health check
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

// Health check endpoint without /api prefix
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// WebSocket connections store
const clients = new Map();

// Enhanced CORS configuration
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Railway - moved before database operations
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads', 'profile-photos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');
const addressesRouter = require('./routes/addresses');
const brandReviewsRouter = require('./routes/brandReviews');
const couponsRouter = require('./routes/coupons');
const paymentsRouter = require('./routes/payments');
const ordersRouter = require('./routes/orders');
const razorpayRouter = require('./routes/razorpay');

app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/brand-reviews', brandReviewsRouter);
app.use('/api/coupons', couponsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/razorpay', razorpayRouter);
app.use('/api/cart', require('./routes/cart'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wishlist', require('./routes/wishlist'));
app.use('/api/users', require('./routes/users'));
app.use('/orders', ordersRouter);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5001;

// Start server immediately without waiting for DB
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Test database connection in the background
pool.connect((err, client, release) => {
    if (err) {
        console.error('Warning - Database connection error:', err);
        // Don't exit process, just log the error
    } else {
        release();
        console.log('Database connection successful');
    }
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let currentUserId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                currentUserId = data.userId;
                if (!clients.has(currentUserId)) {
                    clients.set(currentUserId, new Set());
                }
                clients.get(currentUserId).add(ws);
            }
            
            if (data.type === 'sync_request' && currentUserId) {
                const userData = await getUserData(currentUserId);
                if (userData) {
                    ws.send(JSON.stringify({
                        type: 'SYNC_DATA',
                        payload: userData
                    }));
                }
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        if (currentUserId && clients.has(currentUserId)) {
            const connections = clients.get(currentUserId);
            connections.delete(ws);
            if (connections.size === 0) {
                clients.delete(currentUserId);
            }
        }
    });
});

// Helper function to get user data
async function getUserData(userId) {
    try {
        const cartResult = await pool.query('SELECT * FROM cart_items WHERE user_id = $1', [userId]);
        const wishlistResult = await pool.query('SELECT * FROM wishlist_items WHERE user_id = $1', [userId]);
        const profileResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        
        return {
            cart: cartResult.rows,
            wishlist: wishlistResult.rows,
            profile: profileResult.rows[0]
        };
    } catch (error) {
        console.error('Error fetching user data:', error);
        return null;
    }
} 