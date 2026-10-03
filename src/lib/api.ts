import type { OnboardingData } from "@/app/onboarding/_types/onboarding";

/**
 * Backend API base URL. Required in every environment â€” there is deliberately
 * NO hardcoded default so a missing NEXT_PUBLIC_API_URL fails loudly at
 * request time instead of silently targeting localhost in production.
 */
function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
  }
  return url;
}

/**
 * Thrown when a request cannot be formed correctly because the frontend
 * foundation (universityId / reportingPeriodId) is not initialized.
 * Callers must NOT treat this as a backend failure (no demo fallback).
 */
export class ContextError extends Error {}

/** HTTP-aware error so callers can branch on 401/403/404. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/**
 * Registered by AuthProvider so any 401 anywhere in the app tears down the
 * stale session instead of leaving the user on a screen that silently fails.
 */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

function handleUnauthorized() {
  unauthorizedHandler?.();
}

function getStoredId(key: string): string {
  return typeof window !== "undefined" ? localStorage.getItem(key) || "" : "";
}

/** Requires universityId; optionally also reportingPeriodId. */
export function requireContext(opts: { requirePeriod?: boolean } = {}): { uId: string; pId: string } {
  const uId = getStoredId("universityId");
  if (!uId) {
    throw new ContextError("Missing universityId context â€” sign in again to initialize your session.");
  }
  const pId = getStoredId("reportingPeriodId");
  if (opts.requirePeriod && !pId) {
    throw new ContextError("Missing reportingPeriodId context â€” no reporting period is selected.");
  }
  return { uId, pId };
}

/**
 * V2 backend error bodies use { success, error?, details?[] } or { success,
 * message }. Extract the most specific human-readable message available so
 * validation failures (e.g. "Activity date must be within reporting period")
 * reach the user instead of a generic status-code toast.
 */
function extractApiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) return data;
  const payload = (data ?? {}) as {
    error?: unknown;
    message?: unknown;
    details?: unknown;
    data?: unknown;
  };

  const parts: string[] = [];

  // NestJS class-validator returns message as an array of strings
  if (Array.isArray(payload.message) && payload.message.length > 0) {
    const msgs = (payload.message as unknown[]).filter(
      (m): m is string => typeof m === "string" && m.trim().length > 0
    );
    if (msgs.length > 0) parts.push(msgs.join("; "));
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    parts.push(payload.error);
  }
  if (Array.isArray(payload.details) && payload.details.length > 0) {
    const detailText = payload.details
      .map((item) => {
        const issue = (item ?? {}) as { field?: unknown; message?: unknown };
        const field = typeof issue.field === "string" ? issue.field : "";
        const message =
          typeof issue.message === "string" && issue.message.trim()
            ? issue.message
            : "is invalid";
        return field ? `${field}: ${message}` : message;
      })
      .filter(Boolean)
      .join("; ");
    if (detailText) parts.push(detailText);
  }
  if (parts.length === 0) {
    if (typeof payload.message === "string" && payload.message.trim()) {
      parts.push(payload.message);
    } else {
      // Try message nested inside a `data` envelope
      const nested = (payload.data ?? {}) as { message?: unknown; error?: unknown };
      if (typeof nested.message === "string" && nested.message.trim()) {
        parts.push(nested.message);
      } else if (typeof nested.error === "string" && nested.error.trim()) {
        parts.push(nested.error);
      } else {
        parts.push(fallback);
      }
    }
  }
  return parts.join(" | ");
}

/**
 * Core request helper. Returns the parsed body plus the HTTP status so
 * callers that need to distinguish statuses (e.g. onboarding 404 = "not
 * submitted yet") can do so without parsing error strings.
 */
async function requestJson(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers(options.headers || {});

  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // 10-second timeout to prevent requests from hanging for 40-50s
  let controller: AbortController | null = null;
  let signal = options.signal;
  if (!signal) {
    controller = new AbortController();
    signal = controller.signal;
  }
  const timeoutId = controller ? setTimeout(() => controller?.abort(), 10000) : null;

  let response;
  try {
    response = await fetch(`${apiUrl()}${endpoint}`, {
      ...options,
      headers,
      signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, status: 504, data: { message: "Request timed out after 10s. Backend is responding slowly." } };
    }
    return { ok: false, status: 503, data: { message: "Network error: Backend server is unreachable." } };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { message: text };
  }

  return { ok: response.ok, status: response.status, data };
}

/**
 * Standard API call: resolves with the parsed body or throws an ApiError whose
 * message carries the most specific backend-provided explanation and whose
 * `status` lets callers distinguish 401/403/404 without string matching.
 */
export async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const { ok, status, data } = await requestJson(endpoint, options);

  if (!ok) {
    const error = new ApiError(
      status === 401
        ? extractApiErrorMessage(data, "Session expired. Please log in again.")
        : extractApiErrorMessage(data, `API error: ${status}`),
      status
    );
    if (status === 401) {
      // Session is dead: clear the credentials so the app cannot keep issuing
      // doomed requests, and send the user back to sign-in.
      handleUnauthorized();
    }
    throw error;
  }

  return data;
}



