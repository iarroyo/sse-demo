import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import type RealtimeSseService from './realtime-sse';

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
}

export default class SessionService extends Service {
  @service declare realtimeSse: RealtimeSseService;

  @tracked currentUser: CurrentUser | null = null;
  @tracked isLoading = false;

  get isAuthenticated() {
    return this.currentUser !== null;
  }

  async fetchCurrentUser(): Promise<boolean> {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        this.currentUser = await res.json();
        return true;
      }
      this.currentUser = null;
      return false;
    } catch {
      this.currentUser = null;
      return false;
    }
  }

  async login(username: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username, password });
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? 'Login failed');
    }

    this.currentUser = await res.json();
    // Re-establish SSE connection under the new session
    this.realtimeSse.reconnect();
  }

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    this.currentUser = null;
  }
}

declare module '@ember/service' {
  interface Registry {
    session: SessionService;
  }
}
