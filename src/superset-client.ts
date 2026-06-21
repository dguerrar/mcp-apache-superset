export type AuthProvider = "db" | "ldap" | "oauth" | "token";

export interface SupersetConfig {
  baseUrl: string;
  username: string;
  password: string;
  accessToken?: string;
  authProvider: AuthProvider;
}

interface AuthTokens {
  accessToken: string;
  csrfToken: string;
}

export class SupersetClient {
  private config: SupersetConfig;
  private auth: AuthTokens | null = null;

  constructor(config: SupersetConfig) {
    this.config = config;
  }

  private get apiUrl(): string {
    return `${this.config.baseUrl}/api/v1`;
  }

  async login(): Promise<void> {
    if (this.config.authProvider === "token") {
      if (!this.config.accessToken) {
        throw new Error("SUPERSET_ACCESS_TOKEN is required when auth provider is 'token'");
      }
      this.auth = { accessToken: this.config.accessToken, csrfToken: "" };
      await this.fetchCsrfToken();
      return;
    }

    const provider = this.config.authProvider === "ldap" ? "ldap" : "db";

    const res = await fetch(`${this.apiUrl}/security/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        provider,
        refresh: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { access_token: string };

    this.auth = {
      accessToken: data.access_token,
      csrfToken: "",
    };

    await this.fetchCsrfToken();
  }

  private async fetchCsrfToken(): Promise<void> {
    if (!this.auth) throw new Error("Not authenticated");

    const res = await fetch(`${this.apiUrl}/security/csrf_token/`, {
      headers: this.buildHeaders(),
    });

    if (res.ok) {
      const data = (await res.json()) as { result?: string };
      this.auth.csrfToken = data.result ?? "";
    }
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extra,
    };

    if (this.auth) {
      headers["Authorization"] = `Bearer ${this.auth.accessToken}`;
      if (this.auth.csrfToken) {
        headers["X-CSRFToken"] = this.auth.csrfToken;
      }
    }

    return headers;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.auth) {
      await this.login();
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureAuth();

    const opts: RequestInit = {
      method,
      headers: this.buildHeaders(),
    };

    if (body && method !== "GET") {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.apiUrl}${path}`, opts);

    if (res.status === 401) {
      if (this.config.authProvider === "token") {
        throw new Error("Access token expired or invalid. Provide a fresh SUPERSET_ACCESS_TOKEN.");
      }
      await this.login();
      const retryRes = await fetch(`${this.apiUrl}${path}`, {
        ...opts,
        headers: this.buildHeaders(),
      });
      if (!retryRes.ok) {
        throw new Error(`Request failed after re-auth: ${retryRes.status}`);
      }
      return retryRes.json() as T;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Superset API error ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json() as T;
    }
    return (await res.text()) as unknown as T;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
