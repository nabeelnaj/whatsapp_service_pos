const test = require('node:test');
const assert = require('node:assert/strict');
const { createLockSafeLocalAuth } = require('../lib/lock-safe-local-auth');

test('does not delete a LocalAuth profile while its Chromium browser owns it', async () => {
    let removals = 0;
    class LocalAuth {
        setup(client) { this.client = client; }
        async logout() { removals += 1; }
    }
    const Auth = createLockSafeLocalAuth(LocalAuth);
    const auth = new Auth();
    auth.setup({ pupBrowser: { isConnected: () => true } });

    await auth.logout();
    assert.equal(removals, 0);
});

test('cleans the profile after Chromium is no longer connected', async () => {
    let removals = 0;
    class LocalAuth {
        setup(client) { this.client = client; }
        async logout() { removals += 1; }
    }
    const Auth = createLockSafeLocalAuth(LocalAuth);
    const auth = new Auth();
    auth.setup({ pupBrowser: { isConnected: () => false } });

    await auth.logout();
    assert.equal(removals, 1);
});
