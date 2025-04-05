const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Create separate loggers for different levels
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'api-service' },
    transports: [
        // Error logs
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Combined logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Debug logs
        new winston.transports.File({
            filename: path.join(logsDir, 'debug.log'),
            level: 'debug',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Create request logger
const requestLogger = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('Request completed', {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId: req.user?.id
        });
    });
    next();
};

// Create error logger middleware
const errorLogger = (err, req, res, next) => {
    logger.error('Error occurred', {
        error: {
            message: err.message,
            stack: err.stack,
            code: err.code
        },
        request: {
            method: req.method,
            url: req.originalUrl,
            body: req.body,
            params: req.params,
            query: req.query,
            userId: req.user?.id
        }
    });
    next(err);
};

// Create build logger
const buildLogger = {
    start: (buildId) => {
        logger.info('Build started', { buildId });
    },
    success: (buildId, duration) => {
        logger.info('Build completed successfully', { buildId, duration });
    },
    error: (buildId, error) => {
        logger.error('Build failed', { buildId, error });
    },
    warning: (buildId, message) => {
        logger.warn('Build warning', { buildId, message });
    }
};

// Create cleanup utility
const cleanupOldLogs = async () => {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();

    try {
        const files = await fs.promises.readdir(logsDir);
        for (const file of files) {
            const filePath = path.join(logsDir, file);
            const stats = await fs.promises.stat(filePath);
            if (now - stats.mtime.getTime() > maxAge) {
                await fs.promises.unlink(filePath);
                logger.info(`Deleted old log file: ${file}`);
            }
        }
    } catch (error) {
        logger.error('Error cleaning up old logs:', error);
    }
};

// Schedule log cleanup
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000); // Run daily

module.exports = {
    logger,
    requestLogger,
    errorLogger,
    buildLogger
}; 