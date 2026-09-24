'use strict';

module.exports = function (environment) {
  let ENV = {
    modulePrefix: 'sse-demo',
    podModulePrefix: 'sse-demo/pods',
    environment,
    rootURL: '/',
    locationType: 'history',
    EmberENV: {
      FEATURES: {},
      EXTEND_PROTOTYPES: false,
    },
    APP: {},
  };

  if (environment === 'development') {
    // development-specific config
  }

  if (environment === 'test') {
    ENV.locationType = 'none';
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;
    ENV.APP.rootElement = '#ember-testing';
    ENV.APP.autoboot = false;
  }

  if (environment === 'production') {
    // production-specific config
  }

  return ENV;
};
