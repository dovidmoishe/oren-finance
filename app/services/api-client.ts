const API_BASE_URL = process.env.NEXT_PUBLIC_OREN_API_URL ?? "http://localhost:3000/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  const requestPath = path.replace(/^\/+/, "");
  const url = new URL(requestPath, baseUrl);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
