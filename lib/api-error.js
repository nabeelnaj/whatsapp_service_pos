class ApiError extends Error {
    constructor(status, code, message, retryable = false) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

function errorBody(error, requestId) {
    return {
        error: {
            code: error.code || 'internal_error',
            message: error.message || 'An unexpected error occurred.',
            retryable: Boolean(error.retryable),
        },
        request_id: requestId,
    };
}

module.exports = { ApiError, errorBody };
