const { getGatewayPaths } = require('./lib/gateway-paths');

function getSessionPath(environment = process.env) {
    return getGatewayPaths(environment).sessionPath;
}

module.exports = { getSessionPath };
