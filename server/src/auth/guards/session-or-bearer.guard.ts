import { CanActivate, ExecutionContext, Inject, Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BearerAuthGuard } from './bearer-auth.guard';
import { WebSessionGuard } from './web-session.guard';

const GUARDS: Type<CanActivate>[] = [WebSessionGuard, BearerAuthGuard];

@Injectable()
export class SessionOrBearerGuard implements CanActivate {
  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    for (const Guard of GUARDS) {
      const guard = this.moduleRef.get(Guard, { strict: false });
      try {
        if (guard && (await guard.canActivate(context))) return true;
      } catch {
        // 这一路凭证失败就试下一种，两种都失败才拒绝。
      }
    }
    return false;
  }
}
