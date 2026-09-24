import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import type SessionService from 'sse-demo/services/session';
import type RouterService from '@ember/routing/router-service';

export default class LoginForm extends Component {
  @service declare session: SessionService;
  @service declare router: RouterService;

  @tracked username = '';
  @tracked password = '';
  @tracked error = '';
  @tracked isLoading = false;

  @action updateUsername(e: Event) { this.username = (e.target as HTMLInputElement).value; }
  @action updatePassword(e: Event) { this.password = (e.target as HTMLInputElement).value; }

  @action
  async handleSubmit(e: Event) {
    e.preventDefault();
    this.error = '';
    this.isLoading = true;
    try {
      await this.session.login(this.username, this.password);
      this.router.transitionTo('library');
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.isLoading = false;
    }
  }

  <template>
    <div class="w-full max-w-sm">
      {{!-- Hero --}}
      <div class="text-center mb-8">
        <div class="text-5xl mb-3">📚</div>
        <h1 class="text-2xl font-bold text-slate-900">Library SSE Demo</h1>
        <p class="text-sm text-slate-500 mt-1">Real-time collaboration via Server-Sent Events</p>
      </div>

      {{!-- Card --}}
      <div class="card p-7">
        <h2 class="text-lg font-semibold text-slate-800 mb-5">Sign in</h2>

        <form {{on "submit" this.handleSubmit}} class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Username</label>
            <input
              class="input"
              type="text"
              value={{this.username}}
              {{on "input" this.updateUsername}}
              placeholder="alice, bob, or charlie"
              autocomplete="username"
              autofocus
            />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Password</label>
            <input
              class="input"
              type="password"
              value={{this.password}}
              {{on "input" this.updatePassword}}
              placeholder="same as username"
              autocomplete="current-password"
            />
          </div>

          {{#if this.error}}
            <p class="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{{this.error}}</p>
          {{/if}}

          <button type="submit" class="btn btn-primary w-full justify-center mt-2" disabled={{this.isLoading}}>
            {{if this.isLoading "Signing in…" "Sign In"}}
          </button>
        </form>

        <div class="mt-5 pt-4 border-t border-slate-100">
          <p class="text-xs text-slate-400 text-center mb-2">Demo users — password = username</p>
          <div class="flex justify-center gap-2">
            {{#each (array "alice" "bob" "charlie") as |u|}}
              <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-mono">{{u}}</span>
            {{/each}}
          </div>
        </div>
      </div>
    </div>
  </template>
}
