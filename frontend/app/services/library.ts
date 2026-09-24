import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

export interface Folder {
  id: string;
  name: string;
  ownerId: string;
  sharedWithUserIds: string[];
}

export interface Document {
  id: string;
  name: string;
  folderId: string;
  createdByUserId: string;
  createdAt: string;
}

export interface OtherUser {
  id: string;
  username: string;
  displayName: string;
}

export default class LibraryService extends Service {
  @tracked folders: Folder[] = [];
  @tracked isLoadingFolders = false;
  @tracked allOtherUsers: OtherUser[] = [];

  // ── User helpers ──────────────────────────────────────────
  getUserDisplayName = (id: string): string => {
    return (this.allOtherUsers ?? []).find((u) => u.id === id)?.displayName ?? '?';
  };

  getUserInitials = (id: string): string => {
    const name = (this.allOtherUsers ?? []).find((u) => u.id === id)?.displayName ?? id;
    return name
      .split(' ')
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  /** Returns a deterministic avatar slot 0-5 for a user ID. */
  avatarSlot = (id: string): number => {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return h % 6;
  };

  // ── Folders ───────────────────────────────────────────────
  async fetchFolders(): Promise<void> {
    this.isLoadingFolders = true;
    try {
      const tasks: Promise<void>[] = [
        fetch('/api/library/folders', { credentials: 'include' })
          .then((r) => r.json())
          .then((data: Folder[]) => { this.folders = data; }),
      ];
      if ((this.allOtherUsers ?? []).length === 0) {
        tasks.push(
          this.fetchOtherUsers().then((users) => { this.allOtherUsers = users; })
        );
      }
      await Promise.all(tasks);
    } finally {
      this.isLoadingFolders = false;
    }
  }

  async createFolder(name: string): Promise<Folder> {
    const res = await fetch('/api/library/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to create folder');
    const folder: Folder = await res.json();
    this.folders = [...this.folders, folder];
    return folder;
  }

  async shareFolder(folderId: string, targetUserId: string): Promise<void> {
    const res = await fetch(`/api/library/folders/${folderId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: targetUserId }),
    });
    if (!res.ok) throw new Error('Failed to share folder');
    const updated: Folder = await res.json();
    this.folders = this.folders.map((f) => (f.id === folderId ? updated : f));
  }

  // ── Documents ─────────────────────────────────────────────
  async fetchDocuments(folderId: string): Promise<Document[]> {
    const res = await fetch(`/api/library/folders/${folderId}/documents`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
  }

  async createDocument(folderId: string, name: string): Promise<Document> {
    const res = await fetch(`/api/library/folders/${folderId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to create document');
    return res.json();
  }

  async deleteDocument(documentId: string): Promise<void> {
    const res = await fetch(`/api/library/documents/${documentId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Failed to delete document');
  }

  async fetchOtherUsers(): Promise<OtherUser[]> {
    const res = await fetch('/api/library/users', { credentials: 'include' });
    if (!res.ok) return [];
    return res.json();
  }
}

declare module '@ember/service' {
  interface Registry {
    library: LibraryService;
  }
}
