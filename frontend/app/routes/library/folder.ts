import Route from '@ember/routing/route';
import { service } from '@ember/service';
import type SessionService from '../../services/session';
import type LibraryService from '../../services/library';
import type RouterService from '@ember/routing/router-service';
import type { Folder, Document } from '../../services/library';

export default class LibraryFolderRoute extends Route {
  @service declare session: SessionService;
  @service declare library: LibraryService;
  @service declare router: RouterService;

  async beforeModel() {
    if (!this.session.isAuthenticated) {
      this.router.transitionTo('index');
    }
  }

  async model(params: { folder_id: string }) {
    const folders = this.library.folders;
    const folder = folders.find((f) => f.id === params.folder_id);
    const documents = await this.library.fetchDocuments(params.folder_id);
    return { folder, documents, folderId: params.folder_id };
  }
}
