const fs = require('fs');
const { runWithNavigationRetry } = require('../navigation-retry');

class WhatsAppClient {
    constructor({ ClientClass, LocalAuthClass, MessageMediaClass, sessionDir, sessionPath, cacheTtlMs = 300000, navigationWait = async () => {}, onQr = () => {}, clientOptions = {} }) {
        this.ClientClass = ClientClass;
        this.LocalAuthClass = LocalAuthClass;
        this.MessageMediaClass = MessageMediaClass;
        this.sessionPath = sessionDir || sessionPath;
        this.cacheTtlMs = cacheTtlMs;
        this.navigationWait = navigationWait;
        this.onQr = onQr;
        this.clientOptions = clientOptions;
        this.client = null;
        this.ready = false;
        this.recipients = new Map();
        this.ackListeners = new Set();
        this.state = 'initializing';
        this.phone = null;
        this.lastError = null;
    }

    async start() {
        if (this.client) return;
        this.client = new this.ClientClass({
            ...this.clientOptions,
            authStrategy: this.LocalAuthClass ? new this.LocalAuthClass({ dataPath: this.sessionPath }) : undefined,
        });
        this.client.on('qr', (qr) => { this.state = 'pairing'; this.onQr(qr); });
        this.client.on('authenticated', () => { this.state = 'authenticated'; });
        this.client.on('loading_screen', () => { this.state = 'loading'; });
        this.client.on('ready', () => { this.ready = true; this.state = 'ready'; this.phone = this.client.info?.wid?.user || this.client.info?.me?.user || null; this.lastError = null; });
        this.client.on('auth_failure', (error) => { this.ready = false; this.state = 'auth_failure'; this.lastError = String(error || 'Authentication failed.'); });
        this.client.on('disconnected', (error) => { this.ready = false; this.state = 'disconnected'; this.phone = null; this.lastError = String(error || 'Disconnected.'); this.recipients.clear(); });
        this.client.on('message_ack', (message, ack) => {
            const status = ack === 3 ? 'read' : ack >= 2 ? 'delivered' : ack >= 1 ? 'sent' : null;
            if (!status || !message?.id?._serialized) return;
            const event = { whatsappMessageId: message.id._serialized, status };
            for (const listener of this.ackListeners) listener(event);
        });
        await this.client.initialize();
    }

    async isReady() {
        if (!this.ready || !this.client) return false;
        return runWithNavigationRetry(() => this.client.getState(), { wait: this.navigationWait })
            .then((state) => state === 'CONNECTED')
            .catch(() => false);
    }

    async resolveRecipient(to) {
        const cached = this.recipients.get(to);
        if (cached && cached.expiresAt > Date.now()) return cached.id;
        const result = await runWithNavigationRetry(() => this.client.getNumberId(to), { wait: this.navigationWait });
        if (!result?._serialized) throw new Error('Recipient is not registered on WhatsApp.');
        this.recipients.set(to, { id: result._serialized, expiresAt: Date.now() + this.cacheTtlMs });
        return result._serialized;
    }

    async send(job, recipient) {
        const { type, content } = job.message;
        if (type === 'text') {
            const result = await this.client.sendMessage(recipient, content.body);
            return { id: result?.id?._serialized };
        }
        const media = new this.MessageMediaClass(content.mime_type, content.data, content.filename);
        const result = await this.client.sendMessage(recipient, media, content.caption ? { caption: content.caption } : undefined);
        return { id: result?.id?._serialized };
    }

    session() {
        return { state: this.state, ready: this.ready, phone: this.phone, lastError: this.lastError };
    }

    onAck(listener) {
        this.ackListeners.add(listener);
        return () => this.ackListeners.delete(listener);
    }

    async stop({ clearSession = false } = {}) {
        const client = this.client;
        this.client = null;
        this.ready = false;
        this.recipients.clear();
        this.state = clearSession ? 'logged_out' : 'stopped';
        if (client?.destroy) await client.destroy();
        if (clearSession && this.sessionPath) await fs.promises.rm(this.sessionPath, { recursive: true, force: true });
    }
}

module.exports = { WhatsAppClient };
