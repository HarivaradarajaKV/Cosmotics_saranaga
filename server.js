const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const WebSocket = require('ws');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { logger, requestLogger, errorLogger } = require('./utils/logger');
const responseHandler = require('./middleware/responseHandler');
require('dotenv').config();

const app = express();

// Compression middleware
app.use(compression());

// Request logging middleware
app.use(requestLogger);

// Security configurations
app.use(express.json({ limit: '10mb' })); // Request size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add request ID middleware
app.use((req, res, next) => {
    req.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    next();
});

// Add response handler middleware
app.use(responseHandler);

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
}));

// Basic rate limiting
const requestCounts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100; // per window per IP

app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip);
    const recentRequests = requests.filter(time => time > windowStart);
    requests.push(now);
    requestCounts.set(ip, recentRequests);
    
    if (recentRequests.length > MAX_REQUESTS) {
        logger.warn('Rate limit exceeded', { ip, requestCount: recentRequests.length });
        return res.error('Too many requests', 429);
    }
    
    next();
});

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Saranga Ayurveda API Documentation'
}));

// Root endpoint for basic health check
app.get('/', (req, res) => {
    res.success(null, 'API is running');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.success({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// WebSocket connections store
const clients = new Map();

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
    logger.info('Created uploads directory');
}

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
const routes = {
    auth: require('./routes/auth'),
    products: require('./routes/products'),
    categories: require('./routes/categories'),
    addresses: require('./routes/addresses'),
    brandReviews: require('./routes/brandReviews'),
    coupons: require('./routes/coupons'),
    payments: require('./routes/payments'),
    orders: require('./routes/orders'),
    razorpay: require('./routes/razorpay'),
    cart: require('./routes/cart'),
    admin: require('./routes/admin'),
    wishlist: require('./routes/wishlist'),
    users: require('./routes/users')
};

// Register routes
Object.entries(routes).forEach(([name, router]) => {
    app.use(`/api/${name}`, router);
    logger.info(`Registered route: /api/${name}`);
});

// Error logging middleware
app.use(errorLogger);

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    
    if (err.name === 'ValidationError') {
        return res.validationError(err.details);
    }
    
    if (err.name === 'UnauthorizedError') {
        return res.error('Authentication Error', 401, 'Invalid or missing authentication token');
    }
    
    if (err.code === '23505') { // PostgreSQL unique violation
        return res.error('Resource already exists', 409);
    }
    
    return res.error(
        process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred'
            : err.message,
        500
    );
});

const PORT = process.env.PORT || 5001;

// Initialize WebSocket server
const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT}`, {
        port: PORT,
        env: process.env.NODE_ENV,
        nodeVersion: process.version
    });
});

const wss = new WebSocket.Server({ server });

// Test database connection
(async () => {
    try {
        await pool.initialize();
        logger.info('Database connection successful');
    } catch (err) {
        logger.error('Database connection error:', {
            error: err.message,
            code: err.code
        });
    }
})();

// Handle server errors
server.on('error', (error) => {
    logger.error('Server error:', {
        error: error.message,
        code: error.code,
        stack: error.stack
    });
});

// Handle process termination
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Closing server...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', {
        error: error.message,
        stack: error.stack
    });
    // Give time for logs to be written
    setTimeout(() => process.exit(1), 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection:', {
        reason: reason.message || reason,
        stack: reason.stack
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
        const cartResult = await db.query('SELECT * FROM cart_items WHERE user_id = $1', [userId]);
        const wishlistResult = await db.query('SELECT * FROM wishlist_items WHERE user_id = $1', [userId]);
        const profileResult = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
        
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