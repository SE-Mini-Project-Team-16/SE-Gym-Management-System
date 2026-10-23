import { apiError } from "./errorMiddleware.js";

/**
 * REQ-SEC-02 / NFR-5 / SV-02: Role-Based Access Control (RBAC) Middleware
 * Verifies that the authenticated user possesses one of the required roles.
 * Returns 401 if unauthenticated, 403 if role is unauthorized.
 */
export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(apiError(401, "Please sign in to continue."));
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    return next(apiError(403, "You do not have access to this page."));
  };
}

export const requireRole = allowRoles;
