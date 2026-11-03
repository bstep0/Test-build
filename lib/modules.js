'use strict';
// Feature modules registered by the server. Each exports register(ctx). Order matters only for shared helpers:
// photos must come before portal (portal serves photos), notify before anything that sends messages.
module.exports = [require('./payments'), require('./quotes'), require('./inventory'), require('./exports'), require('./notify'), require('./photos'), require('./portal'), require('./scheduling'), require('./reports')];