// Activity Data APIs
export async function getActivityData() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/activity-data${query}`);
}

export async function createActivityData(data: any) {
  const { uId, pId } = requireContext();
  return fetchAPI(`/activity-data`, {
    method: "POST",
    body: JSON.stringify({ ...data, universityId: uId, reportingPeriodId: data.reportingPeriodId || pId }),
  });
}

export async function updateActivityData(id: string, data: any) {
  // Live V2 requires universityId as a QUERY param on PATCH (verified).
  const { uId } = requireContext();
  return fetchAPI(`/activity-data/${id}?universityId=${uId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteActivityData(id: string) {
  // Live V2 requires universityId as a query param on DELETE (verified).
  const { uId } = requireContext();
  return fetchAPI(`/activity-data/${id}?universityId=${uId}`, {
    method: "DELETE",
  });
}

// Workflow transitions: live V2 requires universityId in the JSON body (verified).
//
// These previously fell back to a direct PATCH on ANY error, which silently
// masked 401/403 and locked-period rejections: a reviewer could "verify" a row
// in a locked period and be told it succeeded. The fallback is now limited to
// 404 (endpoint genuinely absent on the deployed backend); every other failure
// surfaces to the caller.
async function transitionActivityStatus(
  id: string,
  action: "submit" | "start-review" | "verify" | "reject",
  body: Record<string, unknown>,
  fallbackStatus: string
) {
  const { uId } = requireContext();
  try {
    return await fetchAPI(`/activity-data/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ ...body, universityId: uId }),
    });
  } catch (err: any) {
    const status = err?.status;
    if (status !== 404) throw err;
    return updateActivityData(id, { status: fallbackStatus });
  }
}

export async function submitActivityData(id: string) {
  return transitionActivityStatus(id, "submit", {}, "SUBMITTED");
}

export async function startReviewActivityData(id: string) {
  return transitionActivityStatus(id, "start-review", {}, "UNDER_REVIEW");
}

export async function verifyActivityData(id: string) {
  return transitionActivityStatus(id, "verify", {}, "VERIFIED");
}

export async function rejectActivityData(id: string, reason: string) {
  return transitionActivityStatus(id, "reject", { reason }, "REJECTED");
}

// ==========================================
// CALCULATIONS API
// ==========================================
export async function calculateEmissions(activityId: string) {
  const { uId, pId } = requireContext();
  try {
    return await fetchAPI(`/calculations/activity/${activityId}`, {
      method: "POST",
      body: JSON.stringify({ universityId: uId, reportingPeriodId: pId }),
    });
  } catch (err: any) {
    // Only fall back when the dedicated endpoint is absent. Any other failure
    // (missing emission factor, out-of-period date, locked period) must reach
    // the user instead of being reported as "calculation failed" blindly.
    if (err?.status !== 404) throw err;
    return calculateEmissionsBulk({ activity_data_id: activityId, universityId: uId, reportingPeriodId: pId });
  }
}

// ==========================================
// DASHBOARD API
// ==========================================
export async function getDashboardSummary(universityId?: string, reportingPeriodId?: string, campusId?: string, buildingId?: string, floorId?: string) {
  const { uId, pId } = requireContext();
  const effectiveUId = universityId || uId;
  const effectivePId = reportingPeriodId || pId;

  let url = `/dashboard/summary?universityId=${effectiveUId}`;
  if (effectivePId) url += `&reportingPeriodId=${effectivePId}`;
  if (campusId) url += `&campusId=${campusId}`;
  if (buildingId) url += `&buildingId=${buildingId}`;
  if (floorId) url += `&floorId=${floorId}`;
  return fetchAPI(url);
}

export async function getReviewActivities() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/activity-data/review${query}`);
}



/**
 * Downloads the import template.
 *
 * Returns the raw bytes rather than a URL: opening the endpoint with
 * window.open() cannot attach the Authorization header, so the backend
 * answered 401 and the template download always failed.
 */
export async function downloadImportTemplate() {
  const { uId } = requireContext();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${apiUrl()}/activity-data/import/template?universityId=${uId}`, {
    headers,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new ApiError(
      extractApiErrorMessage(errorData, `Template download failed (${res.status})`),
      res.status
    );
  }
  return res.blob();
}

export async function previewImport(file: File) {
  const { uId, pId } = requireContext({ requirePeriod: true });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("universityId", uId);
  formData.append("reportingPeriodId", pId);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${apiUrl()}/activity-data/import/preview`, {
    method: "POST",
    headers,
    body: formData,
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(
      extractApiErrorMessage(data, `Failed to preview import (${res.status})`),
      res.status
    );
  }
  return data;
}

export async function confirmImport(jobId: string, validData: any[]) {
  const { uId, pId } = requireContext({ requirePeriod: true });
  return fetchAPI(`/activity-data/import/confirm`, {
    method: "POST",
    body: JSON.stringify({ jobId, universityId: uId, reportingPeriodId: pId, validData }),
  });
}

// Document APIs
export async function uploadDocument(file: File, documentType: string) {
  const { uId } = requireContext();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("universityId", uId);
  formData.append("documentType", documentType);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${apiUrl()}/documents/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || "Failed to upload document");
  }
  return res.json();
}

