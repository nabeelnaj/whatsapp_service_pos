const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

async function request(app, method, pathname, { headers = {}, body } = {}) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
            method,
            headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: JSON.parse(await response.text()) };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function dependencies({ ready = false } = {}) {
    const jobs = new Map();
    let sequence = 0;
    return {
        store: {
            create: async ({ message }) => {
                const job = { id: `wamid.local.${++sequence}`, message, status: 'queued', replayed: false };
                jobs.set(job.id, job);
                return job;
            },
            get: (id) => jobs.get(id) || null,
        },
        queue: { wake: () => {} },
        transport: { isReady: async () => ready, session: () => ({ state: ready ? 'ready' : 'pairing', ready }) },
    };
}

test('accepts a v1 message once and replies immediately with 202', async () => {
    const { store, queue, transport } = dependencies();
    const response = await request(createApp({ token: 'test-token', store, queue, transport }), 'POST', '/v1/messages', {
        headers: { authorization: 'Bearer test-token', 'idempotency-key': 'invoice-100' },
        body: { to: '94777448223', type: 'text', text: { body: 'Ready' } },
    });

    assert.equal(response.status, 202);
    assert.match(response.body.messages[0].id, /^wamid\.local\./);
    assert.equal(response.body.messages[0].status, 'queued');
});

test('keeps health alive while readiness reports a logged-out client', async () => {
    const { store, queue, transport } = dependencies({ ready: false });
    const app = createApp({ token: 'test-token', store, queue, transport });

    assert.equal((await request(app, 'GET', '/v1/health')).status, 200);
    const readiness = await request(app, 'GET', '/v1/readiness', { headers: { authorization: 'Bearer test-token' } });
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.error.code, 'whatsapp_not_ready');
});

test('requires a bearer token for readiness', async () => {
    const { store, queue, transport } = dependencies({ ready: true });
    const response = await request(createApp({ token: 'test-token', store, queue, transport }), 'GET', '/v1/readiness');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'unauthorized');
});

test('reports session lifecycle data and queue depth', async () => {
    const { store, queue, transport } = dependencies({ ready: true });
    queue.depth = () => 2;
    transport.session = () => ({ state: 'ready', ready: true, phone: '94770000000', lastError: null });
    const response = await request(createApp({ token: 'test-token', store, queue, transport }), 'GET', '/v1/session', {
        headers: { authorization: 'Bearer test-token' },
    });

    assert.deepEqual(response.body, { state: 'ready', ready: true, phone: '94770000000', lastError: null, queue_depth: 2 });
});

test('returns structured errors when the idempotency key is missing', async () => {
    const { store, queue, transport } = dependencies();
    const response = await request(createApp({ token: 'test-token', store, queue, transport }), 'POST', '/v1/messages', {
        headers: { authorization: 'Bearer test-token' },
        body: { to: '94777448223', type: 'text', text: { body: 'Ready' } },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'idempotency_key_required');
    assert.equal(typeof response.body.request_id, 'string');
});

test('maps a legacy send request into a terminal result', async () => {
    const { store, queue, transport } = dependencies();
    const response = await request(createApp({ token: 'test-token', store, queue, transport, legacyWaitFor: async (job) => ({ ...job, status: 'sent' }) }), 'POST', '/send', {
        headers: { authorization: 'Bearer test-token' },
        body: { target: '94777448223', message: 'Ready' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, true);
    assert.match(response.body.message_id, /^wamid\.local\./);
});
