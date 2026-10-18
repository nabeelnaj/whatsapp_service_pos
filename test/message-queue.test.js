const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageQueue } = require('../lib/message-queue');

test('does not overlap browser sends', async () => {
    const jobs = [
        { id: 'one', status: 'queued', message: { to: '1' } },
        { id: 'two', status: 'queued', message: { to: '2' } },
    ];
    const store = {
        nextQueued: () => jobs.find((job) => job.status === 'queued'),
        transition: async (id, status) => { jobs.find((job) => job.id === id).status = status; },
    };
    let active = 0;
    let maximum = 0;
    const queue = new MessageQueue({
        store,
        transport: {
            isReady: async () => true,
            resolveRecipient: async (to) => to,
            send: async () => { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; },
        },
    });

    await Promise.all([queue.drain(), queue.drain()]);
    assert.equal(maximum, 1);
    assert.deepEqual(jobs.map((job) => job.status), ['sent', 'sent']);
});

test('marks an ambiguous send context failure retryable without replaying it', async () => {
    const job = { id: 'one', status: 'queued', message: { to: '1' } };
    const transitions = [];
    const queue = new MessageQueue({
        store: {
            nextQueued: () => job.status === 'queued' ? job : null,
            transition: async (_id, status, patch = {}) => { transitions.push({ status, patch }); job.status = status; },
        },
        transport: {
            isReady: async () => true,
            resolveRecipient: async () => '1@c.us',
            send: async () => { throw new Error('Execution context was destroyed'); },
        },
    });

    await queue.processOne();
    assert.deepEqual(transitions.at(-1), { status: 'failed', patch: { error: { code: 'send_context_lost', retryable: true } } });
});

test('returns a recipient navigation failure to the queue without sending', async () => {
    const job = { id: 'one', status: 'queued', message: { to: '1' } };
    let sends = 0;
    let scheduledDelay;
    const queue = new MessageQueue({
        store: {
            nextQueued: () => job.status === 'queued' ? job : null,
            transition: async (_id, status, patch = {}) => Object.assign(job, patch, { status }),
        },
        transport: {
            isReady: async () => true,
            resolveRecipient: async () => { throw new Error('Execution context was destroyed'); },
            send: async () => { sends += 1; },
        },
        now: () => 100,
        schedule: (_callback, delay) => { scheduledDelay = delay; },
    });

    await queue.processOne();
    assert.equal(job.status, 'queued');
    assert.equal(job.error.code, 'recipient_lookup_failed');
    assert.equal(job.nextAttemptAt > 100, true);
    assert.equal(scheduledDelay, 250);
    assert.equal(sends, 0);
});
