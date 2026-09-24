import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type SessionService from '../services/session';
import type LibraryService from '../services/library';
import type RouterService from '@ember/routing/router-service';

export default class LibraryRoute extends Route {
  @service declare session: SessionService;
  @service declare library: LibraryService;
  @service declare router: RouterService;

  async beforeModel() {
    if (!this.session.isAuthenticated) {
      this.router.transitionTo('index');
    }
  }

  async model() {
    await this.library.fetchFolders();
  }
}
