import type { RequestActor } from "../middleware/auth";

declare global {
  namespace Express {
    interface Request {
      actor?: RequestActor;
    }
  }
}

export {};
