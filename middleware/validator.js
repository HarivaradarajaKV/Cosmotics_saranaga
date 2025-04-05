const validator = {
    validateBody: (schema) => {
        return (req, res, next) => {
            const { error } = schema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.context.key,
                    message: detail.message
                }));
                return res.validationError(errors);
            }
            next();
        };
    },

    validateQuery: (schema) => {
        return (req, res, next) => {
            const { error } = schema.validate(req.query, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.context.key,
                    message: detail.message
                }));
                return res.validationError(errors);
            }
            next();
        };
    },

    validateParams: (schema) => {
        return (req, res, next) => {
            const { error } = schema.validate(req.params, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => ({
                    field: detail.context.key,
                    message: detail.message
                }));
                return res.validationError(errors);
            }
            next();
        };
    }
};

module.exports = validator; 