export async function getDocuments() {
  const { uId } = requireContext();
  return fetchAPI(`/documents?universityId=${uId}`);
}

export async function ocrDocument(id: string) {
  return fetchAPI(`/documents/${id}/ocr`, { method: "POST" });
}

export async function createActivityFromDocument(id: string, data: any) {
  const { uId, pId } = requireContext();
  return fetchAPI(`/documents/${id}/create-activity`, {
    method: "POST",
    body: JSON.stringify({ ...data, universityId: uId, reportingPeriodId: data.reportingPeriodId || pId }),
  });
}

// Reporting Periods APIs
export async function getReportingPeriods() {
  const { uId } = requireContext();
  return fetchAPI(`/reporting-periods?universityId=${uId}`);
}

export async function createReportingPeriod(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/reporting-periods`, {
    method: "POST",
    body: JSON.stringify({ ...data, universityId: uId }),
  });
}

export async function openReportingPeriod(id: string) {
  return fetchAPI(`/reporting-periods/${id}/open`, { method: "POST" });
}

export async function lockReportingPeriod(id: string) {
  return fetchAPI(`/reporting-periods/${id}/lock`, { method: "POST" });
}

export async function setBaselineReportingPeriod(id: string) {
  return fetchAPI(`/reporting-periods/${id}/set-baseline`, { method: "POST" });
}



// Baselines APIs
export async function getBaselines() {
  const { uId } = requireContext();
  return fetchAPI(`/baselines?universityId=${uId}`);
}

export async function createBaseline(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/baselines`, {
    method: "POST",
    body: JSON.stringify({ ...data, universityId: uId })
  });
}

export async function lockBaseline(id: string) {
  return fetchAPI(`/baselines/${id}/lock`, { method: "POST" });
}

export async function approveBaseline(id: string) {
  return fetchAPI(`/baselines/${id}/approve`, { method: "POST" });
}

export async function getBaselineComparison(id: string) {
  return fetchAPI(`/baselines/${id}/comparison`);
}

// Targets APIs
export async function getTargets() {
  const { uId } = requireContext();
  return fetchAPI(`/targets?universityId=${uId}`);
}

