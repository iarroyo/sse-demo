import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from 'ember-truth-helpers';
import type NotificationsService from 'sse-demo/services/notifications';

export default class NotificationPanel extends Component {
  @service declare notifications: NotificationsService;

  @action dismiss(id: string) { this.notifications.dismiss(id); }

  <template>
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
      {{#each this.notifications.items as |notif|}}
        <div
          class="card pointer-events-auto animate-slide-in flex items-start gap-3 px-4 py-3 shadow-lg border-l-4
            {{if (eq notif.type 'success') 'border-emerald-500'}}
            {{if (eq notif.type 'warning') 'border-amber-400'}}
            {{if (eq notif.type 'info')    'border-sky-500'}}
            {{if (eq notif.type 'error')   'border-red-500'}}"
        >
          <span class="text-lg shrink-0 mt-0.5">
            {{if (eq notif.type 'success') '✅'}}
            {{if (eq notif.type 'warning') '⚠️'}}
            {{if (eq notif.type 'info')    'ℹ️'}}
            {{if (eq notif.type 'error')   '❌'}}
          </span>
          <p class="flex-1 text-sm text-slate-700 leading-snug">{{notif.message}}</p>
          <button
            type="button"
            class="text-slate-300 hover:text-slate-600 transition-colors text-lg leading-none shrink-0 mt-0.5"
            {{on "click" (fn this.dismiss notif.id)}}
          >×</button>
        </div>
      {{/each}}
    </div>
  </template>
}
