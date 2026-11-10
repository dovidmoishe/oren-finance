import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getMessageFallback, onIntlError } from "./intl-policy";
import { LOCALE_COOKIE, TIME_ZONE_COOKIE, isTimeZone, resolveLocale, type Locale } from "./locales";

// One catalog per request. Client components share most namespaces through the
// shell, so splitting the payload further would not drop a meaningful share of it.
async function messagesFor(locale: Locale) {
  switch (locale) {
    case "zh-CN":
      return (await import("./messages/zh-CN.json")).default;
    case "zh-TW":
      return (await import("./messages/zh-TW.json")).default;
    case "fr":
      return (await import("./messages/fr.json")).default;
    case "id":
      return (await import("./messages/id.json")).default;
    case "vi":
      return (await import("./messages/vi.json")).default;
    case "uk":
      return (await import("./messages/uk.json")).default;
    case "de":
      return (await import("./messages/de.json")).default;
    case "pt-BR":
      return (await import("./messages/pt-BR.json")).default;
    default:
      return (await import("./messages/en.json")).default;
  }
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
  const zone = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  return {
    locale,
    // The same zone on the server and the client keeps formatted dates from
    // disagreeing during hydration. UTC until the browser stores its zone.
    timeZone: zone && isTimeZone(zone) ? zone : "UTC",
    messages: await messagesFor(locale),
    onError: onIntlError,
    getMessageFallback,
  };
});
