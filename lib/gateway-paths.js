const path = require('path');

function getGatewayPaths(environment = process.env) {
    const localAppData = environment.LOCALAPPDATA || path.join(__dirname, '..', '.local-data');
    const basePath = environment.WA_DATA_PATH || path.join(localAppData, 'DikasirPOS', 'whatsapp-service');

    return {
        sessionPath: environment.WA_SESSION_PATH || path.join(basePath, 'session'),
        statePath: environment.WA_STATE_PATH || path.join(basePath, 'state'),
    };
}

module.exports = { getGatewayPaths };
