export type GoogleAccount = {
  id: string;
  label: string;
  email: string;
  grantedScopes: string[];
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
};

const LABEL_RE = /^[a-z0-9 \-]{1,50}$/;

export function validateAccountLabelClient(raw: string): { valid: boolean; error?: string; normalized: string } {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { valid: false, error: "Account label is required.", normalized };
  }
  if (normalized === "both") {
    return { valid: false, error: "The label 'both' is reserved for multi-inbox queries.", normalized };
  }
  if (normalized.length > 50) {
    return { valid: false, error: "Account label must be 50 characters or fewer.", normalized };
  }
  if (!LABEL_RE.test(normalized)) {
    return {
      valid: false,
      error: "Account label must contain only lowercase letters, numbers, spaces, and hyphens.",
      normalized,
    };
  }
  return { valid: true, normalized };
}

export async function fetchAccounts(): Promise<GoogleAccount[]> {
  const response = await fetch("/api/accounts", {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorPayload?.error || "Failed to load Google accounts.");
  }
  const data = (await response.json()) as { accounts?: GoogleAccount[] };
  return data.accounts ?? [];
}

export async function renameAccount(oldLabel: string, newLabel: string): Promise<void> {
  const validation = validateAccountLabelClient(newLabel);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const response = await fetch(`/api/accounts/${encodeURIComponent(oldLabel)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newLabel: validation.normalized }),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorPayload?.error || "Failed to rename account.");
  }
}

export async function disconnectAccount(label: string): Promise<void> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(label)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorPayload?.error || "Failed to disconnect account.");
  }
}

