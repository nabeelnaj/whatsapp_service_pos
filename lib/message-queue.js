function isContextLoss(error) {
    return /Execution context was destroyed|Cannot find context/i.test(error?.message || '');
}

class MessageQueue {
    constructor({ store, transport, now = Date.now, maxRecipientRetries = 3, schedule = setTimeout }) {
        this.store = store;
        this.transport = transport;
        this.now = now;
        this.maxRecipientRetries = maxRecipientRetries;
        this.schedule = schedule;
        this.draining = false;
        this.stopped = false;
    }

    start() {
        this.stopped = false;
        return this.wake();
    }

    stop() {
        this.stopped = true;
    }

    wake() {
        return this.drain();
    }

    async drain() {
        if (this.draining || this.stopped) return;
        this.draining = true;
        try {
            while (!this.stopped && await this.processOne()) {}
        } finally {
            this.draining = false;
        }
    }

    async processOne() {
        const job = this.store.nextQueued(this.now());
        if (!job || !await this.transport.isReady()) return false;
        await this.store.transition(job.id, 'sending');
        try {
            let recipient;
            try {
                recipient = await this.transport.resolveRecipient(job.message.to);
            } catch (error) {
                const attempts = (job.recipientAttempts || 0) + 1;
                if (attempts >= this.maxRecipientRetries) {
                    await this.store.transition(job.id, 'failed', { error: { code: 'recipient_lookup_failed', message: error.message, retryable: true }, recipientAttempts: attempts });
                } else {
                    const delay = 250 * (2 ** (attempts - 1));
                    await this.store.transition(job.id, 'queued', {
                        error: { code: 'recipient_lookup_failed', message: error.message, retryable: true },
                        recipientAttempts: attempts,
                        nextAttemptAt: this.now() + delay,
                    });
                    this.schedule(() => this.wake(), delay);
                }
                return false;
            }
            const sent = await this.transport.send(job, recipient);
            await this.store.transition(job.id, 'sent', sent?.id ? { whatsappMessageId: sent.id } : {});
        } catch (error) {
            if (isContextLoss(error)) {
                await this.store.transition(job.id, 'failed', { error: { code: 'send_context_lost', retryable: true } });
            } else {
                await this.store.transition(job.id, 'failed', { error: { code: 'send_failed', message: error.message, retryable: false } });
            }
        }
        return true;
    }

    depth() {
        return this.store.state.jobs.filter((job) => job.status === 'queued' || job.status === 'sending').length;
    }

    trackAcknowledgements(transport) {
        transport.onAck(async ({ whatsappMessageId, status }) => {
            const job = this.store.state.jobs.find((candidate) => candidate.whatsappMessageId === whatsappMessageId);
            if (!job || !['sent', 'delivered'].includes(job.status)) return;
            const rank = { sent: 1, delivered: 2, read: 3 };
            if ((rank[status] || 0) <= (rank[job.status] || 0)) return;
            await this.store.transition(job.id, status);
        });
    }

    async failQueued(code) {
        const jobs = this.store.state.jobs.filter((job) => job.status === 'queued');
        for (const job of jobs) {
            await this.store.transition(job.id, 'failed', { error: { code, retryable: false } });
        }
    }
}

module.exports = { MessageQueue, isContextLoss };
