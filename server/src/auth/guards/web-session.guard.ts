import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { readCookie, SESSION_COOKIE } from '../../cookies';
import { User } from '../../entity/user.entity';
import { WebSession } from '../../entity/web-session.entity';
import { RequestWithUser } from '../request-with-user';

@Injectable()
export class WebSessionGuard implements CanActivate {
  constructor(
    @InjectRepository(WebSession) private readonly sessions: Repository<WebSession>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const sessionId = readCookie(request, SESSION_COOKIE);
    if (!sessionId) return false;
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) return false;
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user) return false;
    request.user = { id: user.id, username: user.username, token: user.token };
    return true;
  }
}
