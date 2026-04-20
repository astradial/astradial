// Dev-only mock mode flag. Strict opt-in via NEXT_PUBLIC_USE_MOCK=1.
// Hard-gated on NODE_ENV !== "production" so a stray env var in prod is a no-op.

export function isMockMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_USE_MOCK === "1";
}
