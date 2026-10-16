import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { nextCreatedAt, toIsoTimestamp } from '../clock';
import { isDuplicateEntry } from '../db-error';
import { Channel } from '../entity/channel.entity';
import { Membership } from '../entity/membership.entity';
import { Message } from '../entity/message.entity';
import { User } from '../entity/user.entity';
import { EventHub } from '../events/event-hub';
import { literalIncludes } from '../text-match';

export interface PulledMessage {
  id: string;
  channelId: string;
  senderUserId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
}

@Injectable()
export class ChannelService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(Membership) private readonly memberships: Repository<Membership>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(EventHub) private readonly events: EventHub,
  ) {}

  async searchChannels(
    companyId: string,
    q: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Array<{ id: string; name: string; description: string }>; total: number }> {
    const rows = await this.channels.find({
      where: { companyId },
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    const matched = q.length === 0 ? rows : rows.filter((row) => literalIncludes(row.name, q) || literalIncludes(row.description, q));
    const start = (page - 1) * pageSize;
    return {
      total: matched.length,
      items: matched.slice(start, start + pageSize).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
      })),
    };
  }

  async createChannel(input: {
    companyId: string;
    id: string;
    name: string;
    description: string;
    userId: string;
  }): Promise<'ok' | 'exists'> {
    const createdAt = nextCreatedAt();
    try {
      await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(Channel, { where: { companyId: input.companyId, id: input.id } });
        if (existing) {
          throw new AlreadyExists();
        }
        await manager.insert(Channel, {
          companyId: input.companyId,
          id: input.id,
          name: input.name,
          description: input.description,
          createdAt,
        });
        await manager.insert(Membership, {
          companyId: input.companyId,
          channelId: input.id,
          userId: input.userId,
          createdAt,
        });
      });
    } catch (error) {
      if (error instanceof AlreadyExists || isDuplicateEntry(error)) return 'exists';
      throw error;
    }
    return 'ok';
  }

  async joinChannel(companyId: string, channelId: string, userId: string): Promise<'joined' | 'already' | 'missing'> {
    const channel = await this.channels.findOne({ where: { companyId, id: channelId } });
    if (!channel) return 'missing';
    try {
      await this.memberships.insert({ companyId, channelId, userId, createdAt: nextCreatedAt() });
      return 'joined';
    } catch (error) {
      if (isDuplicateEntry(error)) return 'already';
      throw error;
    }
  }

  async isMember(companyId: string, channelId: string, userId: string): Promise<boolean> {
    const count = await this.memberships.count({ where: { companyId, channelId, userId } });
    return count > 0;
  }

  async searchMembers(
    companyId: string,
    channelId: string,
    q: string,
  ): Promise<Array<{ userId: string; username: string }>> {
    const memberships = await this.memberships.find({ where: { companyId, channelId } });
    if (memberships.length === 0) return [];
    const users = await this.users.find({ where: { id: In(memberships.map((row) => row.userId)) } });
    return users
      .filter((user) => literalIncludes(user.username, q, true))
      .sort((left, right) => (left.username < right.username ? -1 : left.username > right.username ? 1 : 0))
      .map((user) => ({ userId: user.id, username: user.username }));
  }

  async sendMessage(input: {
    companyId: string;
    channelId: string;
    senderUserId: string;
    recipientUserId: string;
    body: string;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    await this.messages.insert({
      id,
      companyId: input.companyId,
      channelId: input.channelId,
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      body: input.body,
      createdAt: nextCreatedAt(),
    });
    this.events.publish(input.recipientUserId, input.channelId);
    return { id };
  }

  async listPendingChannelIds(companyId: string, recipientUserId: string): Promise<string[]> {
    const rows = await this.messages.find({
      where: { companyId, recipientUserId },
      order: { channelId: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    const channelIds: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.channelId)) continue;
      seen.add(row.channelId);
      channelIds.push(row.channelId);
    }
    return channelIds;
  }

  async pullMessages(companyId: string, channelId: string, recipientUserId: string): Promise<PulledMessage[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.find(Message, {
        where: { companyId, channelId, recipientUserId },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (rows.length === 0) return [];
      const senders = await manager.find(User, { where: { id: In(rows.map((row) => row.senderUserId)) } });
      const names = new Map(senders.map((user) => [user.id, user.username]));
      await manager.delete(Message, { companyId, id: In(rows.map((row) => row.id)) });
      return rows.map((row) => ({
        id: row.id,
        channelId: row.channelId,
        senderUserId: row.senderUserId,
        senderUsername: names.get(row.senderUserId) ?? '',
        body: row.body,
        createdAt: toIsoTimestamp(row.createdAt),
      }));
    });
  }
}

class AlreadyExists extends Error {}
