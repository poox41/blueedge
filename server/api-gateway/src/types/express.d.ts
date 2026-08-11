import type { BlueEdgeAuthContext } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: BlueEdgeAuthContext;
    }
  }
}

export {};
