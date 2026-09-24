import { service } from '@ember/service';
import Component from '@glimmer/component';
import { action } from '@ember/object';
import { LinkTo } from '@ember/routing';
import { on } from '@ember/modifier';
import type SessionService from 'sse-demo/services/session';
import NotificationPanel from 'sse-demo/components/notification-panel';
import RealtimeSseStatus from 'sse-demo/components/realtime-sse-status';

class ApplicationLayout extends Component {
  @service declare session: SessionService;

  @action
  async handleLogout() {
    await this.session.logout();
    window.location.href = '/';
  }

  <template>
    <div class="min-h-screen bg-slate-50">
      {{#if this.session.isAuthenticated}}
        <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <LinkTo @route="library" class="flex items-center gap-2 font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                <span class="text-xl">📚</span>
                <span class="text-base">Library</span>
              </LinkTo>
              <LinkTo @route="about" class="text-sm text-slate-500 hover:text-slate-800 transition-colors">
                About
              </LinkTo>
              <RealtimeSseStatus />
            </div>

            <div class="flex items-center gap-3">
              <span class="text-sm text-slate-600 hidden sm:block">
                {{this.session.currentUser.displayName}}
              </span>
              <button type="button" class="btn btn-secondary btn-sm" {{on "click" this.handleLogout}}>
                Log out
              </button>
            </div>
          </div>
        </header>
      {{/if}}

      <NotificationPanel />

      <main class="max-w-5xl mx-auto px-4 py-8">
        {{outlet}}
      </main>
    </div>
  </template>
}

export default ApplicationLayout;
