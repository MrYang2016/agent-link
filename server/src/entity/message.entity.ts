import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { dateTimeColumn, stringColumn, textColumn } from './column';

@Entity({ name: 'messages', engine: 'InnoDB' })
@Index('idx_messages_queue', ['companyId', 'channelId', 'recipientUserId', 'createdAt', 'id'])
export class Message {
  @PrimaryColumn({ name: 'id', ...stringColumn(36, '消息 id') })
  id: string;

  @Column({ name: 'company_id', ...stringColumn(64, '公司 id') })
  companyId: string;

  @Column({ name: 'channel_id', ...stringColumn(64, '频道 id') })
  channelId: string;

  @Column({ name: 'sender_user_id', ...stringColumn(36, '发送者用户 id') })
  senderUserId: string;

  @Column({ name: 'recipient_user_id', ...stringColumn(36, '接收者用户 id') })
  recipientUserId: string;

  @Column({ name: 'body', ...textColumn('消息正文') })
  body: string;

  @Column({ name: 'created_at', ...dateTimeColumn('创建时间') })
  createdAt: string;
}
