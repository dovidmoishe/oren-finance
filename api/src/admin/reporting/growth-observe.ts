/** Reporting must never break login, research, or trades. */
export async function observeGrowth(
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task();
  } catch {
    // The core request already succeeded or failed on its own.
  }
}
