import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from 'ember-truth-helpers';
import type { Document } from 'sse-demo/services/library';

interface DocumentListArgs {
  documents: Document[];
  currentUserId: string;
  onDelete: (id: string) => void;
}

export default class DocumentList extends Component<{ Args: DocumentListArgs }> {
  @action
  handleDelete(docId: string) {
    if (confirm('Delete this document?')) {
      this.args.onDelete(docId);
    }
  }

  formatDate(isoString: string) {
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  <template>
    {{#if (eq this.args.documents.length 0)}}
      <div class="card p-10 text-center text-slate-400">
        <p class="text-4xl mb-3">📄</p>
        <p class="font-medium text-slate-500">No documents yet</p>
        <p class="text-sm mt-1">Click "Add Document" to create one.</p>
      </div>
    {{else}}
      <div class="card divide-y divide-slate-100 overflow-hidden">
        {{#each this.args.documents as |doc|}}
          <div class="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors group">
            <span class="text-xl shrink-0">📄</span>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-slate-800 truncate text-sm">{{doc.name}}</p>
              <p class="text-xs text-slate-400 mt-0.5">{{this.formatDate doc.createdAt}}</p>
            </div>
            <button
              type="button"
              class="btn btn-danger btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
              {{on "click" (fn this.handleDelete doc.id)}}
            >
              Delete
            </button>
          </div>
        {{/each}}
      </div>
    {{/if}}
  </template>
}
