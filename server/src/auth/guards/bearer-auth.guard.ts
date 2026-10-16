import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entity/user.entity';
import { RequestWithUser } from '../request-with-user';

const BEARER = 'Bearer ';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith(BEARER)) return false;
    const token = header.slice(BEARER.length).trim();
    if (token.length === 0) return false;
    const user = await this.users.findOne({ where: { token } });
    if (!user) return false;
    request.user = { id: user.id, username: user.username, token: user.token };
    return true;
  }
}
