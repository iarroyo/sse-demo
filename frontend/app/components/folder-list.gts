import Component from '@glimmer/component';
import { service } from '@ember/service';
import { LinkTo } from '@ember/routing';
import { eq, gt } from 'ember-truth-helpers';
import type LibraryService from 'sse-demo/services/library';
import type SessionService from 'sse-demo/services/session';
import type { Folder } from 'sse-demo/services/library';

export default class FolderList extends Component {
  @service declare library: LibraryService;
  @service declare session: SessionService;

  get folders() {
    return this.library.folders;
  }

  isOwner = (folder: Folder): boolean => {
    return folder.ownerId === this.session.currentUser?.id;
  };

  avatarClass = (id: string): string => `av-${this.library.avatarSlot(id)}`;

  <template>
    {{#if this.library.isLoadingFolders}}
      <div class="flex items-center justify-center py-20 text-slate-400">
        <svg class="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Loading folders…
      </div>

    {{else if (eq this.folders.length 0)}}
      <div class="flex flex-col items-center justify-center py-24 text-slate-400">
        <span class="text-6xl mb-4">📁</span>
        <p class="text-lg font-medium text-slate-500">No folders yet</p>
        <p class="text-sm mt-1">Create your first folder to get started.</p>
      </div>

    {{else}}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {{#each this.folders as |folder|}}
          <LinkTo
            @route="library.folder"
            @model={{folder.id}}
            class="card p-5 hover:shadow-md hover:border-indigo-100 transition-all duration-150 cursor-pointer block group"
          >
            {{!-- Header row --}}
            <div class="flex items-start justify-between mb-3">
              <span class="text-3xl leading-none">
                {{#if (this.isOwner folder)}}📂{{else}}📁{{/if}}
              </span>
              {{#if (this.isOwner folder)}}
                <span class="badge-own">Yours</span>
              {{else}}
                <span class="badge-shared">Shared</span>
              {{/if}}
            </div>

            {{!-- Folder name --}}
            <h3 class="font-semibold text-slate-900 group-hover:text-indigo-700 truncate mb-3 text-base leading-snug">
              {{folder.name}}
            </h3>

            {{!-- Members row --}}
            <div class="flex items-center gap-2 min-h-[1.75rem]">
              {{#if (this.isOwner folder)}}
                {{#if (gt folder.sharedWithUserIds.length 0)}}
                  <div class="flex -space-x-1.5">
                    {{#each folder.sharedWithUserIds as |uid|}}
                      <span
                        title={{this.library.getUserDisplayName uid}}
                        class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ring-2 ring-white shrink-0 {{this.avatarClass uid}}"
                      >
                        {{this.library.getUserInitials uid}}
                      </span>
                    {{/each}}
                  </div>
                  <span class="text-xs text-slate-400">
                    {{folder.sharedWithUserIds.length}}
                    {{#if (eq folder.sharedWithUserIds.length 1)}}member{{else}}members{{/if}}
                  </span>
                {{else}}
                  <span class="text-xs text-slate-400">Only you</span>
                {{/if}}
              {{else}}
                <span class="text-xs text-slate-500">
                  by {{this.library.getUserDisplayName folder.ownerId}}
                </span>
              {{/if}}
            </div>
          </LinkTo>
        {{/each}}
      </div>
    {{/if}}
  </template>
}
