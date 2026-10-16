import { Entity, PrimaryColumn } from 'typeorm';
import { stringColumn } from './column';

@Entity({ name: 'companies', engine: 'InnoDB' })
export class Company {
  @PrimaryColumn({ name: 'id', ...stringColumn(64, '公司 id') })
  id: string;
}
