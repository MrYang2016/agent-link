import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BearerAuthGuard } from '../auth/guards/bearer-auth.guard';
import { SessionOrBearerGuard } from '../auth/guards/session-or-bearer.guard';
import { RequestWithUser, SessionUser } from '../auth/request-with-user';
import { DEFAULT_COMPANY_ID } from '../constants';
import { ChannelService } from './channels.service';
import { ChannelParamsDto, CreateChannelDto, ListChannelsQueryDto, SearchMembersQueryDto, SendMessageDto } from './dto/channel.dto';

const PAGE_SIZE = 20;

@Controller()
export class ChannelController {
  constructor(@Inject(ChannelService) private readonly channels: ChannelService) {}

  @Get('api/channels')
  @UseGuards(SessionOrBearerGuard)
  async list(@Query() query: ListChannelsQueryDto): Promise<{
    items: Array<{ id: string; name: string; description: string }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = query.page ?? 1;
    const result = await this.channels.searchChannels(DEFAULT_COMPANY_ID, query.q ?? '', page, PAGE_SIZE);
    return { items: result.items, page, pageSize: PAGE_SIZE, total: result.total };
  }

  @Post('api/channels')
  @HttpCode(201)
  @UseGuards(BearerAuthGuard)
  async create(
    @Req() request: RequestWithUser,
    @Body() body: CreateChannelDto,
  ): Promise<{ id: string; name: string; description: string }> {
    const user = request.user as SessionUser;
    const created = await this.channels.createChannel({
      companyId: DEFAULT_COMPANY_ID,
      id: body.id,
      name: body.name,
      description: body.description,
      userId: user.id,
    });
    if (created === 'exists') throw new ConflictException({ error: 'channel_exists' });
    return { id: body.id, name: body.name, description: body.description };
  }

  @Post('api/channels/:channelId/join')
  @HttpCode(200)
  @UseGuards(BearerAuthGuard)
  async join(
    @Req() request: RequestWithUser,
    @Param() params: ChannelParamsDto,
  ): Promise<{ channelId: string; userId: string }> {
    const user = request.user as SessionUser;
    const joined = await this.channels.joinChannel(DEFAULT_COMPANY_ID, params.channelId, user.id);
    if (joined === 'missing') throw new NotFoundException({ error: 'channel_not_found' });
    return { channelId: params.channelId, userId: user.id };
  }

  @Get('api/channels/:channelId/members')
  @UseGuards(BearerAuthGuard)
  async members(
    @Req() request: RequestWithUser,
    @Param() params: ChannelParamsDto,
    @Query() query: SearchMembersQueryDto,
  ): Promise<Array<{ userId: string; username: string }>> {
    const user = request.user as SessionUser;
    const member = await this.channels.isMember(DEFAULT_COMPANY_ID, params.channelId, user.id);
    if (!member) throw new ForbiddenException({ error: 'sender_not_member' });
    return this.channels.searchMembers(DEFAULT_COMPANY_ID, params.channelId, query.q);
  }

  @Post('api/channels/:channelId/messages')
  @HttpCode(201)
  @UseGuards(BearerAuthGuard)
  async send(
    @Req() request: RequestWithUser,
    @Param() params: ChannelParamsDto,
    @Body() body: SendMessageDto,
  ): Promise<{ id: string }> {
    const user = request.user as SessionUser;
    const senderIsMember = await this.channels.isMember(DEFAULT_COMPANY_ID, params.channelId, user.id);
    if (!senderIsMember) throw new ForbiddenException({ error: 'sender_not_member' });
    const recipientIsMember = await this.channels.isMember(DEFAULT_COMPANY_ID, params.channelId, body.recipientUserId);
    if (!recipientIsMember) throw new ConflictException({ error: 'recipient_not_member' });
    return this.channels.sendMessage({
      companyId: DEFAULT_COMPANY_ID,
      channelId: params.channelId,
      senderUserId: user.id,
      recipientUserId: body.recipientUserId,
      body: body.body,
    });
  }

  @Post('api/channels/:channelId/pull')
  @HttpCode(200)
  @UseGuards(BearerAuthGuard)
  async pull(
    @Req() request: RequestWithUser,
    @Param() params: ChannelParamsDto,
  ): Promise<{ messages: Awaited<ReturnType<ChannelService['pullMessages']>> }> {
    const user = request.user as SessionUser;
    const member = await this.channels.isMember(DEFAULT_COMPANY_ID, params.channelId, user.id);
    if (!member) throw new ForbiddenException({ error: 'sender_not_member' });
    const messages = await this.channels.pullMessages(DEFAULT_COMPANY_ID, params.channelId, user.id);
    return { messages };
  }
}
