const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMessage, idempotencyFingerprint } = require('../lib/message-schema');

test('normalizes a text request and creates a deterministic fingerprint', () => {
    const message = validateMessage({
        to: '+94 777 448 223',
        type: 'text',
        text: { body: 'Invoice ready' },
    });

    assert.deepEqual(message, {
        to: '94777448223',
        type: 'text',
        content: { body: 'Invoice ready' },
    });
    assert.equal(idempotencyFingerprint(message), idempotencyFingerprint(message));
});

test('rejects an oversized document before persistence', () => {
    assert.throws(
        () => validateMessage({
            to: '94777448223',
            type: 'document',
            document: {
                data: 'a'.repeat(101),
                filename: 'invoice.pdf',
                mime_type: 'application/pdf',
            },
        }, { maxDocumentBytes: 50 }),
        (error) => error.code === 'document_too_large' && error.status === 400,
    );
});

test('normalizes a document MIME type for the transport contract', () => {
    const message = validateMessage({
        to: '94777448223',
        type: 'document',
        document: { data: 'cGRm', filename: 'invoice.pdf', mime_type: 'application/pdf' },
    });

    assert.equal(message.content.mime_type, 'application/pdf');
});
