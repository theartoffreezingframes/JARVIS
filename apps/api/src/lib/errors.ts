import type { FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('bad_request', message, details);
  }

  static unauthorized(message = 'Sign in to continue'): AppError {
    return new AppError('unauthorized', message);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('forbidden', message);
  }

  static notFound(message = 'Not found'): AppError {
    return new AppError('not_found', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('conflict', message, details);
  }
}

/** Validates input and turns failures into a single, predictable 400 shape. */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  message = 'Invalid request',
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw AppError.badRequest(message, { issues });
}

export function serializeError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { error: error.code, message: error.message, details: error.details ?? undefined },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'bad_request',
        message: 'Invalid request',
        details: { issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    };
  }
  // Unique-constraint style errors from SQLite surface as 409s rather than 500s.
  const maybeSqlite = error as { code?: string; message?: string };
  if (maybeSqlite?.code === 'SQLITE_CONSTRAINT_UNIQUE' || maybeSqlite?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return { status: 409, body: { error: 'conflict', message: 'That value is already taken' } };
  }
  if (maybeSqlite?.code?.startsWith('SQLITE_CONSTRAINT')) {
    return { status: 400, body: { error: 'bad_request', message: maybeSqlite.message ?? 'Invalid data' } };
  }
  if (maybeSqlite?.code === 'rate_limited') {
    return {
      status: 429,
      body: { error: 'rate_limited', message: maybeSqlite.message ?? 'Too many attempts. Please try again in a moment.' },
    };
  }
  // Framework-level failures (bad JSON, unsupported media type, oversized body)
  // already carry a status. Honour the client-facing 4xx instead of masking it
  // as a server fault, but never leak an internal message.
  const fastifyStatus = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
    ? (error as { statusCode: number }).statusCode
    : undefined;
  if (fastifyStatus && fastifyStatus >= 400 && fastifyStatus < 500) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fastifyStatus === 413) {
      return { status: 413, body: { error: 'payload_too_large', message: 'That request was too large' } };
    }
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fastifyStatus === 415) {
      return { status: 415, body: { error: 'bad_request', message: 'Unsupported content type' } };
    }
    if (code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return { status: 400, body: { error: 'bad_request', message: 'A JSON body is required' } };
    }
    return { status: fastifyStatus, body: { error: 'bad_request', message: 'Invalid request' } };
  }
  return { status: 500, body: { error: 'internal', message: 'Something went wrong on our side' } };
}

export function sendError(reply: FastifyReply, error: unknown, requestId?: string): void {
  const { status, body } = serializeError(error);
  void reply.status(status).send(requestId ? { ...body, requestId } : body);
}
