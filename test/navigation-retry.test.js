const test = require('node:test');
const assert = require('node:assert/strict');

const { runWithNavigationRetry } = require('../navigation-retry');

test('retries once when WhatsApp Web replaces Puppeteer execution context', async () => {
    let attempts = 0;
    const result = await runWithNavigationRetry(async () => {
        attempts += 1;
        if (attempts === 1) {
            throw new Error('Execution context was destroyed, most likely because of a navigation.');
        }
        return 'sent';
    }, { wait: async () => {} });

    assert.equal(result, 'sent');
    assert.equal(attempts, 2);
});

test('does not retry a normal WhatsApp send failure', async () => {
    let attempts = 0;

    await assert.rejects(
        () => runWithNavigationRetry(async () => {
            attempts += 1;
            throw new Error('Chat not found');
        }, { wait: async () => {} }),
        /Chat not found/,
    );

    assert.equal(attempts, 1);
});
