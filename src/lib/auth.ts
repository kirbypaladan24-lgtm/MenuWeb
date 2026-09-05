// Coffee++ Booth Console — NO AUTH.
//
// The console runs only on the staff's booth laptop (localhost), so there is
// no sign-in page, no accounts, and no session tokens: every request is
// treated as the booth operator with full (ADMIN) access.
//
// Do NOT host this app on the public internet — nothing here is protected.
// The customer site (coffeepp-client) is the publishable half.

export interface Session {
  name: string;
  role: "ADMIN";
}

const OPERATOR: Session = { name: "Booth Operator", role: "ADMIN" };

/**
 * Role gate kept for API-route compatibility — always grants ADMIN access.
 * (Previously enforced staff sessions; the login system was removed because
 * the console never leaves the booth laptop.)
 */
export function requireRole(_req: Request, _min?: string): Session {
  return OPERATOR;
}
