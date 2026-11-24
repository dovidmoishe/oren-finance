let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Oren-Admin", "1");
  if (init.body) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (
      response.status === 401 &&
      path !== "auth/session" &&
      path !== "auth/password"
    ) {
      window.dispatchEvent(new Event("admin-session-expired"));
    }
    throw new ApiError(
      response.status,
      typeof body?.message === "string"
        ? body.message
        : `Request failed (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function post<T>(path: string, body?: unknown) {
  return api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function exportDaily(params: URLSearchParams) {
  const response = await fetch(
    `/api/admin/reports/daily?${params}&format=csv`,
    {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Oren-Admin": "1" },
    },
  );
  if (!response.ok)
    throw new ApiError(
      response.status,
      "Could not export this report. Please try again.",
    );
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `oren-traffic-${params.get("from")}-${params.get("to")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
