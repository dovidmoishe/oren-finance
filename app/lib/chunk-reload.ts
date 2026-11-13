/** One automatic reload per tab for this deploy. A new commit may reload once more. */
export const CHUNK_RELOAD_STORAGE_KEY = "oren.chunk-reload";

const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to load chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === "string") return CHUNK_ERROR.test(error);
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "ChunkLoadError" || CHUNK_ERROR.test(`${name} ${message}`);
}

function currentDeployment(): string {
  return process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() || "local";
}

/**
 * Hard-reload once for this commit. If this tab already reloaded for the same
 * commit, return false so the caller can show a manual recovery action.
 * Returns true when a reload was started.
 */
export function reloadOnceForChunkFailure(
  reload: () => void = () => window.location.reload(),
  storage?: Pick<Storage, "getItem" | "setItem">,
): boolean {
  try {
    // Reading sessionStorage can throw before the body runs if it is a default argument.
    const store = storage ?? window.sessionStorage;
    const deployment = currentDeployment();
    if (store.getItem(CHUNK_RELOAD_STORAGE_KEY) === deployment) return false;
    store.setItem(CHUNK_RELOAD_STORAGE_KEY, deployment);
  } catch {
    return false;
  }
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
  if (isChunkLoadError(event.error)) recover(event.error);
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
