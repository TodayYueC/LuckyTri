import { createApp as createRuntimeApp } from "../../server/app.js";

// Domain API/UI fixtures have no account. Real authentication is exercised
// separately by auth, integration and installed-package browser tests.
export function createApp(options) {
  return createRuntimeApp({
    ...options,
    auth: {
      mount(app) {
        app.get("/api/auth/status", (_req, res) =>
          res.json({ configured: true, authenticated: true }),
        );
      },
      authorized: () => true,
      service: () => false,
    },
  });
}
