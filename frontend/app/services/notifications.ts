import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';

export interface Notification {
  id: string;
  type: string;
  message: string;
  timestamp: number;
}

let notifCounter = 0;

export default class NotificationsService extends Service {
  @tracked items = new TrackedArray<Notification>([]);

  push(type: string, message: string) {
    const id = `notif-${++notifCounter}`;
    this.items.push({ id, type, message, timestamp: Date.now() });

    // Auto-dismiss after 6 seconds
    setTimeout(() => this.dismiss(id), 6000);
  }

  dismiss(id: string) {
    const idx = this.items.findIndex((n) => n.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    notifications: NotificationsService;
  }
}
