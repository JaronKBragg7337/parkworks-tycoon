/**
 * Where a park is kept.
 *
 * The game never imports Supabase, never holds a key, and never knows whether
 * it is running on its own or inside Heartbeat Observatory. It asks the page for
 * a place to put saves. Heartbeat Observatory's shell can supply a cloud-backed
 * store tied to the player's Heartbeat identity; on the standalone build nobody
 * answers and the park is kept in this browser. Same code, both homes.
 */

export interface SaveBackend {
  /** Stable id for telemetry and UI copy. */
  readonly name: string;
  /** Short player-facing description, e.g. "this device" or "your Heartbeat account". */
  readonly label: string;
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  clear(): Promise<void>;
}

/** The hook a host page implements to take over park storage. */
export interface SaveBackendHost {
  createSaveBackend?: (gameId: string) => SaveBackend | null | undefined;
}

export const PARKWORKS_GAME_ID = 'parkworks-tycoon';
const LOCAL_STORAGE_KEY = 'parkworks-tycoon.save.v1';

/** Keeps the park in this browser. Survives refresh and closing the tab. */
export class LocalSaveBackend implements SaveBackend {
  readonly name = 'local';
  readonly label = 'this device';

  static isAvailable(): boolean {
    try {
      const probe = '__parkworks_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<string | null> {
    try {
      return window.localStorage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  async save(text: string): Promise<void> {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, text);
  }

  async clear(): Promise<void> {
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }
}

/**
 * Last resort for private browsing modes that refuse storage. The park still
 * plays; it just will not outlive the tab, and the UI says so.
 */
export class MemorySaveBackend implements SaveBackend {
  readonly name = 'memory';
  readonly label = 'this session only';
  private held: string | null = null;

  async load(): Promise<string | null> {
    return this.held;
  }

  async save(text: string): Promise<void> {
    this.held = text;
  }

  async clear(): Promise<void> {
    this.held = null;
  }
}

function isSaveBackend(candidate: unknown): candidate is SaveBackend {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const backend = candidate as Partial<SaveBackend>;
  return (
    typeof backend.load === 'function' &&
    typeof backend.save === 'function' &&
    typeof backend.clear === 'function'
  );
}

/**
 * Picks the best available store: a host-provided one first, then this browser,
 * then memory. A host backend that throws while being created is ignored rather
 * than taking the game down with it.
 */
export function resolveSaveBackend(
  host: SaveBackendHost | undefined = (globalThis as { HeartbeatObservatory?: SaveBackendHost })
    .HeartbeatObservatory,
): SaveBackend {
  try {
    const provided = host?.createSaveBackend?.(PARKWORKS_GAME_ID);
    if (isSaveBackend(provided)) return provided;
  } catch {
    // Fall through to local storage.
  }
  return LocalSaveBackend.isAvailable() ? new LocalSaveBackend() : new MemorySaveBackend();
}
