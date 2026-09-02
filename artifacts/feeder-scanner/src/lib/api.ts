/**
 * Custom API client for endpoints not covered by generated API client
 */

class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message);
    this.name = "APIError";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // PRD §2.8 — every request carries X-Requested-With. The server requires
  // it on state-changing methods; safe methods get it too so no caller has
  // to remember when it's required.
  const headers = new Headers(init?.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });

  // Module 13 — 401 handling deliberately lives in the window.fetch patch
  // (main.tsx → lib/session-guard.ts), not here. This wrapper used to redirect
  // to a hardcoded "/login", which is wrong for the store and admin portals and
  // covered only the handful of callers that use `api.*`. The guard sees this
  // request too, so the redirect still happens — it just picks the right login
  // surface now. We only translate the status into an APIError for the caller.
  const data = await parseJsonResponse<T>(response);
  if (!response.ok) {
    throw new APIError(
      (data as { error?: string })?.error || `API error: ${response.statusText}`,
      response.status,
      { data },
    );
  }

  return data;
}

export const api = {
  async get<T>(url: string, config?: { params?: Record<string, any> }): Promise<{ data: T }> {
    const params = new URLSearchParams();
    if (config?.params) {
      Object.entries(config.params).forEach(([key, value]) => {
        // Only append truthy values (exclude undefined, null, empty strings)
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
    }
    const queryString = params.toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    try {
      const data = await request<T>(fullUrl);
      return { data };
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new Error(
        `Failed to fetch from ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  async post<T>(url: string, body?: any): Promise<{ data: T }> {
    try {
      const data = await request<T>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { data };
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new Error(
        `Failed to post to ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  async patch<T>(url: string, body?: any): Promise<{ data: T }> {
    try {
      const data = await request<T>(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { data };
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new Error(
        `Failed to patch ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  async delete<T>(url: string): Promise<{ data: T }> {
    try {
      const data = await request<T>(url, {
        method: "DELETE",
      });
      return { data };
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new Error(
        `Failed to delete ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};
