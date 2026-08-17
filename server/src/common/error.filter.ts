import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

/**
 * Render every failure as `{ error: message }`.
 *
 * Nest's default body is `{ statusCode, message, error: "Bad Request" }`, and
 * the web client reads `body.error` (web/src/lib/api/client.ts) — so without
 * this filter every failure would surface as the literal string "Bad Request"
 * instead of the message that explains what went wrong.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.BAD_REQUEST;
    response.status(status).json({ error: messageOf(exception) });
  }
}

function messageOf(exception: unknown): string {
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (typeof body === "string") return body;
    const message = (body as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.join(", ");
    if (message) return message;
  }
  return exception instanceof Error ? exception.message : "unexpected error";
}
