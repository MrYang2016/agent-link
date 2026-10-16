import { Column, Entity, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn } from './column';

@Entity({ name: 'memberships', engine: 'InnoDB' })
export class Membership {
  @PrimaryColumn({ name: 'company_id', ...stringColumn(64, '公司 id') })
  companyId: string;

  @PrimaryColumn({ name: 'channel_id', ...stringColumn(64, '频道 id') })
  channelId: string;

  @PrimaryColumn({ name: 'user_id', ...stringColumn(36, '用户 id') })
  userId: string;

  @Column({ name: 'created_at', ...dateTimeColumn('加入时间') })
  createdAt: string;
}
