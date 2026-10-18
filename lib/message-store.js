const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ApiError } = require('./api-error');

class MessageStore {
    constructor({ stateDir, now = Date.now, retentionMs = 24 * 60 * 60 * 1000, maxQueueSize = 1_000 }) {
        this.stateDir = stateDir;
        this.filePath = path.join(stateDir, 'messages.json');
        this.now = now;
        this.retentionMs = retentionMs;
        this.maxQueueSize = maxQueueSize;
        this.state = { jobs: [], idempotency: {} };
    }

    async load() {
        await fs.promises.mkdir(this.stateDir, { recursive: true });
        try {
            this.state = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        this.state.jobs = Array.isArray(this.state.jobs) ? this.state.jobs : [];
        this.state.idempotency = this.state.idempotency || {};
        for (const job of this.state.jobs) {
            if (job.status === 'sending') {
                job.status = 'failed';
                job.error = { code: 'send_interrupted', retryable: true };
                job.updatedAt = this.now();
            }
        }
        await this.prune();
        await this.persist();
    }

    async persist() {
        const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await fs.promises.writeFile(temporaryPath, JSON.stringify(this.state), 'utf8');
        await fs.promises.rename(temporaryPath, this.filePath);
    }

    get(id) {
        return this.state.jobs.find((job) => job.id === id) || null;
    }

    async create({ idempotencyKey, fingerprint, message, requestId }) {
        const existing = this.state.idempotency[idempotencyKey];
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                throw new ApiError(409, 'idempotency_conflict', 'Idempotency-Key was already used with a different message.');
            }
            return { ...this.get(existing.id), replayed: true };
        }
        const activeJobs = this.state.jobs.filter((job) => job.status === 'queued' || job.status === 'sending');
        if (activeJobs.length >= this.maxQueueSize) {
            throw new ApiError(429, 'queue_full', 'The WhatsApp message queue is full.', true);
        }
        const createdAt = this.now();
        const job = {
            id: `wamid.local.${crypto.randomUUID()}`,
            requestId,
            message,
            status: 'queued',
            createdAt,
            updatedAt: createdAt,
        };
        this.state.jobs.push(job);
        this.state.idempotency[idempotencyKey] = { id: job.id, fingerprint, createdAt };
        await this.persist();
        return { ...job, replayed: false };
    }

    async transition(id, status, patch = {}) {
        const job = this.get(id);
        if (!job) throw new ApiError(404, 'message_not_found', 'Message was not found.');
        Object.assign(job, patch, { status, updatedAt: this.now() });
        await this.persist();
        return job;
    }

    nextQueued(now = this.now()) {
        return this.state.jobs.find((job) => job.status === 'queued' && (!job.nextAttemptAt || job.nextAttemptAt <= now)) || null;
    }

    async prune() {
        const cutoff = this.now() - this.retentionMs;
        const retainedIds = new Set();
        this.state.jobs = this.state.jobs.filter((job) => {
            const terminal = job.status === 'sent' || job.status === 'delivered' || job.status === 'read' || job.status === 'failed';
            const keep = !terminal || job.updatedAt >= cutoff || job.createdAt >= cutoff;
            if (keep) retainedIds.add(job.id);
            return keep;
        });
        for (const [key, value] of Object.entries(this.state.idempotency)) {
            if (!retainedIds.has(value.id) || value.createdAt < cutoff) delete this.state.idempotency[key];
        }
    }
}

module.exports = { MessageStore };
