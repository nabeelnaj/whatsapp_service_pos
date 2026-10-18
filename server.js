const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { createApp } = require('./app');
const { getGatewayPaths } = require('./lib/gateway-paths');
const { MessageStore } = require('./lib/message-store');
const { MessageQueue } = require('./lib/message-queue');
const { WhatsAppClient } = require('./lib/whatsapp-client');
const { createShutdown } = require('./lib/lifecycle');
const { createLockSafeLocalAuth } = require('./lib/lock-safe-local-auth');

try {
    if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
} catch (_) {
    // Environment injection is supported when no .env file is present.
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const token = process.env.WA_SERVICE_TOKEN;
if (!token) throw new Error('WA_SERVICE_TOKEN must be configured');

const paths = getGatewayPaths();
const limits = {
    maxDocumentBytes: positiveInteger(process.env.MAX_DOCUMENT_BYTES, 50 * 1024 * 1024),
    maxQueueSize: positiveInteger(process.env.MAX_QUEUE_SIZE, 1_000),
};
let qr = null;

const transport = new WhatsAppClient({
    ClientClass: Client,
    LocalAuthClass: createLockSafeLocalAuth(LocalAuth),
    MessageMediaClass: MessageMedia,
    sessionDir: paths.sessionPath,
    clientOptions: { puppeteer: { headless: true, args: ['--no-sandbox'] } },
    onQr: (value) => {
        QRCode.toDataURL(value).then((data) => { qr = data; }).catch(() => { qr = null; });
    },
});
const originalSession = transport.session.bind(transport);
transport.session = () => ({ ...originalSession(), qr });

const store = new MessageStore({ stateDir: paths.statePath, maxQueueSize: limits.maxQueueSize });
const queue = new MessageQueue({ store, transport });
async function waitForLegacyResult(job) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const current = store.get(job.id);
        if (['sent', 'delivered', 'read', 'failed'].includes(current?.status)) return current;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
}
const app = createApp({ token, store, queue, transport, limits, legacyWaitFor: waitForLegacyResult });
const port = positiveInteger(process.env.PORT, 3001);
const host = process.env.WA_BIND_HOST || '127.0.0.1';
let server;
const shutdown = createShutdown({
    queue,
    transport,
    closeServer: () => new Promise((resolve) => server ? server.close(resolve) : resolve()),
});

async function boot() {
    await store.load();
    queue.trackAcknowledgements(transport);
    queue.start();
    server = app.listen(port, host, () => console.log(`WA service running on ${host}:${port}`));
    transport.start().catch((error) => console.error('WhatsApp client initialization failed:', error.message));
}

process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
boot().catch((error) => {
    console.error('WhatsApp gateway failed to start:', error.message);
    process.exitCode = 1;
});

module.exports = { boot, shutdown };
