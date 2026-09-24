import Component from '@glimmer/component';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import type SessionService from 'sse-demo/services/session';
import type LibraryService from 'sse-demo/services/library';
import type NotificationsService from 'sse-demo/services/notifications';
import type RealtimeSseService from 'sse-demo/services/realtime-sse';
import FolderList from 'sse-demo/components/folder-list';
import CreateFolderModal from 'sse-demo/components/create-folder-modal';

class LibraryIndexPage extends Component {
  @service declare session: SessionService;
  @service declare library: LibraryService;
  @service declare notifications: NotificationsService;
  @service declare realtimeSse: RealtimeSseService;

  @tracked showCreateFolder = false;

  constructor(owner: unknown, args: object) {
    super(owner, args);
    this.subscribeToNotifications();
  }

  subscribeToNotifications() {
    const userId = this.session.currentUser?.id;
    if (!userId) return;

    const topic = `user:${userId}:notifications`;
    const unsub = this.realtimeSse.subscribe(topic, (payload) => {
      const data = payload as Record<string, string>;
      if (data.type === 'FOLDER_SHARED') {
        this.notifications.push('info', `📂 "${data.folderName}" was shared with you by ${data.sharedByUsername}`);
        void this.library.fetchFolders();
      } else if (data.type === 'DOCUMENT_CREATED_NOTIFICATION') {
        this.notifications.push('info', `📄 "${data.documentName}" was added to "${data.folderName}" by ${data.createdByUsername}`);
        void this.library.fetchFolders();
      }
    });

    registerDestructor(this, unsub);
  }

  @action openCreateFolder() { this.showCreateFolder = true; }
  @action closeCreateFolder() { this.showCreateFolder = false; }

  get folderCount() {
    return this.library.folders.length;
  }

  <template>
    <div>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">My Library</h1>
          {{#if this.library.folders.length}}
            <p class="text-sm text-slate-500 mt-0.5">{{this.library.folders.length}} folder(s)</p>
          {{/if}}
        </div>
        <button type="button" class="btn btn-primary" {{on "click" this.openCreateFolder}}>
          <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
          </svg>
          New Folder
        </button>
      </div>

      <FolderList />

      {{#if this.showCreateFolder}}
        <CreateFolderModal @onClose={{this.closeCreateFolder}} />
      {{/if}}
    </div>
  </template>
}

export default LibraryIndexPage;
