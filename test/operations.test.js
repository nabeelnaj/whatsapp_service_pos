const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MessageQueue } = require('../lib/message-queue');
const { createShutdown } = require('../lib/lifecycle');

test('records delivered acknowledgement by WhatsApp message id', async () => {
    const job = { id: 'wamid.local.1', status: 'sent', whatsappMessageId: 'true-message-id' };
    const transport = new EventEmitter();
    transport.onAck = (listener) => transport.on('ack', listener);
    const queue = new MessageQueue({
        store: {
            state: { jobs: [job] },
            nextQueued: () => null,
            transition: async (_id, status) => { job.status = status; },
        },
        transport: { isReady: async () => false },
    });
    queue.trackAcknowledgements(transport);
    transport.emit('ack', { whatsappMessageId: 'true-message-id', status: 'delivered' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(job.status, 'delivered');
});

test('shutdown stops the queue before destroying the browser client', async () => {
    const events = [];
    await createShutdown({
        queue: { stop: () => events.push('queue.stop') },
        transport: { stop: async () => events.push('transport.stop') },
        closeServer: async () => events.push('server.close'),
    })();

    assert.deepEqual(events, ['queue.stop', 'transport.stop', 'server.close']);
});

test('marks queued jobs failed when a session is explicitly disconnected', async () => {
    const jobs = [{ id: 'wamid.local.1', status: 'queued' }];
    const queue = new MessageQueue({
        store: {
            state: { jobs },
            transition: async (_id, status, patch) => Object.assign(jobs[0], patch, { status }),
        },
        transport: { isReady: async () => false },
    });

    await queue.failQueued('session_disconnected');
    assert.deepEqual(jobs[0], { id: 'wamid.local.1', status: 'failed', error: { code: 'session_disconnected', retryable: false } });
});
