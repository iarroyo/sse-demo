import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { service } from '@ember/service';
import { eq } from 'ember-truth-helpers';
import type LibraryService from 'sse-demo/services/library';
import type NotificationsService from 'sse-demo/services/notifications';
import type { OtherUser } from 'sse-demo/services/library';

interface ShareFolderModalArgs {
  folderId: string;
  onClose: () => void;
}

export default class ShareFolderModal extends Component<{ Args: ShareFolderModalArgs }> {
  @service declare library: LibraryService;
  @service declare notifications: NotificationsService;

  @tracked users: OtherUser[] = [];
  @tracked isLoading = false;
  @tracked isSaving = false;

  constructor(owner: unknown, args: ShareFolderModalArgs) {
    super(owner, args);
    void this.loadUsers();
  }

  get folder() {
    return this.library.folders.find((f) => f.id === this.args.folderId);
  }

  async loadUsers() {
    this.isLoading = true;
    try {
      this.users = await this.library.fetchOtherUsers();
    } finally {
      this.isLoading = false;
    }
  }

  get availableUsers() {
    const alreadyShared = new Set(this.folder?.sharedWithUserIds ?? []);
    return this.users.filter((u) => !alreadyShared.has(u.id));
  }

  @action
  async shareWith(userId: string) {
    this.isSaving = true;
    try {
      await this.library.shareFolder(this.args.folderId, userId);
      this.notifications.push('success', 'Folder shared successfully!');
      this.args.onClose();
    } catch (err) {
      this.notifications.push('error', `Failed: ${(err as Error).message}`);
    } finally {
      this.isSaving = false;
    }
  }

  avatarClass = (id: string): string => `av-${this.library.avatarSlot(id)}`;

  <template>
    <div class="modal-backdrop">
      <div class="modal-panel">
        <div class="flex justify-between items-center mb-5">
          <h2 class="text-lg font-semibold text-slate-900">Share Folder</h2>
          <button type="button" class="btn btn-ghost btn-sm p-1 rounded-lg" {{on "click" this.args.onClose}}>
            <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>

        {{#if this.isLoading}}
          <p class="text-slate-400 text-sm py-4 text-center">Loading users…</p>
        {{else if (eq this.availableUsers.length 0)}}
          <p class="text-slate-400 text-sm py-4 text-center">All users already have access.</p>
        {{else}}
          <ul class="space-y-2">
            {{#each this.availableUsers as |user|}}
              <li class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                <span
                  class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 {{this.avatarClass user.id}}"
                >
                  {{this.library.getUserInitials user.id}}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-slate-800 text-sm">{{user.displayName}}</p>
                  <p class="text-xs text-slate-400">{{user.username}}</p>
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-sm shrink-0"
                  disabled={{this.isSaving}}
                  {{on "click" (fn this.shareWith user.id)}}
                >
                  Share
                </button>
              </li>
            {{/each}}
          </ul>
        {{/if}}
      </div>
    </div>
  </template>
}
