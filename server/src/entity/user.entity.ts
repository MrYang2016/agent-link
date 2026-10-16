import { Column, Entity, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn } from './column';

@Entity({ name: 'users', engine: 'InnoDB' })
export class User {
  @PrimaryColumn({ name: 'id', ...stringColumn(36, '用户 id') })
  id: string;

  @Column({ name: 'username', ...stringColumn(128, '用户名原文') })
  username: string;

  @Column({ name: 'username_key', ...stringColumn(128, '用户名小写比较键', true) })
  usernameKey: string;

  @Column({ name: 'password_hash', ...stringColumn(255, 'scrypt 密码哈希') })
  passwordHash: string;

  @Column({ name: 'token', ...stringColumn(128, '可检索的访问令牌', true) })
  token: string;

  @Column({ name: 'created_at', ...dateTimeColumn('创建时间') })
  createdAt: string;
}
