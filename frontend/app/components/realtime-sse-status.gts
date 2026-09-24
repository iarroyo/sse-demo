import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RealtimeSseService from 'sse-demo/services/realtime-sse';

export default class RealtimeSseStatus extends Component {
  @service declare realtimeSse: RealtimeSseService;

  <template>
    <span class="inline-flex items-center gap-1.5 text-xs">
      {{#if this.realtimeSse.isConnected}}
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span class="text-slate-500">live</span>
      {{else if this.realtimeSse.isReconnecting}}
        <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"></span>
        <span class="text-slate-500">reconnecting…</span>
      {{else}}
        <span class="w-2 h-2 rounded-full bg-slate-300 inline-block"></span>
        <span class="text-slate-400">offline</span>
      {{/if}}
    </span>
  </template>
}
