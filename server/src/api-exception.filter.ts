import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status === 403 && typeof body === 'object' && body && (body as { error?: unknown }).error === 'Forbidden') {
        response.status(401).json({ error: 'unauthorized' });
        return;
      }
      if (typeof body === 'object' && body && 'error' in body) {
        const code = (body as { error?: unknown }).error;
        if (typeof code === 'string') {
          response.status(status).json({ error: code });
          return;
        }
      }
      response.status(status).json({ error: status === 401 ? 'unauthorized' : 'bad_request' });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(500).json({ error: 'internal' });
  }
}
