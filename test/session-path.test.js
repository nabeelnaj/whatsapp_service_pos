const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { getSessionPath } = require('../session-path');

test('stores the Chromium profile outside the OneDrive project by default', () => {
    const sessionPath = getSessionPath({
        LOCALAPPDATA: 'C:\\Users\\arsha\\AppData\\Local',
    });

    assert.equal(
        sessionPath,
        path.join('C:\\Users\\arsha\\AppData\\Local', 'DikasirPOS', 'whatsapp-service', 'session'),
    );
});

test('allows an explicit session path for deployments', () => {
    assert.equal(
        getSessionPath({ WA_SESSION_PATH: 'D:\\service-data\\whatsapp', LOCALAPPDATA: 'C:\\ignored' }),
        'D:\\service-data\\whatsapp',
    );
});
