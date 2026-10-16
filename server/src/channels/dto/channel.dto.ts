import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Validate } from 'class-validator';
import {
  ChannelDescriptionConstraint,
  ChannelIdConstraint,
  ChannelNameConstraint,
  MemberQueryConstraint,
  MessageBodyConstraint,
  RecipientConstraint,
} from '../../dto/constraints';

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pageNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') return 1;
  const page = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

export class ListChannelsQueryDto {
  @ApiProperty({ description: '名称或描述子串', required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimmed(value))
  q?: string;

  @ApiProperty({ description: '页码，从 1 开始', required: false })
  @IsOptional()
  @Transform(({ value }) => pageNumber(value))
  page?: number;
}

export class CreateChannelDto {
  @ApiProperty({ description: '频道 id' })
  @Validate(ChannelIdConstraint)
  id: string;

  @ApiProperty({ description: '频道名称' })
  @Validate(ChannelNameConstraint)
  name: string;

  @ApiProperty({ description: '频道描述' })
  @Validate(ChannelDescriptionConstraint)
  description: string;
}

export class ChannelParamsDto {
  @ApiProperty({ description: '频道 id' })
  @Validate(ChannelIdConstraint)
  channelId: string;
}

export class SearchMembersQueryDto {
  @ApiProperty({ description: '成员用户名子串' })
  @Transform(({ value }) => trimmed(value))
  @Validate(MemberQueryConstraint)
  q: string;
}

export class SendMessageDto {
  @ApiProperty({ description: '接收者用户 id' })
  @Validate(RecipientConstraint)
  recipientUserId: string;

  @ApiProperty({ description: '消息正文' })
  @Validate(MessageBodyConstraint)
  body: string;
}
