import type {
  AccountsResponse,
  AddAccountRequest,
  AgentsResponse,
  CreateThreadRequest,
  Health,
  OpenSessionRequest,
  PermissionRequest,
  PrsResponse,
  SeenRequest,
  SetActiveAccountRequest,
  Skill,
  ThreadSummary,
  TurnRequest,
  EngineName,
} from "@flightdeck/shared";

/** Every route answers JSON; an error body carries `{ error }`. */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${path} → ${response.status}`);
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const api = {
  prs: (fresh = false) => request<PrsResponse>(fresh ? "/api/prs?fresh" : "/api/prs"),
  agents: () => request<AgentsResponse>("/api/agents"),
  skills: () => request<Skill[]>("/api/skills"),
  health: () => request<Health>("/api/health"),

  accounts: () => request<AccountsResponse>("/api/accounts"),
  addAccount: (body: AddAccountRequest) => post<AccountsResponse>("/api/accounts", body),
  setActiveAccount: (body: SetActiveAccountRequest) =>
    post<AccountsResponse>("/api/accounts/active", body),
  removeAccount: (login: string) =>
    request<AccountsResponse>(`/api/accounts/${login}`, { method: "DELETE" }),

  markSeen: (body: SeenRequest) => post<{ id: string; at: number }>("/api/seen", body),

  threads: () => request<ThreadSummary[]>("/api/threads"),
  createThread: (body: CreateThreadRequest) => post<ThreadSummary>("/api/threads", body),
  turn: (id: string, body: TurnRequest) => post<ThreadSummary>(`/api/threads/${id}/turn`, body),
  permission: (id: string, body: PermissionRequest) =>
    post<{ resolved: boolean }>(`/api/threads/${id}/permission`, body),
  stop: (id: string) => post<{ stopped: boolean }>(`/api/threads/${id}/stop`),

  openSession: (engine: EngineName, sessionId: string, body: OpenSessionRequest) =>
    post<ThreadSummary>(`/api/sessions/${engine}/${sessionId}/open`, body),
};
