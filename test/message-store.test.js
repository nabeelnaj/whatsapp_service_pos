const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MessageStore } = require('../lib/message-store');

const message = { to: '94777448223', type: 'text', content: { body: 'Ready' } };

async function temporaryStore() {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-store-'));
    const store = new MessageStore({ stateDir, now: () => 1_000 });
    await store.load();
    return { store, stateDir };
}

test('returns the original job for a matching idempotency replay', async () => {
    const { store } = await temporaryStore();
    const first = await store.create({ idempotencyKey: 'sale-100', fingerprint: 'same', message, requestId: 'r1' });
    const second = await store.create({ idempotencyKey: 'sale-100', fingerprint: 'same', message, requestId: 'r2' });
    assert.equal(second.id, first.id);
    assert.equal(second.replayed, true);
});

test('rejects an idempotency key reused with another payload', async () => {
    const { store } = await temporaryStore();
    await store.create({ idempotencyKey: 'sale-100', fingerprint: 'first', message, requestId: 'r1' });
    await assert.rejects(
        () => store.create({ idempotencyKey: 'sale-100', fingerprint: 'other', message, requestId: 'r2' }),
        (error) => error.status === 409,
    );
});

test('marks an interrupted sending job as ambiguous without replaying it', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-store-'));
    await fs.writeFile(path.join(stateDir, 'messages.json'), JSON.stringify({
        jobs: [{ id: 'wamid.local.1', status: 'sending', createdAt: 1_000 }],
        idempotency: {},
    }));
    const store = new MessageStore({ stateDir, now: () => 2_000 });
    await store.load();
    assert.deepEqual(store.get('wamid.local.1').error, { code: 'send_interrupted', retryable: true });
    assert.equal(store.get('wamid.local.1').status, 'failed');
});
