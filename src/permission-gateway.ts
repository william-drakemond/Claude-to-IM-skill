export interface PermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
}

export interface PermissionResolution {
  behavior: 'allow' | 'deny';
  message?: string;
}

export class PendingPermissions {
  private pending = new Map<string, {
    resolve: (r: PermissionResult) => void;
    timer: NodeJS.Timeout;
  }>();
  private timeoutMs = 5 * 60 * 1000; // 5 minutes

  waitFor(toolUseID: string, abortSignal?: AbortSignal): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const cleanup = () => {
        this.pending.delete(toolUseID);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }, this.timeoutMs);

      // If the task is aborted (e.g., /stop command), resolve immediately
      // with deny so the SDK can exit the canUseTool callback without
      // waiting for the 5-minute timeout. This prevents the session lock
      // from being held while queued messages pile up.
      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timer);
          cleanup();
          resolve({ behavior: 'deny', message: 'Task stopped by user' });
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          cleanup();
          resolve({ behavior: 'deny', message: 'Task stopped by user' });
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(toolUseID, { resolve, timer });
    });
  }

  resolve(permissionRequestId: string, resolution: PermissionResolution): boolean {
    const entry = this.pending.get(permissionRequestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    if (resolution.behavior === 'allow') {
      entry.resolve({ behavior: 'allow' });
    } else {
      entry.resolve({ behavior: 'deny', message: resolution.message || 'Denied by user' });
    }
    this.pending.delete(permissionRequestId);
    return true;
  }

  denyAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ behavior: 'deny', message: 'Bridge shutting down' });
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
