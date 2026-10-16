import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { nextCreatedAt } from '../clock';
import { isDuplicateEntry } from '../db-error';
import { Company } from '../entity/company.entity';
import { CompanyMember } from '../entity/company-member.entity';
import { User } from '../entity/user.entity';
import { WebSession } from '../entity/web-session.entity';
import { hashPassword, verifyPassword } from '../password';
import { usernameKey } from '../validators';

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(WebSession) private readonly sessions: Repository<WebSession>,
  ) {}

  async register(
    companyId: string,
    username: string,
    password: string,
  ): Promise<{ userId: string; username: string; sessionId: string } | { taken: true }> {
    const userId = randomUUID();
    const createdAt = nextCreatedAt();
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('hex');
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.ensureCompany(companyId, manager);
        await manager.insert(User, {
          id: userId,
          username,
          usernameKey: usernameKey(username),
          passwordHash,
          token,
          createdAt,
        });
        await manager.insert(CompanyMember, { companyId, userId, createdAt });
      });
    } catch (error) {
      if (isDuplicateEntry(error)) return { taken: true };
      throw error;
    }
    const sessionId = await this.createSession(userId);
    return { userId, username, sessionId };
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ userId: string; username: string; sessionId: string } | null> {
    const user = await this.users.findOne({ where: { usernameKey: usernameKey(username) } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
    const sessionId = await this.createSession(user.id);
    return { userId: user.id, username: user.username, sessionId };
  }

  private async createSession(userId: string): Promise<string> {
    const id = randomBytes(32).toString('hex');
    await this.sessions.insert({ id, userId, createdAt: nextCreatedAt() });
    return id;
  }

  private async ensureCompany(companyId: string, manager: EntityManager): Promise<void> {
    const existing = await manager.findOne(Company, { where: { id: companyId } });
    if (existing) return;
    try {
      await manager.insert(Company, { id: companyId });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
    }
  }
}