export async function createTarget(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/targets`, {
    method: "POST",
    body: JSON.stringify({ ...data, universityId: uId })
  });
}

export async function getTargetProgress(targetId: string, reportingPeriodId: string) {
  return fetchAPI(`/targets/${targetId}/progress?reportingPeriodId=${reportingPeriodId}`);
}

// Emission Factors APIs
export async function getEmissionFactors() {
  const { uId } = requireContext();
  return fetchAPI(`/emission-factors?universityId=${uId}`);
}

// Admin Management APIs
export async function getCampuses() {
  const { uId } = requireContext();
  return fetchAPI(`/campuses?universityId=${uId}`);
}

export async function getBuildings() {
  const { uId } = requireContext();
  return fetchAPI(`/buildings?universityId=${uId}`);
}

export async function getFloors() {
  const { uId } = requireContext();
  return fetchAPI(`/floors?universityId=${uId}`);
}

export async function getAssets() {
  const { uId } = requireContext();
  return fetchAPI(`/assets?universityId=${uId}`);
}

// Data Quality APIs
export async function getDataQualityMetrics(filters?: {
  reportingPeriodId?: string;
  scope?: string;
  category?: string;
}) {
  const { uId, pId } = requireContext();
  const params = new URLSearchParams({ universityId: uId });
  if (filters?.reportingPeriodId) params.set("reportingPeriodId", filters.reportingPeriodId);
  else if (pId) params.set("reportingPeriodId", pId);
  if (filters?.scope) params.set("scope", filters.scope);
  if (filters?.category) params.set("category", filters.category);
  return fetchAPI(`/data-quality/metrics?${params.toString()}`);
}

// Recommendations APIs
export async function getRecommendations(filters?: {
  priority?: string;
  category?: string;
  status?: string;
}) {
  const { uId } = requireContext();
  const params = new URLSearchParams({ universityId: uId });
  if (filters?.priority) params.set("priority", filters.priority);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.status) params.set("status", filters.status);
  return fetchAPI(`/recommendations?${params.toString()}`);
}

export async function getRecommendationById(id: string) {
  return fetchAPI(`/recommendations/${id}`);
}

export async function updateRecommendationStatus(id: string, status: string) {
  return fetchAPI(`/recommendations/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function generateRecommendations() {
  const { uId, pId } = requireContext({ requirePeriod: true });
  return fetchAPI(`/recommendations/generate`, {
    method: "POST",
    body: JSON.stringify({ universityId: uId, reportingPeriodId: pId }),
  });
}

// Notifications APIs
export async function getNotifications(filters?: { isRead?: boolean; type?: string }) {
  const uId = typeof window !== "undefined" ? localStorage.getItem("universityId") || "" : "";
  const params = new URLSearchParams({ universityId: uId });
  if (filters?.isRead !== undefined) params.set("isRead", String(filters.isRead));
  if (filters?.type) params.set("type", filters.type);
  return fetchAPI(`/notifications?${params.toString()}`);
}

export async function getUnreadNotificationsCount() {
  const uId = typeof window !== "undefined" ? localStorage.getItem("universityId") || "" : "";
  return fetchAPI(`/notifications/unread-count?universityId=${uId}`);
}

export async function markNotificationAsRead(id: string) {
  return fetchAPI(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsAsRead() {
  return fetchAPI(`/notifications/read-all`, { method: "PATCH" });
}

// Audit Logs APIs
export async function getAuditLogs(filters?: {
  userId?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const uId = typeof window !== "undefined" ? localStorage.getItem("universityId") || "" : "";
  const params = new URLSearchParams();
  if (uId) params.set("universityId", uId);
  
  if (filters?.userId) params.set("userId", filters.userId);
  if (filters?.action && filters.action !== "ALL") params.set("action", filters.action);
  if (filters?.entity && filters.entity !== "ALL") params.set("entity", filters.entity);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  
  return fetchAPI(`/audit-logs?${params.toString()}`);
}


// Admin / Campus & Building APIs
// V2 requires universityId in the create body (verified live).
export async function createCampus(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/campuses`, { method: "POST", body: JSON.stringify({ ...data, universityId: uId }) });
}
export async function createBuilding(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/buildings`, { method: "POST", body: JSON.stringify({ ...data, universityId: uId }) });
}

// Universities APIs
export async function getUniversity(id: string) {
  return fetchAPI(`/universities/${id}`);
}

export async function updateUniversity(id: string, data: any) {
  return fetchAPI(`/universities/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ==========================================
// REPORTS API
// ==========================================
export async function generateReport() {
  const { uId, pId } = requireContext({ requirePeriod: true });
  return fetchAPI(`/reports/generate`, {
    method: "POST",
    body: JSON.stringify({ universityId: uId, reportingPeriodId: pId }),
  });
}

export async function getReports() {
  const { uId } = requireContext();
  return fetchAPI(`/reports?universityId=${uId}`);
}

export async function getReport(id: string) {
  return fetchAPI(`/reports/${id}`);
}

export async function generateReportPdf(id: string) {
  return fetchAPI(`/reports/${id}/generate-pdf`, { method: "POST" });
}

// Response puts `url` at the TOP LEVEL (not inside data) â€” see V2 doc rule 9.
export async function getReportDownloadUrl(id: string): Promise<string> {
  const res = await fetchAPI(`/reports/${id}/download`);
  if (!res.url) throw new Error(res.message || "Report download is not available yet.");
  return res.url;
}

// ==========================================
// AUTH API - Updated for scale-api v2 backend
// POST /auth/login body: { tenantId, email, password }
// Response: { success, data: { token, expiresInSeconds, user:{id,tenantId,name,email,role} }, requestId }
// ==========================================
export interface AuthUser {
  id: string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
  tenantId?: string | null;
  organisationId?: string | null;
}

export interface AuthResponse {
  success: boolean;
  data: { user: AuthUser; token: string };
  message?: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const envTenantId = (process.env.NEXT_PUBLIC_TENANT_ID ?? '') as string;
  const storedTenantId = typeof window !== 'undefined' ? (localStorage.getItem('tenantId') ?? '') : '';
  const tenantId = envTenantId || storedTenantId;

  const { ok, status, data } = await requestJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenantId, email, password }),
  });

  if (!ok) {
    return {
      success: false,
      data: { user: {} as AuthUser, token: '' },
      message: extractApiErrorMessage(data, status === 401 ? 'Invalid email or password.' : 'Login failed (' + status + ')'),
    };
  }

  const inner = (data?.data ?? data) as { token: string; user: Record<string, unknown> };
  const user: AuthUser = {
    ...(inner.user as any),
    username: ((inner.user?.name ?? inner.user?.email) as string) ?? '',
    tenantId: inner.user?.tenantId as string | null,
    organisationId: inner.user?.tenantId as string | null,
  };

  if (inner.user?.tenantId && typeof window !== 'undefined') {
    localStorage.setItem('tenantId', inner.user.tenantId as string);
    localStorage.setItem('universityId', inner.user.tenantId as string);
  }

  return { success: true, data: { token: inner.token, user } };
}

export async function logoutSession(): Promise<void> {
  await requestJson('/auth/logout', { method: 'POST' }).catch(() => {});
}

export async function register(_payload: { username: string; email: string; password: string }): Promise<AuthResponse> {
  return { success: false, data: { user: {} as AuthUser, token: '' }, message: 'Account creation is managed by the administrator.' };
}
// â”€â”€ Onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The backend resolves the organisation from the authenticated user (JWT â†’
// users.organisation_id); no organisationId is ever sent or accepted here.

export interface OnboardingRecord {
  id: string;
  organisationId: string;
  company: OnboardingData["company"];
  university?: OnboardingData["university"];
  locations: OnboardingData["locations"];
  reporting: OnboardingData["reporting"];
  integrations: OnboardingData["integrations"];
  emissions: OnboardingData["emissions"];
  valueChain: OnboardingData["valueChain"];
  strategy: OnboardingData["strategy"];
  physicalHierarchy?: OnboardingData["physicalHierarchy"];
  intakeRaw?: OnboardingData["intakeRaw"];
  createdAt: string;
  updatedAt: string;
}

export type OnboardingStatusResult =
  | { kind: "completed"; record: OnboardingRecord }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/** GET /onboarding â€” 404 means the organisation hasn't onboarded yet. */
export async function getOnboardingStatus(): Promise<OnboardingStatusResult> {
  try {
    const { status, data } = await requestJson(`/onboarding`);
    if (status === 200 && data?.data) {
      return { kind: "completed", record: data.data as OnboardingRecord };
    }
    if (status === 404) {
      return { kind: "not-found" };
    }
    if (status === 401) {
      return {
        kind: "error",
        message: extractApiErrorMessage(data, "Session expired. Please log in again."),
      };
    }
    return {
      kind: "error",
      message: extractApiErrorMessage(data, `Failed to check onboarding status (${status})`),
    };
  } catch (err) {
    return {
      kind: "error",
      message:
        err instanceof Error
          ? err.message
          : "Could not reach the server to check onboarding status.",
    };
  }
}

export type OnboardingSubmitResult =
  | { kind: "created"; record: OnboardingRecord }
  | { kind: "updated"; record: OnboardingRecord }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

/** POST /onboarding â€” creates the profile; 409 when one already exists. */
export async function createOnboarding(
  payload: OnboardingData
): Promise<OnboardingSubmitResult> {
  const { status, data } = await requestJson(`/onboarding`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (status === 201 && data?.data) {
    return { kind: "created", record: data.data as OnboardingRecord };
  }
  if (status === 409) {
    return { kind: "conflict" };
  }
  if (status === 401) {
    return {
      kind: "error",
      message: extractApiErrorMessage(data, "Session expired. Please log in again."),
    };
  }
  return {
    kind: "error",
    message: extractApiErrorMessage(data, "Failed to save onboarding"),
  };
}

/** PUT /onboarding â€” replaces the existing profile (idempotent upsert). */
export async function updateOnboarding(
  payload: OnboardingData
): Promise<OnboardingSubmitResult> {
  const { status, data } = await requestJson(`/onboarding`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (status === 200 && data?.data) {
    return { kind: "updated", record: data.data as OnboardingRecord };
  }
  if (status === 401) {
    return {
      kind: "error",
      message: extractApiErrorMessage(data, "Session expired. Please log in again."),
    };
  }
  return {
    kind: "error",
    message: extractApiErrorMessage(data, "Failed to update onboarding"),
  };
}

// ==========================================
// NEWLY ADDED ENDPOINTS (MISSING V2)
// ==========================================

// Dashboard
export async function getDashboardOverview() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/overview${query}`);
}
export async function getDashboardScopeBreakdown() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/scope-breakdown${query}`);
}
export async function getDashboardCategories() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/categories${query}`);
}
export async function getDashboardTopSources() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/top-sources${query}`);
}
export async function getDashboardTrends() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/trends${query}`);
}
export async function getDashboardBuildings() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/buildings${query}`);
}
export async function getDashboardFloors() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/floors${query}`);
}
export async function getDashboardBaselineComparison() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/baseline-comparison${query}`);
}
export async function getDashboardIntensity() {
  const { uId, pId } = requireContext();
  const query = `?universityId=${uId}${pId ? `&reportingPeriodId=${pId}` : ""}`;
  return fetchAPI(`/dashboard/intensity${query}`);
}

// Physical Hierarchy
export async function getCampusById(id: string) {
  return fetchAPI(`/campuses/${id}`);
}
export async function updateCampus(id: string, data: any) {
  return fetchAPI(`/campuses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function getBuildingById(id: string) {
  return fetchAPI(`/buildings/${id}`);
}
export async function updateBuilding(id: string, data: any) {
  return fetchAPI(`/buildings/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function createFloor(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/floors`, { method: "POST", body: JSON.stringify({ ...data, universityId: uId }) });
}
export async function getFloorById(id: string) {
  return fetchAPI(`/floors/${id}`);
}
export async function updateFloor(id: string, data: any) {
  return fetchAPI(`/floors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

// Emission Factors
export async function createEmissionFactor(data: any) {
  return fetchAPI(`/emission-factors`, { method: "POST", body: JSON.stringify(data) });
}
export async function matchEmissionFactor(data: any) {
  return fetchAPI(`/emission-factors/match`, { method: "POST", body: JSON.stringify(data) });
}
export async function importEmissionFactors(data: any) {
  return fetchAPI(`/emission-factors/import`, { method: "POST", body: JSON.stringify(data) });
}
export async function getPendingEfActivities() {
  return fetchAPI(`/emission-factors/pending`);
}
export async function getEmissionFactorById(id: string) {
  return fetchAPI(`/emission-factors/${id}`);
}
export async function updateEmissionFactor(id: string, data: any) {
  return fetchAPI(`/emission-factors/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deactivateEmissionFactor(id: string) {
  return fetchAPI(`/emission-factors/${id}`, { method: "DELETE" });
}

// Imports & Documents
export async function testStorageUpload(data: any) {
  return fetchAPI(`/imports/test`, { method: "POST", body: JSON.stringify(data) });
}
export async function getDocumentByActivity(activityId: string) {
  return fetchAPI(`/documents/activity/${activityId}`);
}
export async function getDocumentById(id: string) {
  return fetchAPI(`/documents/${id}`);
}
export async function deleteDocument(id: string) {
  return fetchAPI(`/documents/${id}`, { method: "DELETE" });
}

// Emissions
export async function calculateEmissionsBulk(data: any) {
  return fetchAPI(`/emissions/calculate`, { method: "POST", body: JSON.stringify(data) });
}

// University Statistics
export async function getUniversityStatistics() {
  const { uId } = requireContext();
  return fetchAPI(`/university-statistics?universityId=${uId}`);
}
export async function createUniversityStatistic(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/university-statistics`, { method: "POST", body: JSON.stringify({ ...data, universityId: uId }) });
}
export async function updateUniversityStatistic(id: string, data: any) {
  return fetchAPI(`/university-statistics/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteUniversityStatistic(id: string) {
  return fetchAPI(`/university-statistics/${id}`, { method: "DELETE" });
}

// Universities
export async function createUniversity(data: any) {
  return fetchAPI(`/universities`, { method: "POST", body: JSON.stringify(data) });
}
export async function getUniversities() {
  return fetchAPI(`/universities`);
}

// Taxonomy
export async function importTaxonomy(data: any) {
  return fetchAPI(`/taxonomy/import`, { method: "POST", body: JSON.stringify(data) });
}

// Assets
export async function createAsset(data: any) {
  const { uId } = requireContext();
  return fetchAPI(`/assets`, { method: "POST", body: JSON.stringify({ ...data, universityId: uId }) });
}
export async function updateAsset(id: string, data: any) {
  return fetchAPI(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function getAssetById(id: string) {
  return fetchAPI(`/assets/${id}`);
}

// Reset Activity Data
export async function resetActivityData(id: string) {
  return fetchAPI(`/activity-data/${id}/reset`, { method: "POST" });
}

// Baseline
export async function getBaselineById(id: string) {
  return fetchAPI(`/baselines/${id}`);
}
export async function submitBaseline(id: string) {
  return fetchAPI(`/baselines/${id}/submit`, { method: "POST" });
}

// ==========================================
// UNIVERSITY API - scale-api v2 /api/v2/university/*
// All these routes require JWT token (Bearer header)
// ==========================================

/** GET /university/meta - loads first-page reference data for the university console */
export async function getUniversityMeta() {
  return fetchAPI('/university/meta');
}

/** GET /university/overview - combined inventory + approved indicators */
export async function getUniversityOverview(periodId?: string) {
  const q = periodId ? `?periodId=${periodId}` : '';
  return fetchAPI(`/university/overview${q}`);
}

/** GET /university/inventory - page the combined emission inventory */
export async function getInventory(periodId: string, params: { limit?: number; afterId?: string } = {}) {
  const q = new URLSearchParams({ periodId, ...Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) });
  return fetchAPI(`/university/inventory?${q}`);
}

/** GET /university/knowledge/search - semantic search over approved records */
export async function knowledgeSearch(term: string, periodId?: string) {
  const q = new URLSearchParams({ q: term });
  if (periodId) q.set('periodId', periodId);
  return fetchAPI(`/university/knowledge/search?${q}`);
}

/** POST /university/insights/query - traceable facts for an insight question */
export async function queryInsights(body: { question: string; periodId?: string }) {
  return fetchAPI('/university/insights/query', { method: 'POST', body: JSON.stringify(body) });
}

/** POST /university/commuting/estimate */
export async function estimateCommuting(body: Record<string, unknown>) {
  return fetchAPI('/university/commuting/estimate', { method: 'POST', body: JSON.stringify(body) });
}

// ---- CATALOG ----
export async function getCatalog() {
  return fetchAPI('/university/catalog');
}
export async function installCatalog(body: Record<string, unknown>) {
  return fetchAPI('/university/catalog/install', { method: 'POST', body: JSON.stringify(body) });
}

// ---- KPIs ----
export async function getKpis(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/kpis?${q}`);
}
export async function getKpiById(id: string) {
  return fetchAPI(`/university/kpis/${id}`);
}

// ---- TASKS (KPI Collection) ----
export async function getTasks(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/tasks?${q}`);
}
export async function getTaskById(id: string) {
  return fetchAPI(`/university/tasks/${id}`);
}
export async function createTaskSubmission(taskId: string, body: Record<string, unknown>) {
  return fetchAPI(`/university/tasks/${taskId}/submissions`, { method: 'POST', body: JSON.stringify(body) });
}
export async function waiveTask(taskId: string, body: { reason: string }) {
  return fetchAPI(`/university/tasks/${taskId}/waive`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- SUBMISSIONS ----
export async function getSubmissionById(id: string) {
  return fetchAPI(`/university/submissions/${id}`);
}
export async function editSubmission(id: string, body: Record<string, unknown>) {
  return fetchAPI(`/university/submissions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function submitSubmission(id: string) {
  return fetchAPI(`/university/submissions/${id}/submit`, { method: 'POST', body: '{}' });
}
export async function approveSubmission(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/submissions/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectSubmission(id: string, body: { reason: string }) {
  return fetchAPI(`/university/submissions/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- UNIVERSITY EMISSIONS ----
export async function getEmissions(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/emissions?${q}`);
}
export async function getEmissionById(id: string) {
  return fetchAPI(`/university/emissions/${id}`);
}
export async function editEmission(id: string, body: Record<string, unknown>) {
  return fetchAPI(`/university/emissions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export async function submitEmission(id: string) {
  return fetchAPI(`/university/emissions/${id}/submit`, { method: 'POST', body: '{}' });
}
export async function approveEmission(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/emissions/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectEmission(id: string, body: { reason: string }) {
  return fetchAPI(`/university/emissions/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}
export async function requestVoid(id: string, body: { reason: string }) {
  return fetchAPI(`/university/emissions/${id}/request-void`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- VOIDS ----
export async function getVoids(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/voids?${q}`);
}
export async function approveVoid(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/voids/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectVoid(id: string, body: { reason: string }) {
  return fetchAPI(`/university/voids/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- FACTORS (University emission factors) ----
export async function getFactors(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/factors?${q}`);
}
export async function getFactorById(id: string) {
  return fetchAPI(`/university/factors/${id}`);
}
export async function approveFactor(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/factors/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- IMPORTS (CSV emissions) ----
export async function previewEmissionsCsv(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${apiUrl()}/university/imports/emissions/preview`, { method: 'POST', headers, body: formData });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}
export async function commitEmissionsCsv(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${apiUrl()}/university/imports/emissions/commit`, { method: 'POST', headers, body: formData });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}

// ---- SUPPLIERS ----
export async function getSuppliers(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/suppliers?${q}`);
}
export async function getSupplierById(id: string) {
  return fetchAPI(`/university/suppliers/${id}`);
}
export async function createSupplier(body: Record<string, unknown>) {
  return fetchAPI('/university/suppliers', { method: 'POST', body: JSON.stringify(body) });
}

// ---- SUPPLIER REQUESTS ----
export async function getSupplierRequests(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/supplier-requests?${q}`);
}
export async function getSupplierRequestById(id: string) {
  return fetchAPI(`/university/supplier-requests/${id}`);
}
export async function createSupplierRequest(body: Record<string, unknown>) {
  return fetchAPI('/university/supplier-requests', { method: 'POST', body: JSON.stringify(body) });
}
export async function inviteSupplier(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/supplier-requests/${id}/invite`, { method: 'POST', body: JSON.stringify(body) });
}
export async function approveSupplierRequest(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/supplier-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectSupplierRequest(id: string, body: { reason: string }) {
  return fetchAPI(`/university/supplier-requests/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- MATERIALITY ----
export async function getMaterialityAssessments(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/materiality?${q}`);
}
export async function getMaterialityById(id: string) {
  return fetchAPI(`/university/materiality/${id}`);
}
export async function createMateriality(body: Record<string, unknown>) {
  return fetchAPI('/university/materiality', { method: 'POST', body: JSON.stringify(body) });
}
export async function getMaterialitySummary(id: string) {
  return fetchAPI(`/university/materiality/${id}/summary`);
}
export async function inviteStakeholder(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/materiality/${id}/invite`, { method: 'POST', body: JSON.stringify(body) });
}
export async function closeMateriality(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/materiality/${id}/close`, { method: 'POST', body: JSON.stringify(body) });
}
export async function reopenMateriality(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/materiality/${id}/reopen`, { method: 'POST', body: JSON.stringify(body) });
}
export async function approveMateriality(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/materiality/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function revokeInvite(inviteId: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/invites/${inviteId}/revoke`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- INITIATIVES ----
export async function getInitiatives(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/initiatives?${q}`);
}
export async function getInitiativeById(id: string) {
  return fetchAPI(`/university/initiatives/${id}`);
}
export async function createInitiative(body: Record<string, unknown>) {
  return fetchAPI('/university/initiatives', { method: 'POST', body: JSON.stringify(body) });
}
export async function updateInitiative(id: string, body: Record<string, unknown>) {
  return fetchAPI(`/university/initiatives/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---- PCF STUDIES ----
export async function getPcfStudies(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/pcf-studies?${q}`);
}
export async function getPcfStudyById(id: string) {
  return fetchAPI(`/university/pcf-studies/${id}`);
}
export async function createPcfStudy(body: Record<string, unknown>) {
  return fetchAPI('/university/pcf-studies', { method: 'POST', body: JSON.stringify(body) });
}
export async function previewPcf(body: Record<string, unknown>) {
  return fetchAPI('/university/pcf-studies/preview', { method: 'POST', body: JSON.stringify(body) });
}
export async function submitPcfStudy(id: string) {
  return fetchAPI(`/university/pcf-studies/${id}/submit`, { method: 'POST', body: '{}' });
}
export async function approvePcfStudy(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/pcf-studies/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectPcfStudy(id: string, body: { reason: string }) {
  return fetchAPI(`/university/pcf-studies/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- UNIVERSITY REPORTS ----
export async function getUniversityReports(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/reports?${q}`);
}
export async function getUniversityReportById(id: string) {
  return fetchAPI(`/university/reports/${id}`);
}
export async function createUniversityReport(body: Record<string, unknown>) {
  return fetchAPI('/university/reports', { method: 'POST', body: JSON.stringify(body) });
}
export async function approveUniversityReport(id: string, body: Record<string, unknown> = {}) {
  return fetchAPI(`/university/reports/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}
export async function rejectUniversityReport(id: string, body: { reason: string }) {
  return fetchAPI(`/university/reports/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });
}
export function getReportExportUrl(id: string, format: 'json' | 'csv' | 'html' = 'json') {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  return `${apiUrl()}/university/reports/${id}/export?format=${format}`;
}

// ---- DEPARTMENTS ----
export async function getDepartments(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/u_departments?${q}`);
}

// ---- PERIODS ----
export async function getPeriods(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/periods?${q}`);
}

// ---- UNIVERSITY TARGETS ----
export async function getUniversityTargets(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/targets?${q}`);
}
export async function createUniversityTarget(body: Record<string, unknown>) {
  return fetchAPI('/university/targets', { method: 'POST', body: JSON.stringify(body) });
}

// ---- CAMPUSES ----
export async function getUniversityCampuses(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/university/campuses?${q}`);
}
export async function createUniversityCampus(body: Record<string, unknown>) {
  return fetchAPI('/university/campuses', { method: 'POST', body: JSON.stringify(body) });
}

// ==========================================
// ACCOUNT RECOVERY (public - no auth needed)
// POST /api/v2/account/recover  { tenantId, email }
// POST /api/v2/account/complete { token, newPassword }
// ==========================================
export async function requestPasswordRecovery(body: { tenantId: string; email: string }) {
  const url = apiUrl();
  const res = await fetch(`${url}/account/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}

export async function completePasswordRecovery(body: { token: string; newPassword: string }) {
  const url = apiUrl();
  const res = await fetch(`${url}/account/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}

// ==========================================
// ADMIN - USER MANAGEMENT (operations router)
// ==========================================
export async function getUsers(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/operations/users?${q}`);
}

export async function createUser(body: { name: string; email: string; password: string; role: string }) {
  return fetchAPI('/operations/users', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateUser(id: string, body: Record<string, unknown>) {
  return fetchAPI(`/operations/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deactivateUser(id: string) {
  return fetchAPI(`/operations/users/${id}/deactivate`, { method: 'POST', body: '{}' });
}

// Staff invitation flow (operations)
export async function inviteStaff(body: { email: string; name: string; role: string; adminPassword: string }) {
  return fetchAPI('/operations/staff/invite', { method: 'POST', body: JSON.stringify(body) });
}

export async function getStaffInvitations(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/operations/staff/invitations?${q}`);
}

export async function revokeInvitation(id: string) {
  return fetchAPI(`/operations/staff/invitations/${id}/revoke`, { method: 'POST', body: '{}' });
}

// Change own password
export async function changePassword(body: { currentPassword: string; newPassword: string }) {
  return fetchAPI('/auth/password', { method: 'POST', body: JSON.stringify(body) });
}

// ==========================================
// V2 DOCUMENT UPLOAD (X-Filename header pattern)
// POST /api/v2/documents/upload
// ==========================================
export async function uploadDocumentV2(file: File) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  const encoded = encodeURIComponent(file.name);
  const res = await fetch(`${apiUrl()}/documents/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encoded,
    },
    body: file,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

// Request OCR on an uploaded document
export async function requestOcr(documentId: string) {
  return fetchAPI(`/operations/documents/${documentId}/ocr`, { method: 'POST', body: '{}' });
}

// Get OCR runs list
export async function getOcrRuns(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/operations/ocr?${q}`);
}

// Get documents list (V2 operations)
export async function getDocumentsV2(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params);
  return fetchAPI(`/operations/documents?${q}`);
}

// Excel/CSV batch upload (ingestion endpoint)
export async function uploadBatchCsv(file: File) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  const tenantId = typeof window !== 'undefined' ? (localStorage.getItem('tenantId') ?? process.env.NEXT_PUBLIC_TENANT_ID ?? '') : '';
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${apiUrl()}/university/imports/csv/preview`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}
