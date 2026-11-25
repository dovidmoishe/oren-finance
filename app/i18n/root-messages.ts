import en from "./messages/en.json";

/**
 * Only the text rendered outside /app, /connect and /settings: the chunk-failure
 * notice and the cookie choice. Those sections send their whole catalog in the
 * visitor's language, so the full English catalog in the root layout would reach
 * every marketing page and arrive twice in the app.
 */
export const rootMessages = {
  common: { chunkFailed: en.common.chunkFailed },
  auth: { reload: en.auth.reload },
  cookies: en.cookies,
};
