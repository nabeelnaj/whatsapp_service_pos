const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WhatsAppClient } = require('../lib/whatsapp-client');

function fakeDependencies() {
    const client = new EventEmitter();
    client.initialize = async () => {};
    client.destroy = async () => {};
    client.getState = async () => 'CONNECTED';
    client.getNumberId = async () => ({ _serialized: '94777448223@c.us' });
    client.sendMessage = async () => ({ id: { _serialized: 'true-message-id' } });
    return {
        client,
        dependencies: {
            ClientClass: class { constructor() { return client; } },
            LocalAuthClass: class {},
            MessageMediaClass: class {
                constructor(mimetype, data, filename) { Object.assign(this, { mimetype, data, filename }); }
            },
        },
    };
}

test('reports ready only after the ready event and CONNECTED page state', async () => {
    const { client, dependencies } = fakeDependencies();
    const gateway = new WhatsAppClient(dependencies);
    await gateway.start();
    assert.equal(await gateway.isReady(), false);
    client.emit('ready');
    assert.equal(await gateway.isReady(), true);
});

test('exposes the linked phone in the session state', async () => {
    const { client, dependencies } = fakeDependencies();
    client.info = { wid: { user: '94770000000' } };
    const gateway = new WhatsAppClient(dependencies);
    await gateway.start();
    client.emit('ready');
    assert.equal(gateway.session().phone, '94770000000');
});

test('uses a cached resolved recipient before calling getNumberId again', async () => {
    const client = new EventEmitter();
    client.initialize = async () => {};
    client.getState = async () => 'CONNECTED';
    let calls = 0;
    client.getNumberId = async () => { calls += 1; return { _serialized: '94777448223@c.us' }; };
    const gateway = new WhatsAppClient({ ClientClass: class { constructor() { return client; } }, LocalAuthClass: class {} });
    await gateway.start();
    client.emit('ready');
    await gateway.resolveRecipient('94777448223');
    await gateway.resolveRecipient('94777448223');
    assert.equal(calls, 1);
});

test('sends a document through the client and exposes its WhatsApp message id', async () => {
    const { client, dependencies } = fakeDependencies();
    const gateway = new WhatsAppClient(dependencies);
    await gateway.start();
    const result = await gateway.send({
        message: { type: 'document', content: { data: 'cGRm', mime_type: 'application/pdf', filename: 'invoice.pdf', caption: 'Invoice' } },
    }, '94777448223@c.us');

    assert.equal(result.id, 'true-message-id');
    assert.equal(client.listenerCount('message_ack'), 1);
});

test('maps WhatsApp acknowledgement events to delivery statuses', async () => {
    const { client, dependencies } = fakeDependencies();
    const gateway = new WhatsAppClient(dependencies);
    const acknowledgements = [];
    gateway.onAck((ack) => acknowledgements.push(ack));
    await gateway.start();
    client.emit('message_ack', { id: { _serialized: 'true-message-id' } }, 3);

    assert.deepEqual(acknowledgements, [{ whatsappMessageId: 'true-message-id', status: 'read' }]);
});
