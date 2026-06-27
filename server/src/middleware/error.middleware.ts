import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, viErrors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Global Express error handling middleware.
 * Maps custom AppErrors, Zod validation errors, and general system/database
 * errors to consistent Vietnamese JSON payloads to prevent structural leakages.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.warn({ err: err.message, code: err.code, url: req.url }, 'AppError handled');
    res.status(err.statusCode).json({
      success: false,
      code: err.code || 'APP_ERROR',
      message: err.messageVi,
    });
    return;
  }

  if (err instanceof ZodError) {
    logger.warn({ err: err.errors, url: req.url }, 'Zod validation error');
    res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: viErrors.invalidInput,
      errors: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // General server / database errors
  logger.error({ err, url: req.url }, 'Unhandled server error occurred');
  res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: viErrors.serverError,
  });
}
