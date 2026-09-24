import EmberRouter from '@embroider/router';
import config from 'sse-demo/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('library', function () {
    this.route('folder', { path: '/:folder_id' });
  });
  this.route('about');
});
