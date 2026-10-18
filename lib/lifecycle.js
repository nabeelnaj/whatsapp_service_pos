function createShutdown({ queue, transport, closeServer = async () => {} }) {
    let stopping = false;
    return async function shutdown() {
        if (stopping) return;
        stopping = true;
        queue.stop();
        await transport.stop();
        await closeServer();
    };
}

module.exports = { createShutdown };
