import { Body, ConflictException, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DEFAULT_COMPANY_ID } from '../constants';
import { sessionCookieHeader } from '../cookies';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { WebSessionGuard } from './guards/web-session.guard';
import { RequestWithUser, SessionUser } from './request-with-user';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('api/register')
  @HttpCode(201)
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ userId: string; username: string }> {
    const created = await this.auth.register(DEFAULT_COMPANY_ID, body.username, body.password);
    if ('taken' in created) throw new ConflictException({ error: 'username_taken' });
    response.setHeader('Set-Cookie', sessionCookieHeader(created.sessionId));
    return { userId: created.userId, username: created.username };
  }

  @Post('api/login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ userId: string; username: string }> {
    const signedIn = await this.auth.login(body.username, body.password);
    if (!signedIn) throw new UnauthorizedException({ error: 'invalid_credentials' });
    response.setHeader('Set-Cookie', sessionCookieHeader(signedIn.sessionId));
    return { userId: signedIn.userId, username: signedIn.username };
  }

  @Get('api/me')
  @UseGuards(WebSessionGuard)
  me(@Req() request: RequestWithUser): { userId: string; username: string; token: string } {
    const user = request.user as SessionUser;
    return { userId: user.id, username: user.username, token: user.token };
  }
}
