import Component from '@glimmer/component';
import { service } from '@ember/service';
import { LinkTo } from '@ember/routing';
import RealtimeSseStatus from 'sse-demo/components/realtime-sse-status';
import type RealtimeSseService from 'sse-demo/services/realtime-sse';

class AboutPage extends Component {
  @service declare realtimeSse: RealtimeSseService;

  get activeTopics() {
    return this.realtimeSse.activeTopicCount;
  }

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

      {{!-- Active subscriptions --}}
      <div class="card p-5">
        <p class="text-sm font-semibold text-slate-700 mb-1">Active topic subscriptions on this page</p>
        <div class="flex items-center gap-3 mt-3">
          <span class="text-4xl font-bold {{if this.activeTopics 'text-amber-500' 'text-emerald-500'}}">
            {{this.activeTopics}}
          </span>
          <div>
            {{#if this.activeTopics}}
              <p class="text-sm font-medium text-amber-700">Topics still subscribed</p>
              <p class="text-xs text-slate-400">Destructors may not have run yet — wait a moment or check the console.</p>
            {{else}}
              <p class="text-sm font-medium text-emerald-700">No active subscriptions</p>
              <p class="text-xs text-slate-400">
                All library subscriptions were torn down when you left the Library route.
                Any SSE events fired by other users will <strong>not</strong> appear as notifications here.
              </p>
            {{/if}}
          </div>
        </div>
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
