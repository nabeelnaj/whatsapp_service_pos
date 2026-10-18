const crypto = require('crypto');
const express = require('express');
const { ApiError, errorBody } = require('./lib/api-error');
const { validateMessage, idempotencyFingerprint } = require('./lib/message-schema');

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createApp({ token, store, queue, transport, requestId = () => crypto.randomUUID(), limits = {}, legacyWaitFor }) {
    const app = express();
    app.use(express.json({ limit: `${limits.maxDocumentBytes || 50 * 1024 * 1024}b` }));
    app.use((req, _res, next) => { req.requestId = requestId(); next(); });

    app.get('/v1/health', (_req, res) => res.json({ status: 'ok' }));

    app.use((req, _res, next) => {
        const authorization = req.get('authorization') || '';
        const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const expectedBuffer = Buffer.from(token || '');
        const suppliedBuffer = Buffer.from(supplied);
        if (!expectedBuffer.length || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
            return next(new ApiError(401, 'unauthorized', 'A valid bearer token is required.'));
        }
        next();
    });

    app.get('/v1/readiness', asyncRoute(async (_req, res) => {
        if (!await transport.isReady()) throw new ApiError(503, 'whatsapp_not_ready', 'WhatsApp Web is not ready.', true);
        res.json({ status: 'ready' });
    }));

    app.get('/v1/session', (_req, res) => res.json({ ...transport.session(), queue_depth: queue.depth() }));

    app.post('/v1/messages', asyncRoute(async (req, res) => {
        const idempotencyKey = req.get('idempotency-key');
        if (!idempotencyKey) throw new ApiError(400, 'idempotency_key_required', 'Idempotency-Key is required.');
        const message = validateMessage(req.body, limits);
        const job = await store.create({
            idempotencyKey,
            fingerprint: idempotencyFingerprint(message),
            message,
            requestId: req.requestId,
        });
        queue.wake();
        res.status(job.replayed ? 200 : 202).json({
            messaging_product: 'whatsapp',
            messages: [{ id: job.id, status: job.status }],
            request_id: req.requestId,
        });
    }));

    app.get('/v1/messages/:id', (req, res, next) => {
        const job = store.get(req.params.id);
        if (!job) return next(new ApiError(404, 'message_not_found', 'Message was not found.'));
        res.json({ message: job, request_id: req.requestId });
    });

    app.post('/start', asyncRoute(async (_req, res) => {
        await transport.start();
        res.json({ status: true, message: 'starting' });
    }));

    app.get('/status', asyncRoute(async (_req, res) => {
        const session = transport.session();
        res.json({ connected: await transport.isReady(), phone: session.phone || null, qr: session.qr || null, starting: session.state === 'initializing' || session.state === 'loading' });
    }));

    app.post('/send', asyncRoute(async (req, res) => {
        const { target, message, file } = req.body || {};
        const payload = file?.data
            ? { to: target, type: 'document', document: { data: file.data, filename: file.filename || 'document', mime_type: file.mimetype, caption: message || '' } }
            : { to: target, type: 'text', text: { body: message } };
        const normalized = validateMessage(payload, limits);
        const job = await store.create({
            idempotencyKey: `legacy-${crypto.randomUUID()}`,
            fingerprint: idempotencyFingerprint(normalized),
            message: normalized,
            requestId: req.requestId,
        });
        queue.wake();
        const terminal = legacyWaitFor ? await legacyWaitFor(job) : null;
        if (!terminal) return res.status(504).json({ status: false, reason: 'message delivery timed out', message_id: job.id });
        if (terminal.status === 'failed') return res.status(500).json({ status: false, reason: terminal.error?.message || terminal.error?.code || 'message delivery failed', message_id: job.id });
        res.json({ status: true, message_id: job.id });
    }));

    app.post('/disconnect', asyncRoute(async (_req, res) => {
        await queue.failQueued('session_disconnected');
        await transport.stop({ clearSession: true });
        res.json({ status: true });
    }));

    app.use((error, req, res, _next) => {
        const apiError = error instanceof ApiError
            ? error
            : new ApiError(error?.type === 'entity.parse.failed' ? 400 : 500, error?.type === 'entity.parse.failed' ? 'invalid_json' : 'internal_error', error?.type === 'entity.parse.failed' ? 'Request body must be valid JSON.' : 'An unexpected error occurred.', false);
        res.status(apiError.status).json(errorBody(apiError, req.requestId));
    });
    return app;
}

module.exports = { createApp };
