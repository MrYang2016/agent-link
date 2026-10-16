import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn, textColumn } from './column';

@Entity({ name: 'channels', engine: 'InnoDB' })
@Index('idx_channels_list', ['companyId', 'createdAt', 'id'])
export class Channel {
  @PrimaryColumn({ name: 'company_id', ...stringColumn(64, '公司 id') })
  companyId: string;

  @PrimaryColumn({ name: 'id', ...stringColumn(64, '频道 id') })
  id: string;

  @Column({ name: 'name', ...stringColumn(320, '频道名称') })
  name: string;

  @Column({ name: 'description', ...textColumn('频道描述') })
  description: string;

  @Column({ name: 'created_at', ...dateTimeColumn('创建时间') })
  createdAt: string;
}
