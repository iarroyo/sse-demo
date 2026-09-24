import Component from '@glimmer/component';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { gt } from 'ember-truth-helpers';
import type SessionService from 'sse-demo/services/session';
import type LibraryService from 'sse-demo/services/library';
import type NotificationsService from 'sse-demo/services/notifications';
import type RealtimeSseService from 'sse-demo/services/realtime-sse';
import type { Document, Folder } from 'sse-demo/services/library';
import DocumentList from 'sse-demo/components/document-list';
import ShareFolderModal from 'sse-demo/components/share-folder-modal';
import CreateDocumentModal from 'sse-demo/components/create-document-modal';
import { LinkTo } from '@ember/routing';

interface FolderPageArgs {
  model: { folder: Folder | undefined; documents: Document[]; folderId: string };
}

class FolderPage extends Component<{ Args: FolderPageArgs }> {
  @service declare session: SessionService;
  @service declare library: LibraryService;
  @service declare notifications: NotificationsService;
  @service declare realtimeSse: RealtimeSseService;

  @tracked documents: Document[] = this.args.model.documents;
  @tracked showShareModal = false;
  @tracked showCreateDoc = false;

  get folder() { return this.args.model.folder; }
  get folderId() { return this.args.model.folderId; }

  get isOwner() {
    return this.folder?.ownerId === this.session.currentUser?.id;
  }

  get ownerName() {
    const ownerId = this.folder?.ownerId;
    if (!ownerId) return '';
    if (ownerId === this.session.currentUser?.id) return this.session.currentUser.displayName + ' (you)';
    return this.library.getUserDisplayName(ownerId);
  }

  avatarClass = (id: string): string => `av-${this.library.avatarSlot(id)}`;

  constructor(owner: unknown, args: FolderPageArgs) {
    super(owner, args);
    this.subscribeToFolderEvents();
    this.subscribeToUserNotifications();
  }

  subscribeToFolderEvents() {
    const topic = `folder:${this.folderId}`;

    const unsubDocs = this.realtimeSse.subscribe(topic, (payload) => {
      const data = payload as Record<string, string>;
      if (data.type === 'DOCUMENT_CREATED') {
        void this.library.fetchDocuments(this.folderId).then((docs) => { this.documents = docs; });
      } else if (data.type === 'DOCUMENT_DELETED') {
        this.documents = this.documents.filter((d) => d.id !== data.documentId);
      }
    });

    const unsubToast = this.realtimeSse.subscribe(topic, (payload) => {
      const data = payload as Record<string, string>;
      if (data.type === 'DOCUMENT_CREATED') {
        this.notifications.push('success', `"${data.documentName}" was added by ${data.createdByUsername}`);
      } else if (data.type === 'DOCUMENT_DELETED') {
        this.notifications.push('warning', `"${data.documentName}" was removed by ${data.deletedByUsername}`);
      }
    });

    registerDestructor(this, unsubDocs);
    registerDestructor(this, unsubToast);
  }

  subscribeToUserNotifications() {
    const userId = this.session.currentUser?.id;
    if (!userId) return;
    const topic = `user:${userId}:notifications`;
    const unsub = this.realtimeSse.subscribe(topic, (payload) => {
      const data = payload as Record<string, string>;
      if (data.type === 'FOLDER_SHARED') {
        this.notifications.push('info', `Folder shared: ${data.folderName}`);
      }
    });
    registerDestructor(this, unsub);
  }

  @action async addDocument(name: string) {
    const doc = await this.library.createDocument(this.folderId, name);
    this.documents = [doc, ...this.documents];
    this.showCreateDoc = false;
  }

  @action async deleteDocument(documentId: string) {
    await this.library.deleteDocument(documentId);
    this.documents = this.documents.filter((d) => d.id !== documentId);
  }

  @action openShareModal() { this.showShareModal = true; }
  @action closeShareModal() { this.showShareModal = false; }
  @action openCreateDoc() { this.showCreateDoc = true; }
  @action closeCreateDoc() { this.showCreateDoc = false; }

  <template>
    <div>
      {{!-- Back link --}}
      <LinkTo @route="library" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 transition-colors mb-5 group">
        <svg class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        Back to Library
      </LinkTo>

      {{!-- Folder header card --}}
      <div class="card p-5 mb-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <span class="text-3xl leading-none shrink-0">📂</span>
            <div class="min-w-0">
              <h1 class="text-xl font-bold text-slate-900 truncate">
                {{if this.folder this.folder.name "Loading…"}}
              </h1>
              {{#if this.isOwner}}
                <span class="badge-own mt-0.5">Owner</span>
              {{else}}
                <span class="badge-shared mt-0.5">Shared with you</span>
              {{/if}}
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            {{#if this.isOwner}}
              <button type="button" class="btn btn-secondary btn-sm" {{on "click" this.openShareModal}}>
                <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"/>
                </svg>
                Share
              </button>
            {{/if}}
            <button type="button" class="btn btn-primary btn-sm" {{on "click" this.openCreateDoc}}>
              <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
              </svg>
              Add Document
            </button>
          </div>
        </div>

        {{!-- Members row --}}
        {{#if this.folder}}
          <div class="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 flex-wrap">
            <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">Members</span>

            {{!-- Owner avatar --}}
            <div class="flex items-center gap-1.5">
              <span
                class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ring-2 ring-white {{this.avatarClass this.folder.ownerId}}"
                title={{this.ownerName}}
              >
                {{this.library.getUserInitials this.folder.ownerId}}
              </span>
              <span class="text-xs text-slate-600">{{this.ownerName}}</span>
            </div>

            {{!-- Shared user avatars --}}
            {{#if (gt this.folder.sharedWithUserIds.length 0)}}
              <span class="text-slate-300 mx-0.5">·</span>
              {{#each this.folder.sharedWithUserIds as |uid|}}
                <div class="flex items-center gap-1.5">
                  <span
                    class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ring-2 ring-white {{this.avatarClass uid}}"
                    title={{this.library.getUserDisplayName uid}}
                  >
                    {{this.library.getUserInitials uid}}
                  </span>
                  <span class="text-xs text-slate-600">{{this.library.getUserDisplayName uid}}</span>
                </div>
              {{/each}}
            {{/if}}
          </div>
        {{/if}}
      </div>

      {{!-- Documents --}}
      <DocumentList
        @documents={{this.documents}}
        @currentUserId={{this.session.currentUser.id}}
        @onDelete={{this.deleteDocument}}
      />

      {{#if this.showShareModal}}
        <ShareFolderModal @folderId={{this.folderId}} @onClose={{this.closeShareModal}} />
      {{/if}}
      {{#if this.showCreateDoc}}
        <CreateDocumentModal @onAdd={{this.addDocument}} @onClose={{this.closeCreateDoc}} />
      {{/if}}
    </div>
  </template>
}

export default FolderPage;
