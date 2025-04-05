const responseHandler = (req, res, next) => {
    // Success response wrapper
    res.success = (data, message = 'Success', statusCode = 200) => {
        return res.status(statusCode).json({
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        });
    };

    // Error response wrapper
    res.error = (message, statusCode = 500, errors = null) => {
        const response = {
            success: false,
            message,
            timestamp: new Date().toISOString()
        };

        if (errors) {
            response.errors = errors;
        }

        // Add request ID in development
        if (process.env.NODE_ENV === 'development') {
            response.requestId = req.id;
            response.path = req.originalUrl;
        }

        return res.status(statusCode).json(response);
    };

    // Validation error wrapper
    res.validationError = (errors) => {
        return res.error('Validation failed', 400, errors);
    };

    next();
};

module.exports = responseHandler; 