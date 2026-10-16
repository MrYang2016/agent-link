import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn } from './column';

@Entity({ name: 'web_sessions', engine: 'InnoDB' })
export class WebSession {
  @PrimaryColumn({ name: 'id', ...stringColumn(64, '网站会话 id') })
  id: string;

  @Index('idx_web_sessions_user')
  @Column({ name: 'user_id', ...stringColumn(36, '用户 id') })
  userId: string;

  @Column({ name: 'created_at', ...dateTimeColumn('创建时间') })
  createdAt: string;
}
