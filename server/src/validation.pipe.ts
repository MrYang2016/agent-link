import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

function validationErrorCode(errors: ValidationError[]): string {
  for (const error of errors) {
    if (error.children && error.children.length > 0) {
      const nested = validationErrorCode(error.children);
      if (nested.startsWith('invalid_')) return nested;
    }
    for (const message of Object.values(error.constraints ?? {})) {
      if (message.startsWith('invalid_')) return message;
    }
  }
  return 'bad_request';
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) => new BadRequestException({ error: validationErrorCode(errors) }),
  });
}
