import { registerDeprecationHandler } from '@ember/debug';

registerDeprecationHandler((message, options, next) => {
  next(message, options);
});
