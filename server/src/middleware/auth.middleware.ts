import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError, viErrors } from '../utils/errors.js';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: 'host' | 'player' | 'projector';
    gameId: string;
    teamId?: string;
  };
}

/**
 * Express middleware to validate bearer JWT tokens.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(viErrors.unauthorized, 401, 'UNAUTHORIZED');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      userId: string;
      role: 'host' | 'player' | 'projector';
      gameId: string;
      teamId?: string;
    };
    req.user = decoded;
    next();
  } catch (error) {
    throw new AppError(viErrors.invalidToken, 401, 'INVALID_TOKEN');
  }
}

/**
 * Express middleware helper to restrict endpoints to specific roles.
 */
export function requireRole(roles: ('host' | 'player' | 'projector')[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(viErrors.unauthorized, 401, 'UNAUTHORIZED');
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(viErrors.forbidden, 403, 'FORBIDDEN');
    }
    next();
  };
}
