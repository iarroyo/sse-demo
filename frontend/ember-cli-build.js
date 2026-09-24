'use strict';

// CJS wrapper — ember-cli resolves .js before .mjs, so this file is used.
// @embroider/compat and @embroider/vite are pure-ESM; load them with dynamic import().
const EmberApp = require('ember-cli/lib/broccoli/ember-app');

module.exports = async function (defaults) {
  const { compatBuild } = await import('@embroider/compat');
  const { buildOnce } = await import('@embroider/vite');

  const app = new EmberApp(defaults, {});
  return compatBuild(app, buildOnce);
};
