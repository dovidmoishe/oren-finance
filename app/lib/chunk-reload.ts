/** One reload per tab after a stale deploy, then stop so a broken chunk cannot loop. */
export const CHUNK_RELOAD_STORAGE_KEY = "oren.chunk-reload-at";
export const CHUNK_RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk \d+ failed|Loading CSS chunk|Failed to load chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|\/_next\/static\//i;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === "string") return CHUNK_ERROR.test(error);
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "ChunkLoadError" || CHUNK_ERROR.test(`${name} ${message}`);
}

/** Covers a double effect in one attempt so the second call does not look like a failed reload. */
let sameAttemptAt = 0;

/**
 * Hard-reload once. A recent timestamp in sessionStorage means this tab already
 * tried, so the caller should show a signed-out recovery instead of looping.
 * Returns true when a reload was started (including a repeat of that same attempt).
 */
export function reloadOnceForChunkFailure(
  now = Date.now(),
  reload: () => void = () => window.location.reload(),
  storage?: Pick<Storage, "getItem" | "setItem">,
): boolean {
  if (sameAttemptAt && now - sameAttemptAt < 1_000) return true;
  try {
    // Reading sessionStorage can throw before the body runs if it is a default argument.
    const store = storage ?? window.sessionStorage;
    const previous = Number(store.getItem(CHUNK_RELOAD_STORAGE_KEY));
    if (Number.isFinite(previous) && previous > 0 && now - previous < CHUNK_RELOAD_GUARD_MS) return false;
    store.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  sameAttemptAt = now;
  reload();
  return true;
}

const giveUps = new Set<() => void>();
let listening = false;
let reloadedThisDocument = false;

function recover(error: unknown) {
  if (!isChunkLoadError(error) || reloadedThisDocument) return;
  if (reloadOnceForChunkFailure()) {
    reloadedThisDocument = true;
    return;
  }
  for (const giveUp of giveUps) giveUp();
}

function onWindowError(event: ErrorEvent) {
  const filename = typeof event.filename === "string" ? event.filename : "";
  if (isChunkLoadError(event.error) || isChunkLoadError(event.message) || isChunkLoadError(filename)) {
    recover(event.error ?? event.message ?? filename);
  }
}

function onRejection(event: PromiseRejectionEvent) {
  if (!isChunkLoadError(event.reason)) return;
  event.preventDefault();
  recover(event.reason);
}

/** Catch a failed route chunk, including while a loading skeleton is still up. */
export function installChunkLoadRecovery(onGiveUp: () => void) {
  giveUps.add(onGiveUp);
  if (typeof window !== "undefined" && !listening) {
    listening = true;
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onRejection);
  }
  return () => {
    giveUps.delete(onGiveUp);
  };
}
