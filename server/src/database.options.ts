import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Channel } from './entity/channel.entity';
import { Company } from './entity/company.entity';
import { CompanyMember } from './entity/company-member.entity';
import { Membership } from './entity/membership.entity';
import { Message } from './entity/message.entity';
import { User } from './entity/user.entity';
import { WebSession } from './entity/web-session.entity';

export const entities = [User, Company, CompanyMember, Channel, Membership, Message, WebSession];

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE || 'agent_link_test',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: true,
    logging: false,
    retryAttempts: 1,
    entities,
    extra: { dateStrings: true },
  };
}
