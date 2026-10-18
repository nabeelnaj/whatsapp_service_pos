const crypto = require('crypto');
const { ApiError } = require('./api-error');

const DEFAULT_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function normalizeRecipient(value) {
    const normalized = String(value || '').replace(/[^0-9]/g, '');
    if (!normalized) {
        throw new ApiError(400, 'invalid_recipient', 'A recipient phone number is required.');
    }
    return normalized;
}

function validateMessage(payload, { maxDocumentBytes = DEFAULT_MAX_DOCUMENT_BYTES } = {}) {
    if (!payload || typeof payload !== 'object') {
        throw new ApiError(400, 'invalid_request', 'A JSON message body is required.');
    }

    const to = normalizeRecipient(payload.to);
    if (payload.type === 'text') {
        const body = payload.text?.body;
        if (typeof body !== 'string' || !body.trim()) {
            throw new ApiError(400, 'invalid_text', 'Text messages require a non-empty text.body value.');
        }
        return { to, type: 'text', content: { body } };
    }

    if (payload.type === 'document') {
        const document = payload.document || {};
        if (typeof document.data !== 'string' || !document.data) {
            throw new ApiError(400, 'invalid_document', 'Document messages require base64 document.data.');
        }
        const bytes = Buffer.byteLength(document.data, 'base64');
        if (bytes > maxDocumentBytes) {
            throw new ApiError(400, 'document_too_large', `Document exceeds the ${maxDocumentBytes}-byte limit.`);
        }
        if (typeof document.filename !== 'string' || !document.filename) {
            throw new ApiError(400, 'invalid_document', 'Document messages require document.filename.');
        }
        return {
            to,
            type: 'document',
            content: {
                data: document.data,
                filename: document.filename,
                mime_type: document.mime_type || 'application/octet-stream',
                caption: document.caption || '',
            },
        };
    }

    throw new ApiError(400, 'unsupported_message_type', 'Only text and document messages are supported.');
}

function idempotencyFingerprint(message) {
    return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex');
}

module.exports = { DEFAULT_MAX_DOCUMENT_BYTES, validateMessage, idempotencyFingerprint };
