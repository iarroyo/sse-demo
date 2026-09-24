import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

interface CreateDocumentModalArgs {
  onAdd: (name: string) => void;
  onClose: () => void;
}

export default class CreateDocumentModal extends Component<{ Args: CreateDocumentModalArgs }> {
  @tracked name = '';
  @tracked isSaving = false;

  @action updateName(e: Event) { this.name = (e.target as HTMLInputElement).value; }

  @action
  async handleSubmit(e: Event) {
    e.preventDefault();
    if (!this.name.trim()) return;
    this.isSaving = true;
    try {
      await this.args.onAdd(this.name.trim());
    } finally {
      this.isSaving = false;
    }
  }

  <template>
    <div class="modal-backdrop">
      <div class="modal-panel">
        <div class="flex justify-between items-center mb-5">
          <h2 class="text-lg font-semibold text-slate-900">Add Document</h2>
          <button type="button" class="btn btn-ghost btn-sm p-1 rounded-lg" {{on "click" this.args.onClose}}>
            <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
        <form {{on "submit" this.handleSubmit}} class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Document Name</label>
            <input
              class="input"
              type="text"
              value={{this.name}}
              {{on "input" this.updateName}}
              placeholder="e.g. Q1 Report.pdf"
              autofocus
            />
          </div>
          <div class="flex gap-2 justify-end pt-1">
            <button type="button" class="btn btn-secondary" {{on "click" this.args.onClose}}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={{this.isSaving}}>
              {{if this.isSaving "Adding…" "Add Document"}}
            </button>
          </div>
        </form>
      </div>
    </div>
  </template>
}
