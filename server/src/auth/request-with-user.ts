import type { Request } from 'express';

export interface SessionUser {
  id: string;
  username: string;
  token: string;
}

export type RequestWithUser = Request & { user?: SessionUser };
