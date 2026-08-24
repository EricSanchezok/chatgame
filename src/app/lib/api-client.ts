export class WorldApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "WorldApiError";
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new WorldApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
