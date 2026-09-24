import LoginForm from 'sse-demo/components/login-form';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import type SessionService from 'sse-demo/services/session';
import { LinkTo } from '@ember/routing';

class IndexPage extends Component {
  @service declare session: SessionService;

  <template>
    <div class="flex items-center justify-center min-h-[70vh]">
      {{#if this.session.isAuthenticated}}
        <div class="card p-8 text-center max-w-sm w-full">
          <span class="text-4xl">👋</span>
          <p class="mt-3 mb-5 text-slate-600">
            Welcome back, <strong class="text-slate-900">{{this.session.currentUser.displayName}}</strong>!
          </p>
          <LinkTo @route="library" class="btn btn-primary w-full justify-center">
            Go to Library
          </LinkTo>
        </div>
      {{else}}
        <LoginForm />
      {{/if}}
    </div>
  </template>
}

export default IndexPage;
