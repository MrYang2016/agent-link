import { Channel } from '../entity/channel.entity';
import { Company } from '../entity/company.entity';
import { CompanyMember } from '../entity/company-member.entity';
import { Membership } from '../entity/membership.entity';
import { Message } from '../entity/message.entity';
import { User } from '../entity/user.entity';
import { WebSession } from '../entity/web-session.entity';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const typeOrmEntities = [User, Company, CompanyMember, Channel, Membership, Message, WebSession];

function databaseName(): string {
  const name = process.env.MYSQL_DATABASE || 'agent_link_test';
  if (name.length < 1) {
    throw new Error('MYSQL_DATABASE must contain only letters, digits, and underscores');
  }
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowed =
      (codePoint >= 48 && codePoint <= 57) ||
      (codePoint >= 65 && codePoint <= 90) ||
      (codePoint >= 97 && codePoint <= 122) ||
      character === '_';
    if (!allowed) {
      throw new Error('MYSQL_DATABASE must contain only letters, digits, and underscores');
    }
  }
  return name;
}

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: databaseName(),
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: true,
    logging: false,
    retryAttempts: 1,
    entities: typeOrmEntities,
    extra: {
      dateStrings: true,
    },
  };
}
