import { Column, Entity, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn } from './column';

@Entity({ name: 'company_members', engine: 'InnoDB' })
export class CompanyMember {
  @PrimaryColumn({ name: 'company_id', ...stringColumn(64, '公司 id') })
  companyId: string;

  @PrimaryColumn({ name: 'user_id', ...stringColumn(36, '用户 id') })
  userId: string;

  @Column({ name: 'created_at', ...dateTimeColumn('加入时间') })
  createdAt: string;
}
