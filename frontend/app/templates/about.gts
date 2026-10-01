import Component from '@glimmer/component';
import { LinkTo } from '@ember/routing';
import RealtimeSseStatus from 'sse-demo/components/realtime-sse-status';

class AboutPage extends Component {
  <template>
    <div class="max-w-2xl mx-auto space-y-6">

      {{!-- Header --}}
      <div>
        <h1 class="text-2xl font-bold text-slate-900">About — SSE Subscription Scope Test</h1>
        <p class="text-sm text-slate-500 mt-1">
          Use this page to verify that navigating away from the Library tears down all SSE subscriptions.
        </p>
      </div>

      {{!-- Live status card --}}
      <div class="card p-5 flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-slate-700">SSE Connection</p>
          <p class="text-xs text-slate-400 mt-0.5">SharedWorker connection is tab-wide — it stays alive</p>
        </div>
        <RealtimeSseStatus />
      </div>

      {{!-- Instructions --}}
      <div class="card p-5 space-y-3">
        <p class="text-sm font-semibold text-slate-700">How to test</p>
        <ol class="text-sm text-slate-600 space-y-2 list-decimal list-inside">
          <li>Open a second browser tab and log in as a different user.</li>
          <li>On the second tab, open a shared folder and add or delete a document.</li>
          <li>Come back to this tab — <strong>no toast notification should appear</strong>.</li>
          <li>Navigate back to Library and repeat — toasts should appear again.</li>
        </ol>
      </div>

      {{!-- Back link --}}
      <div>
        <LinkTo @route="library" class="btn btn-primary">
          ← Back to Library
        </LinkTo>
      </div>

    </div>
  </template>
}

export default AboutPage;
