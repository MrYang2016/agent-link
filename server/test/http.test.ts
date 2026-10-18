import 'reflect-metadata';
import http from 'http';
import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, type EntityTarget, type ObjectLiteral } from 'typeorm';
import { createApp } from '../src/main';
import { Channel } from '../src/entity/channel.entity';
import { Company } from '../src/entity/company.entity';
import { CompanyMember } from '../src/entity/company-member.entity';
import { Membership } from '../src/entity/membership.entity';
import { Message } from '../src/entity/message.entity';
import { User } from '../src/entity/user.entity';
import { WebSession } from '../src/entity/web-session.entity';

const ENTITIES = [User, Company, CompanyMember, Channel, Membership, Message, WebSession];
const PASSWORD = 'password-ok';

jest.setTimeout(20000);

function openDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE || 'agent_link_test',
    entities: ENTITIES,
    synchronize: false,
    logging: false,
  });
  return dataSource.initialize();
}

function column(dataSource: DataSource, entity: EntityTarget<ObjectLiteral>, databaseName: string) {
  const found = dataSource.getMetadata(entity).findColumnWithDatabaseName(databaseName);
  expect(found).toBeTruthy();
  return found!;
}

function columnValue(
  dataSource: DataSource,
  entity: EntityTarget<ObjectLiteral>,
  row: object,
  databaseName: string,
): unknown {
  return (row as Record<string, unknown>)[column(dataSource, entity, databaseName).propertyName];
}

async function countWhere(
  dataSource: DataSource,
  entity: EntityTarget<ObjectLiteral>,
  databaseValues: Record<string, string>,
): Promise<number> {
  const where: Record<string, string> = {};
  for (const [databaseName, value] of Object.entries(databaseValues)) {
    where[column(dataSource, entity, databaseName).propertyName] = value;
  }
  return dataSource.getRepository(entity).count({ where });
}

let app: INestApplication;
let server: Server;
let dataSource: DataSource;

function cookieHeader(response: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = response.headers['set-cookie'];
  if (!raw) throw new Error('expected Set-Cookie');
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts.map((part) => part.split(';')[0]).join('; ');
}

async function register(username: string, password = PASSWORD) {
  return request(server).post('/api/register').send({ username, password });
}

async function login(username: string, password = PASSWORD) {
  return request(server).post('/api/login').send({ username, password });
}

async function sessionFor(username: string) {
  const registered = await register(username);
  expect(registered.status).toBe(201);
  const logged = await login(username);
  expect(logged.status).toBe(200);
  const cookie = cookieHeader(logged);
  const me = await request(server).get('/api/me').set('Cookie', cookie);
  expect(me.status).toBe(200);
  return {
    userId: String(registered.body.userId),
    username,
    cookie,
    token: String(me.body.token),
  };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createChannel(token: string, id: string, name: string, description: string) {
  return request(server).post('/api/channels').set(bearer(token)).send({ id, name, description });
}

async function joinChannel(token: string, channelId: string) {
  return request(server).post(`/api/channels/${channelId}/join`).set(bearer(token));
}

async function sendMessage(token: string, channelId: string, recipientUserId: string, body: string) {
  return request(server)
    .post(`/api/channels/${channelId}/messages`)
    .set(bearer(token))
    .send({ recipientUserId, body });
}

async function pull(token: string, channelId: string) {
  return request(server).post(`/api/channels/${channelId}/pull`).set(bearer(token));
}

async function members(token: string, channelId: string, q?: string) {
  const req = request(server).get(`/api/channels/${channelId}/members`).set(bearer(token));
  if (q !== undefined) req.query({ q });
  return req;
}

async function withProbe<T>(fn: (probe: DataSource) => Promise<T>): Promise<T> {
  const probe = await openDataSource();
  try {
    return await fn(probe);
  } finally {
    if (probe.isInitialized) await probe.destroy();
  }
}

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
  server = app.getHttpServer();
  dataSource = await openDataSource();
}, 30000);

afterAll(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
  if (app) await app.close();
});

beforeEach(async () => {
  for (const entity of [Message, Membership, WebSession, CompanyMember, Channel, User]) {
    await dataSource.getRepository(entity).clear();
  }
});

describe('accounts', () => {
  it('returns 409 username_taken when the username is already registered', async () => {
    expect((await register('alice')).status).toBe(201);
    const again = await register('alice');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('username_taken');
  });

  it('returns 409 username_taken when only the letter case differs', async () => {
    expect((await register('Alice')).status).toBe(201);
    const again = await register('alice');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('username_taken');
  });

  it('stores the username with its original casing', async () => {
    const registered = await register('Alice');
    expect(registered.status).toBe(201);
    const idColumn = column(dataSource, User, 'id');
    const user = await dataSource.getRepository(User).findOne({
      where: { [idColumn.propertyName]: registered.body.userId },
    });
    expect(user).toBeTruthy();
    expect(columnValue(dataSource, User, user!, 'username')).toBe('Alice');
  });

  it('returns the registered userId from GET /api/me after login', async () => {
    const registered = await register('me-id');
    expect(registered.status).toBe(201);
    const logged = await login('me-id');
    expect(logged.status).toBe(200);
    const me = await request(server).get('/api/me').set('Cookie', cookieHeader(logged));
    expect(me.status).toBe(200);
    expect(me.body.userId).toBe(registered.body.userId);
  });

  it('returns a non-empty token from GET /api/me after login', async () => {
    expect((await register('me-token')).status).toBe(201);
    const logged = await login('me-token');
    expect(logged.status).toBe(200);
    const me = await request(server).get('/api/me').set('Cookie', cookieHeader(logged));
    expect(me.status).toBe(200);
    expect(typeof me.body.token).toBe('string');
    expect(me.body.token.length).toBeGreaterThan(0);
  });

  it('logs in when the username case differs and keeps the stored username', async () => {
    const registered = await register('CaseUser');
    const logged = await login('caseuser');
    expect(logged.status).toBe(200);
    const me = await request(server).get('/api/me').set('Cookie', cookieHeader(logged));
    expect(me.body.userId).toBe(registered.body.userId);
    expect(me.body.username).toBe('CaseUser');
  });

  it('returns 401 invalid_credentials for a wrong password', async () => {
    expect((await register('wrong-pw')).status).toBe(201);
    const logged = await login('wrong-pw', 'not-the-password');
    expect(logged.status).toBe(401);
    expect(logged.body.error).toBe('invalid_credentials');
  });

  it('returns 401 invalid_credentials for an unknown username', async () => {
    const logged = await login('missing-user');
    expect(logged.status).toBe(401);
    expect(logged.body.error).toBe('invalid_credentials');
  });

  it('returns 401 unauthorized from GET /api/me without a session', async () => {
    const me = await request(server).get('/api/me');
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('unauthorized');
  });

  it('sets a session cookie on register that authorizes GET /api/me', async () => {
    const registered = await register('cookie-user');
    expect(registered.status).toBe(201);
    expect(registered.body.userId).toEqual(expect.any(String));
    expect(registered.body.username).toBe('cookie-user');
    expect(Object.hasOwn(registered.body, 'companyId')).toBe(false);
    const me = await request(server).get('/api/me').set('Cookie', cookieHeader(registered));
    expect(me.status).toBe(200);
    expect(me.body.userId).toBe(registered.body.userId);
  });

  it('stores a scrypt hash and not the password', async () => {
    const registered = await register('hash-user');
    const idColumn = column(dataSource, User, 'id');
    const user = await dataSource.getRepository(User).findOneOrFail({
      where: { [idColumn.propertyName]: registered.body.userId },
    });
    const stored = Object.values(user).filter((value) => typeof value === 'string') as string[];
    expect(stored).not.toContain(PASSWORD);
    expect(stored.some((value) => value.startsWith('scrypt$'))).toBe(true);
  });

  it('stores the token on users.token', async () => {
    const user = await sessionFor('token-column');
    const idColumn = column(dataSource, User, 'id');
    const row = await dataSource.getRepository(User).findOneOrFail({
      where: { [idColumn.propertyName]: user.userId },
    });
    expect(columnValue(dataSource, User, row, 'token')).toBe(user.token);
  });

  it('rejects a username of 201 characters with 400 and creates no user', async () => {
    const res = await register(`${'a'.repeat(200)}!`);
    expect(res.status).toBe(400);
    expect(await dataSource.getRepository(User).count()).toBe(0);
  });

  it('rejects a 7-character password with 400 and creates no user', async () => {
    const res = await register('short-pw', '1234567');
    expect(res.status).toBe(400);
    expect(await dataSource.getRepository(User).count()).toBe(0);
  });

  it('rejects a register body that includes companyId', async () => {
    const res = await request(server).post('/api/register').send({
      username: 'extra-field',
      password: PASSWORD,
      companyId: 'default',
    });
    expect(res.status).toBe(400);
    expect(await dataSource.getRepository(User).count()).toBe(0);
  });

  it('writes a company_members row for default and the new user', async () => {
    const registered = await register('member-row');
    expect(registered.status).toBe(201);
    const rows = await dataSource.getRepository(CompanyMember).find();
    const matched = rows.filter((row) => {
      const company = columnValue(dataSource, CompanyMember, row, 'company_id');
      const values = Object.values(row).map((value) => String(value));
      return company === 'default' && values.includes(String(registered.body.userId));
    });
    expect(matched).toHaveLength(1);
  });

  it('keeps a single companies row with id default', async () => {
    expect((await register('company-seed')).status).toBe(201);
    const rows = await dataSource.getRepository(Company).find();
    const ids = rows.map((row) => columnValue(dataSource, Company, row, 'id'));
    expect(ids).toEqual(['default']);
  });
});

describe('channel catalog', () => {
  it('returns 401 for GET /api/channels without a session', async () => {
    const res = await request(server).get('/api/channels');
    expect(res.status).toBe(401);
  });

  it('returns unauthorized for an anonymous channel list', async () => {
    const res = await request(server).get('/api/channels');
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 200 for GET /api/channels with only a Bearer token', async () => {
    const user = await sessionFor('bearer-list');
    const res = await request(server).get('/api/channels').set(bearer(user.token));
    expect(res.status).toBe(200);
  });

  it('rejects a channel list query that includes companyId', async () => {
    const user = await sessionFor('query-extra');
    const res = await request(server)
      .get('/api/channels')
      .query({ page: '1', companyId: 'default' })
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('finds another user channel by name', async () => {
    const owner = await sessionFor('name-owner');
    const reader = await sessionFor('name-reader');
    expect((await createChannel(owner.token, 'name-ch', 'special-name-991', 'plain words')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: 'special-name-991' }).set('Cookie', reader.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['name-ch']);
  });

  it('finds another user channel by description', async () => {
    const owner = await sessionFor('desc-owner');
    const reader = await sessionFor('desc-reader');
    expect((await createChannel(owner.token, 'desc-ch', 'listed-name', 'ticket-88421')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: 'ticket-88421' }).set('Cookie', reader.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['desc-ch']);
  });

  it('trims the search query before matching', async () => {
    const user = await sessionFor('trim-user');
    expect((await createChannel(user.token, 'trim-ch', 'special-name-991', 'plain')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: '  special-name-991  ' }).set('Cookie', user.cookie);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['trim-ch']);
  });

  it('matches % as a literal character in the name', async () => {
    const user = await sessionFor('percent-user');
    expect((await createChannel(user.token, 'pct', '100%', 'plain')).status).toBe(201);
    expect((await createChannel(user.token, 'hundredx', '100X', 'plain')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: '%' }).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['pct']);
  });

  it('matches _ as a literal character in the name', async () => {
    const user = await sessionFor('under-user');
    expect((await createChannel(user.token, 'under', 'a_b', 'plain')).status).toBe(201);
    expect((await createChannel(user.token, 'letterx', 'axb', 'plain')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: '_' }).set('Cookie', user.cookie);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['under']);
  });

  it('matches backslash as a literal character in the description', async () => {
    const user = await sessionFor('slash-user');
    expect((await createChannel(user.token, 'slashed', 'plain-a', 'a\\b')).status).toBe(201);
    expect((await createChannel(user.token, 'plainab', 'plain-b', 'ab')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: '\\' }).set('Cookie', user.cookie);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['slashed']);
  });

  it('returns 200 for a search that is not a regular expression', async () => {
    const user = await sessionFor('regex-user');
    expect((await createChannel(user.token, 'regex-ch', 'alpha', 'beta')).status).toBe(201);
    const res = await request(server).get('/api/channels').query({ q: '(' }).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('returns only id, name, and description', async () => {
    const user = await sessionFor('shape-user');
    expect((await createChannel(user.token, 'shape-ch', 'shape-name', 'shape-desc')).status).toBe(201);
    const res = await request(server).get('/api/channels').set('Cookie', user.cookie);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['description', 'id', 'name']);
  });

  it('uses pageSize 20', async () => {
    const user = await sessionFor('pagesize-user');
    expect((await createChannel(user.token, 'one-ch', 'one', 'one')).status).toBe(201);
    const res = await request(server).get('/api/channels').set('Cookie', user.cookie);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.items).toHaveLength(1);
  });

  it('returns 20 items on page 1 when more than 20 channels exist', async () => {
    const user = await sessionFor('page1-user');
    for (let index = 1; index <= 21; index += 1) {
      const id = `a${String(index).padStart(2, '0')}`;
      expect((await createChannel(user.token, id, `name-${id}`, `desc-${id}`)).status).toBe(201);
    }
    const res = await request(server).get('/api/channels').query({ page: 1 }).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(20);
  });

  it('includes the oldest of 21 channels on page 2', async () => {
    const user = await sessionFor('page2-user');
    const ids: string[] = [];
    for (let index = 1; index <= 21; index += 1) {
      const id = `b${String(index).padStart(2, '0')}`;
      ids.push(id);
      expect((await createChannel(user.token, id, `name-${id}`, `desc-${id}`)).status).toBe(201);
    }
    const res = await request(server).get('/api/channels').query({ page: 2 }).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).toContain(ids[0]);
  });

  it('lists channels newest first', async () => {
    const user = await sessionFor('order-user');
    for (const id of ['ord-a', 'ord-b', 'ord-c']) {
      expect((await createChannel(user.token, id, id, id)).status).toBe(201);
    }
    const res = await request(server).get('/api/channels').set('Cookie', user.cookie);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(['ord-c', 'ord-b', 'ord-a']);
  });

  it('leaves companyId off each channel list item', async () => {
    const user = await sessionFor('no-company');
    expect((await createChannel(user.token, 'nocompany', 'visible', 'visible')).status).toBe(201);
    const res = await request(server).get('/api/channels').set('Cookie', user.cookie);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(Object.hasOwn(item, 'companyId')).toBe(false);
    }
  });

  it('leaves companyId off GET /api/me', async () => {
    const user = await sessionFor('me-no-company');
    const me = await request(server).get('/api/me').set('Cookie', user.cookie);
    expect(Object.hasOwn(me.body, 'companyId')).toBe(false);
    expect(Object.keys(me.body).sort()).toEqual(['token', 'userId', 'username']);
  });
});

describe('membership and messages', () => {
  it('lists the creator in the channel members', async () => {
    const owner = await sessionFor('creator');
    expect((await createChannel(owner.token, 'own-ch', 'owned', 'owned')).status).toBe(201);
    const listed = await members(owner.token, 'own-ch', 'creator');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([{ userId: owner.userId, username: 'creator' }]);
  });

  it('leaves the message table empty after create', async () => {
    const owner = await sessionFor('empty-create');
    expect((await createChannel(owner.token, 'empty-ch', 'empty', 'empty')).status).toBe(201);
    expect(await countWhere(dataSource, Message, { channel_id: 'empty-ch' })).toBe(0);
  });

  it('returns 409 channel_exists for a duplicate channel id', async () => {
    const owner = await sessionFor('dup-owner');
    expect((await createChannel(owner.token, 'dup-ch', 'first', 'first')).status).toBe(201);
    const again = await createChannel(owner.token, 'dup-ch', 'second', 'second');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('channel_exists');
  });

  it('does not add another membership when the channel id already exists', async () => {
    const owner = await sessionFor('dup-member');
    const other = await sessionFor('dup-other');
    expect((await createChannel(owner.token, 'dup-mem', 'first', 'first')).status).toBe(201);
    expect((await joinChannel(other.token, 'dup-mem')).status).toBe(200);
    expect((await createChannel(owner.token, 'dup-mem', 'second', 'second')).status).toBe(409);
    const listed = await members(owner.token, 'dup-mem', 'dup');
    expect(listed.body.map((item: { userId: string }) => item.userId).sort()).toEqual(
      [other.userId, owner.userId].sort(),
    );
  });

  it('rejects an invalid channel id', async () => {
    const owner = await sessionFor('bad-id');
    const res = await createChannel(owner.token, '.bad', 'name', 'description');
    expect(res.status).toBe(400);
    expect(await countWhere(dataSource, Channel, { id: '.bad' })).toBe(0);
  });

  it('rejects a create body that includes companyId', async () => {
    const owner = await sessionFor('create-extra');
    const res = await request(server).post('/api/channels').set(bearer(owner.token)).send({
      id: 'extra-ch',
      name: 'extra',
      description: 'extra',
      companyId: 'default',
    });
    expect(res.status).toBe(400);
    expect(await countWhere(dataSource, Channel, { id: 'extra-ch' })).toBe(0);
  });

  it('returns 404 channel_not_found when joining a missing channel', async () => {
    const user = await sessionFor('join-missing');
    const res = await joinChannel(user.token, 'missing-ch');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('channel_not_found');
  });

  it('lists a user who joined', async () => {
    const owner = await sessionFor('join-owner');
    const guest = await sessionFor('join-guest');
    expect((await createChannel(owner.token, 'join-ch', 'join', 'join')).status).toBe(201);
    expect((await joinChannel(guest.token, 'join-ch')).status).toBe(200);
    const listed = await members(owner.token, 'join-ch', 'join-guest');
    expect(listed.body).toEqual([{ userId: guest.userId, username: 'join-guest' }]);
  });

  it('does not increase the message count when a user joins', async () => {
    const owner = await sessionFor('join-quiet-owner');
    const guest = await sessionFor('join-quiet-guest');
    expect((await createChannel(owner.token, 'join-quiet', 'join', 'join')).status).toBe(201);
    const before = await countWhere(dataSource, Message, { channel_id: 'join-quiet' });
    expect((await joinChannel(guest.token, 'join-quiet')).status).toBe(200);
    expect(await countWhere(dataSource, Message, { channel_id: 'join-quiet' })).toBe(before);
  });

  it('returns 200 when a member joins again', async () => {
    const owner = await sessionFor('again-owner');
    expect((await createChannel(owner.token, 'again-ch', 'again', 'again')).status).toBe(201);
    const again = await joinChannel(owner.token, 'again-ch');
    expect(again.status).toBe(200);
  });

  it('does not duplicate a membership when a member joins again', async () => {
    const owner = await sessionFor('once-owner');
    expect((await createChannel(owner.token, 'once-ch', 'once', 'once')).status).toBe(201);
    expect((await joinChannel(owner.token, 'once-ch')).status).toBe(200);
    const listed = await members(owner.token, 'once-ch', 'once-owner');
    expect(listed.body).toEqual([{ userId: owner.userId, username: 'once-owner' }]);
  });

  it('does not write a message when a member joins again', async () => {
    const owner = await sessionFor('again-quiet');
    expect((await createChannel(owner.token, 'again-quiet', 'again', 'again')).status).toBe(201);
    const before = await countWhere(dataSource, Message, { channel_id: 'again-quiet' });
    expect((await joinChannel(owner.token, 'again-quiet')).status).toBe(200);
    expect(await countWhere(dataSource, Message, { channel_id: 'again-quiet' })).toBe(before);
  });

  it('includes 张三 when members are searched with q=张', async () => {
    const zhang = await sessionFor('张三');
    const li = await sessionFor('李四');
    expect((await createChannel(zhang.token, 'zhang-ch', 'zhang', 'zhang')).status).toBe(201);
    expect((await joinChannel(li.token, 'zhang-ch')).status).toBe(200);
    const listed = await members(zhang.token, 'zhang-ch', '张');
    expect(listed.status).toBe(200);
    expect(listed.body.map((item: { userId: string }) => item.userId)).toContain(zhang.userId);
  });

  it('omits members whose username does not contain 张', async () => {
    const zhang = await sessionFor('张三查');
    const li = await sessionFor('李四查');
    expect((await createChannel(zhang.token, 'zhang-filter', 'zhang', 'zhang')).status).toBe(201);
    expect((await joinChannel(li.token, 'zhang-filter')).status).toBe(200);
    const listed = await members(zhang.token, 'zhang-filter', '张');
    expect(listed.body.map((item: { userId: string }) => item.userId)).not.toContain(li.userId);
  });

  it('matches member usernames without regard to case', async () => {
    const alice = await sessionFor('Alice');
    const bob = await sessionFor('bob');
    expect((await createChannel(alice.token, 'case-ch', 'case', 'case')).status).toBe(201);
    expect((await joinChannel(bob.token, 'case-ch')).status).toBe(200);
    const listed = await members(alice.token, 'case-ch', 'ali');
    expect(listed.body).toEqual([{ userId: alice.userId, username: 'Alice' }]);
  });

  it('matches _ literally in a member username', async () => {
    const underscored = await sessionFor('a_b');
    const lettered = await sessionFor('axb');
    expect((await createChannel(underscored.token, 'lit-ch', 'lit', 'lit')).status).toBe(201);
    expect((await joinChannel(lettered.token, 'lit-ch')).status).toBe(200);
    const listed = await members(underscored.token, 'lit-ch', '_');
    expect(listed.body.map((item: { userId: string }) => item.userId)).toEqual([underscored.userId]);
  });

  it('returns only members of the requested channel', async () => {
    const zhang = await sessionFor('张三丰');
    const other = await sessionFor('张无忌');
    expect((await createChannel(zhang.token, 'scope-a', 'a', 'a')).status).toBe(201);
    expect((await createChannel(other.token, 'scope-b', 'b', 'b')).status).toBe(201);
    const listed = await members(zhang.token, 'scope-a', '张');
    expect(listed.body.map((item: { userId: string }) => item.userId)).toEqual([zhang.userId]);
  });

  it('sorts member usernames ascending', async () => {
    const amy = await sessionFor('amy');
    const bea = await sessionFor('bea');
    const cyra = await sessionFor('cyra');
    expect((await createChannel(amy.token, 'sort-ch', 'sort', 'sort')).status).toBe(201);
    expect((await joinChannel(bea.token, 'sort-ch')).status).toBe(200);
    expect((await joinChannel(cyra.token, 'sort-ch')).status).toBe(200);
    const listed = await members(amy.token, 'sort-ch', 'a');
    expect(listed.body.map((item: { username: string }) => item.username)).toEqual(['amy', 'bea', 'cyra']);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('returns 400 invalid_query for a %s member query', async (label, q) => {
    const owner = await sessionFor(`query-${label}`);
    expect((await createChannel(owner.token, `q-${label}`, 'q', 'q')).status).toBe(201);
    const listed = await members(owner.token, `q-${label}`, q);
    expect(listed.status).toBe(400);
    expect(listed.body.error).toBe('invalid_query');
  });

  it('returns 403 sender_not_member when a non-member searches members', async () => {
    const owner = await sessionFor('mem-owner');
    const stranger = await sessionFor('mem-stranger');
    expect((await createChannel(owner.token, 'mem-ch', 'mem', 'mem')).status).toBe(201);
    const listed = await members(stranger.token, 'mem-ch', 'mem');
    expect(listed.status).toBe(403);
    expect(listed.body.error).toBe('sender_not_member');
  });

  it('returns 409 recipient_not_member when the recipient has not joined', async () => {
    const owner = await sessionFor('send-owner');
    const stranger = await sessionFor('send-stranger');
    expect((await createChannel(owner.token, 'send-miss', 'send', 'send')).status).toBe(201);
    const sent = await sendMessage(owner.token, 'send-miss', stranger.userId, 'hello');
    expect(sent.status).toBe(409);
    expect(sent.body.error).toBe('recipient_not_member');
  });

  it('does not enqueue a message for a recipient who has not joined', async () => {
    const owner = await sessionFor('queue-owner');
    const stranger = await sessionFor('queue-stranger');
    expect((await createChannel(owner.token, 'queue-miss', 'send', 'send')).status).toBe(201);
    await sendMessage(owner.token, 'queue-miss', stranger.userId, 'hello');
    expect(
      await countWhere(dataSource, Message, { channel_id: 'queue-miss', recipient_user_id: stranger.userId }),
    ).toBe(0);
  });

  it('returns 403 sender_not_member when the sender has not joined', async () => {
    const owner = await sessionFor('outsider-owner');
    const stranger = await sessionFor('outsider');
    expect((await createChannel(owner.token, 'outsider-ch', 'send', 'send')).status).toBe(201);
    const sent = await sendMessage(stranger.token, 'outsider-ch', owner.userId, 'hello');
    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe('sender_not_member');
  });

  it('does not enqueue a message when the sender has not joined', async () => {
    const owner = await sessionFor('outsider-quiet-owner');
    const stranger = await sessionFor('outsider-quiet');
    expect((await createChannel(owner.token, 'outsider-quiet', 'send', 'send')).status).toBe(201);
    await sendMessage(stranger.token, 'outsider-quiet', owner.userId, 'hello');
    expect(
      await countWhere(dataSource, Message, { channel_id: 'outsider-quiet', recipient_user_id: owner.userId }),
    ).toBe(0);
  });

  it('adds one queue row for a recipient who has joined', async () => {
    const owner = await sessionFor('deliver-owner');
    const guest = await sessionFor('deliver-guest');
    expect((await createChannel(owner.token, 'deliver-ch', 'send', 'send')).status).toBe(201);
    expect((await joinChannel(guest.token, 'deliver-ch')).status).toBe(200);
    const before = await countWhere(dataSource, Message, {
      channel_id: 'deliver-ch',
      recipient_user_id: guest.userId,
    });
    const sent = await sendMessage(owner.token, 'deliver-ch', guest.userId, 'hello');
    expect(sent.status).toBe(201);
    expect(typeof sent.body.id).toBe('string');
    const after = await countWhere(dataSource, Message, {
      channel_id: 'deliver-ch',
      recipient_user_id: guest.userId,
    });
    expect(after - before).toBe(1);
  });

  it('rejects an empty message body', async () => {
    const owner = await sessionFor('empty-body');
    const guest = await sessionFor('empty-body-guest');
    expect((await createChannel(owner.token, 'empty-body', 'send', 'send')).status).toBe(201);
    expect((await joinChannel(guest.token, 'empty-body')).status).toBe(200);
    const sent = await sendMessage(owner.token, 'empty-body', guest.userId, '');
    expect(sent.status).toBe(400);
  });

  it('returns both queued messages from one pull', async () => {
    const owner = await sessionFor('pull-owner');
    const guest = await sessionFor('pull-guest');
    expect((await createChannel(owner.token, 'pull-two', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-two')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-two', guest.userId, 'early-body')).status).toBe(201);
    expect((await sendMessage(owner.token, 'pull-two', guest.userId, 'late-body')).status).toBe(201);
    const pulled = await pull(guest.token, 'pull-two');
    expect(pulled.status).toBe(200);
    expect(pulled.body.messages).toHaveLength(2);
  });

  it('returns the earlier message before the later message', async () => {
    const owner = await sessionFor('order-owner');
    const guest = await sessionFor('order-guest');
    expect((await createChannel(owner.token, 'pull-order', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-order')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-order', guest.userId, 'early-body')).status).toBe(201);
    expect((await sendMessage(owner.token, 'pull-order', guest.userId, 'late-body')).status).toBe(201);
    const pulled = await pull(guest.token, 'pull-order');
    expect(pulled.body.messages.map((item: { body: string }) => item.body)).toEqual(['early-body', 'late-body']);
  });

  it('deletes the pulled queue', async () => {
    const owner = await sessionFor('delete-owner');
    const guest = await sessionFor('delete-guest');
    expect((await createChannel(owner.token, 'pull-del', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-del')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-del', guest.userId, 'one')).status).toBe(201);
    expect((await sendMessage(owner.token, 'pull-del', guest.userId, 'two')).status).toBe(201);
    expect((await pull(guest.token, 'pull-del')).status).toBe(200);
    expect(
      await countWhere(dataSource, Message, { channel_id: 'pull-del', recipient_user_id: guest.userId }),
    ).toBe(0);
  });

  it('returns an empty message array when the queue is empty', async () => {
    const owner = await sessionFor('empty-pull');
    expect((await createChannel(owner.token, 'pull-empty', 'pull', 'pull')).status).toBe(201);
    const pulled = await pull(owner.token, 'pull-empty');
    expect(pulled.status).toBe(200);
    expect(pulled.body.messages).toEqual([]);
  });

  it('returns pull fields without companyId', async () => {
    const owner = await sessionFor('shape-owner');
    const guest = await sessionFor('shape-guest');
    expect((await createChannel(owner.token, 'pull-shape', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-shape')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-shape', guest.userId, 'body-text')).status).toBe(201);
    const pulled = await pull(guest.token, 'pull-shape');
    expect(Object.keys(pulled.body.messages[0]).sort()).toEqual([
      'body',
      'channelId',
      'createdAt',
      'id',
      'senderUserId',
      'senderUsername',
    ]);
    expect(pulled.body.messages[0]).toMatchObject({
      channelId: 'pull-shape',
      senderUserId: owner.userId,
      senderUsername: 'shape-owner',
      body: 'body-text',
    });
    expect(Object.hasOwn(pulled.body, 'companyId')).toBe(false);
  });

  it('does not delete another recipient queue', async () => {
    const owner = await sessionFor('other-owner');
    const guest = await sessionFor('other-guest');
    const third = await sessionFor('other-third');
    expect((await createChannel(owner.token, 'pull-other', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-other')).status).toBe(200);
    expect((await joinChannel(third.token, 'pull-other')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-other', guest.userId, 'for-guest')).status).toBe(201);
    expect((await sendMessage(owner.token, 'pull-other', third.userId, 'for-third')).status).toBe(201);
    expect((await pull(guest.token, 'pull-other')).status).toBe(200);
    expect(
      await countWhere(dataSource, Message, { channel_id: 'pull-other', recipient_user_id: third.userId }),
    ).toBe(1);
  });

  it('returns 403 sender_not_member when a non-member pulls', async () => {
    const owner = await sessionFor('pull-forbid-owner');
    const stranger = await sessionFor('pull-forbid');
    expect((await createChannel(owner.token, 'pull-forbid', 'pull', 'pull')).status).toBe(201);
    const pulled = await pull(stranger.token, 'pull-forbid');
    expect(pulled.status).toBe(403);
    expect(pulled.body.error).toBe('sender_not_member');
  });

  it('returns an empty array from a second pull', async () => {
    const owner = await sessionFor('second-owner');
    const guest = await sessionFor('second-guest');
    expect((await createChannel(owner.token, 'pull-second', 'pull', 'pull')).status).toBe(201);
    expect((await joinChannel(guest.token, 'pull-second')).status).toBe(200);
    expect((await sendMessage(owner.token, 'pull-second', guest.userId, 'only')).status).toBe(201);
    expect((await pull(guest.token, 'pull-second')).body.messages).toHaveLength(1);
    const again = await pull(guest.token, 'pull-second');
    expect(again.status).toBe(200);
    expect(again.body.messages).toEqual([]);
  });
});

describe('TypeORM persistence', () => {
  it('reads the inserted message id from a new DataSource', async () => {
    const owner = await sessionFor('persist-owner');
    const guest = await sessionFor('persist-guest');
    expect((await createChannel(owner.token, 'persist-ch', 'persist', 'persist')).status).toBe(201);
    expect((await joinChannel(guest.token, 'persist-ch')).status).toBe(200);
    const sent = await sendMessage(owner.token, 'persist-ch', guest.userId, 'stored');
    expect(sent.status).toBe(201);
    await withProbe(async (probe) => {
      const idColumn = column(probe, Message, 'id');
      const found = await probe.getRepository(Message).findOne({
        where: { [idColumn.propertyName]: sent.body.id },
      });
      expect(found).toBeTruthy();
      expect(columnValue(probe, Message, found!, 'id')).toBe(sent.body.id);
    });
  });

  it('stores company_id default on the message row', async () => {
    const owner = await sessionFor('company-msg-owner');
    const guest = await sessionFor('company-msg-guest');
    expect((await createChannel(owner.token, 'company-msg', 'persist', 'persist')).status).toBe(201);
    expect((await joinChannel(guest.token, 'company-msg')).status).toBe(200);
    const sent = await sendMessage(owner.token, 'company-msg', guest.userId, 'stored');
    expect(sent.status).toBe(201);
    await withProbe(async (probe) => {
      const idColumn = column(probe, Message, 'id');
      const found = await probe.getRepository(Message).findOneOrFail({
        where: { [idColumn.propertyName]: sent.body.id },
      });
      expect(columnValue(probe, Message, found, 'company_id')).toBe('default');
    });
  });

  it('stores company_id default on a new channel', async () => {
    const owner = await sessionFor('company-ch-owner');
    expect((await createChannel(owner.token, 'company-ch', 'persist', 'persist')).status).toBe(201);
    await withProbe(async (probe) => {
      const idColumn = column(probe, Channel, 'id');
      const found = await probe.getRepository(Channel).findOneOrFail({
        where: { [idColumn.propertyName]: 'company-ch' },
      });
      expect(columnValue(probe, Channel, found, 'company_id')).toBe('default');
    });
  });

  for (const [entity, tableName] of [
    [Message, 'messages'],
    [Channel, 'channels'],
    [User, 'users'],
    [Company, 'companies'],
    [CompanyMember, 'company_members'],
    [Membership, 'memberships'],
  ]) {
    it(`maps ${tableName}`, () => {
      expect(dataSource.getMetadata(entity).tableName).toBe(tableName);
    });
  }

  it('uses company_id and id as the channel primary key', () => {
    expect(dataSource.getMetadata(Channel).primaryColumns.map((item) => item.databaseName).sort()).toEqual([
      'company_id',
      'id',
    ]);
  });

  it('omits company_id from the users entity', () => {
    expect(dataSource.getMetadata(User).columns.map((item) => item.databaseName)).not.toContain('company_id');
  });

  it('omits company_id from the users table', async () => {
    const runner = dataSource.createQueryRunner();
    try {
      const table = await runner.getTable('users');
      expect(table).toBeTruthy();
      expect(table!.findColumnByName('company_id')).toBeUndefined();
    } finally {
      await runner.release();
    }
  });

  it('stores messages in InnoDB', async () => {
    const runner = dataSource.createQueryRunner();
    try {
      const table = await runner.getTable('messages');
      expect(table).toBeTruthy();
      expect(String(table!.engine || '').toLowerCase()).toBe('innodb');
    } finally {
      await runner.release();
    }
  });
});

describe('install and pages', () => {
  it('returns a shell from GET /install', async () => {
    const res = await request(server).get('/install');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('#!/bin/sh');
    expect(res.text).toContain('--token');
    expect(res.text).toContain('--server');
    expect(res.text).toContain('command -v pi');
    expect(res.text).toContain('PI_ON_PATH=false');
    expect(res.text).toContain('.pi/agent');
    expect(res.text).toContain('versions/node/*/bin/pi');
    expect(res.text).toContain('--client');
    expect(res.text).toContain('GROK_BOT=false');
    expect(res.text).toContain('CURSOR_AGENT');
    expect(res.text).toContain('grok-bot-deliver.js');
    expect(res.text).toContain('/install/files/');
    expect(res.text).toContain('agent-link 已安装');
    expect(res.text).toContain('不用再单独配置');
  });

  it('serves stop.js from GET /install/files/stop.js', async () => {
    const res = await request(server).get('/install/files/stop.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('runStop');
  });

  it('serves claude-register.js from GET /install/files/claude-register.js', async () => {
    const res = await request(server).get('/install/files/claude-register.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export function register');
    expect(res.text).toContain('$.prompt.submit');
  });

  it('install shell downloads claude-register.js', async () => {
    const res = await request(server).get('/install');
    expect(res.status).toBe(200);
    expect(res.text).toContain('claude-register.js');
  });

  it('serves grok-bot-deliver.js from GET /install/files/grok-bot-deliver.js', async () => {
    const res = await request(server).get('/install/files/grok-bot-deliver.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('writeInboxMessage');
    expect(res.text).toContain('drainInbox');
  });

  it('returns 404 for an unknown install file', async () => {
    const res = await request(server).get('/install/files/nope.js');
    expect(res.status).toBe(404);
  });

  it.each(['/register', '/login', '/account', '/channels'])('does not render %s', async (path) => {
    const res = await request(server).get(path);
    expect(res.status).toBe(404);
  });
});

type EventStream = {
  status: number;
  contentType: string;
  events: unknown[];
  raw: string;
  close: () => void;
};

function serverPort(): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server has no port');
  return address.port;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, detail: () => string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 4000) throw new Error(detail());
    await pause(20);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function openEventStream(token: string): Promise<EventStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort(),
        path: '/api/events',
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const client: EventStream = {
          status: res.statusCode || 0,
          contentType: String(res.headers['content-type'] || ''),
          events: [],
          raw: '',
          close() {
            req.destroy();
          },
        };
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          client.raw += chunk;
          buffer += chunk.replace(/\r\n/g, '\n');
          while (buffer.includes('\n\n')) {
            const split = buffer.indexOf('\n\n');
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => {
                const rest = line.slice('data:'.length);
                return rest.startsWith(' ') ? rest.slice(1) : rest;
              })
              .join('\n');
            if (!data) continue;
            try {
              client.events.push(JSON.parse(data));
            } catch (error) {
              client.events.push({
                __parseError: error instanceof Error ? error.message : String(error),
                __raw: data,
              });
            }
          }
        });
        settled = true;
        resolve(client);
      },
    );
    req.setTimeout(4000, () => {
      if (!settled) req.destroy(new Error('timed out waiting for GET /api/events headers'));
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (settled || error.code === 'ECONNRESET') return;
      settled = true;
      reject(error);
    });
    req.end();
  });
}

function readFinishedEvents(headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort(),
        path: '/api/events',
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.setTimeout(4000, () => {
      if (!settled) req.destroy(new Error('timed out waiting for GET /api/events to finish'));
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (settled || error.code === 'ECONNRESET') return;
      settled = true;
      reject(error);
    });
    req.end();
  });
}

async function channelWithGuest(prefix: string, channelId: string) {
  const owner = await sessionFor(`${prefix}-owner`);
  const guest = await sessionFor(`${prefix}-guest`);
  expect((await createChannel(owner.token, channelId, prefix, prefix)).status).toBe(201);
  expect((await joinChannel(guest.token, channelId)).status).toBe(200);
  return { owner, guest };
}

async function messageById(id: string) {
  const idColumn = column(dataSource, Message, 'id');
  return dataSource.getRepository(Message).findOne({
    where: { [idColumn.propertyName]: id },
  });
}

describe('idle delivery events', () => {
  it('returns 401 unauthorized for GET /api/events without a bearer token', async () => {
    const res = await readFinishedEvents({});
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('unauthorized');
  });

  it('returns 401 unauthorized for GET /api/events with only a session cookie', async () => {
    const user = await sessionFor('sse-cookie');
    const res = await readFinishedEvents({ Cookie: user.cookie });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body).error).toBe('unauthorized');
  });

  it('responds to GET /api/events with text/event-stream', async () => {
    const user = await sessionFor('sse-type');
    const stream = await openEventStream(user.token);
    try {
      expect(stream.status).toBe(200);
      expect(stream.contentType).toContain('text/event-stream');
    } finally {
      stream.close();
    }
  });

  it('pushes channelId and omits the body after a message is enqueued', async () => {
    const { owner, guest } = await channelWithGuest('sse-evt', 'sse-evt');
    const stream = await openEventStream(guest.token);
    try {
      expect(stream.status).toBe(200);
      await pause(50);
      const sent = await sendMessage(owner.token, 'sse-evt', guest.userId, 'sse-body-UNIQUE');
      expect(sent.status).toBe(201);
      await waitFor(
        () => stream.events.length >= 1,
        () => `no SSE event after enqueue: ${stream.raw}`,
      );
      const event = asRecord(stream.events[0]);
      expect(event.channelId).toBe('sse-evt');
      expect(Object.hasOwn(event, 'body')).toBe(false);
      expect(stream.raw.includes('sse-body-UNIQUE')).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('keeps the message row after the enqueue SSE', async () => {
    const { owner, guest } = await channelWithGuest('sse-keep', 'sse-keep');
    const stream = await openEventStream(guest.token);
    try {
      expect(stream.status).toBe(200);
      await pause(50);
      const sent = await sendMessage(owner.token, 'sse-keep', guest.userId, 'sse-keep-body');
      expect(sent.status).toBe(201);
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-keep'),
        () => `no SSE event before checking the row: ${stream.raw}`,
      );
      const found = await messageById(String(sent.body.id));
      expect(found).toBeTruthy();
      expect(columnValue(dataSource, Message, found!, 'body')).toBe('sse-keep-body');
      expect(
        await countWhere(dataSource, Message, { channel_id: 'sse-keep', recipient_user_id: guest.userId }),
      ).toBe(1);
    } finally {
      stream.close();
    }
  });

  it('omits companyId from the enqueue SSE', async () => {
    const { owner, guest } = await channelWithGuest('sse-co', 'sse-co');
    const stream = await openEventStream(guest.token);
    try {
      expect(stream.status).toBe(200);
      await pause(50);
      expect((await sendMessage(owner.token, 'sse-co', guest.userId, 'sse-co-body')).status).toBe(201);
      await waitFor(
        () => stream.events.length >= 1,
        () => `no SSE event while checking companyId: ${stream.raw}`,
      );
      const event = asRecord(stream.events[0]);
      expect(Object.hasOwn(event, 'companyId')).toBe(false);
      expect(stream.raw.includes('companyId')).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('does not push the enqueue event to a different user', async () => {
    const { owner, guest } = await channelWithGuest('sse-solo', 'sse-solo');
    const other = await sessionFor('sse-solo-other');
    expect((await joinChannel(other.token, 'sse-solo')).status).toBe(200);
    const recipient = await openEventStream(guest.token);
    const bystander = await openEventStream(other.token);
    try {
      await pause(50);
      expect((await sendMessage(owner.token, 'sse-solo', guest.userId, 'sse-solo-body')).status).toBe(201);
      await waitFor(
        () => recipient.events.some((item) => asRecord(item).channelId === 'sse-solo'),
        () => `recipient did not get the enqueue event: ${recipient.raw}`,
      );
      await pause(400);
      expect(bystander.events.some((item) => asRecord(item).channelId === 'sse-solo')).toBe(false);
    } finally {
      recipient.close();
      bystander.close();
    }
  });

  it('leaves the queued message in place when the recipient has no SSE connection', async () => {
    const { owner, guest } = await channelWithGuest('sse-quiet', 'sse-quiet');
    const sent = await sendMessage(owner.token, 'sse-quiet', guest.userId, 'sse-quiet-body');
    expect(sent.status).toBe(201);
    const found = await messageById(String(sent.body.id));
    expect(found).toBeTruthy();
    expect(
      await countWhere(dataSource, Message, { channel_id: 'sse-quiet', recipient_user_id: guest.userId }),
    ).toBe(1);
  });

  it('replays channelId for a channel that still has messages when the SSE connects', async () => {
    const { owner, guest } = await channelWithGuest('sse-full', 'sse-full');
    expect((await sendMessage(owner.token, 'sse-full', guest.userId, 'sse-full-body')).status).toBe(201);
    const stream = await openEventStream(guest.token);
    try {
      expect(stream.status).toBe(200);
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-full'),
        () => `replay did not include sse-full: ${stream.raw}`,
      );
    } finally {
      stream.close();
    }
  });

  it('does not replay a channel that has no messages', async () => {
    const { owner, guest } = await channelWithGuest('sse-has', 'sse-has');
    expect((await createChannel(owner.token, 'sse-empty', 'sse-empty', 'sse-empty')).status).toBe(201);
    expect((await joinChannel(guest.token, 'sse-empty')).status).toBe(200);
    expect((await sendMessage(owner.token, 'sse-has', guest.userId, 'sse-has-body')).status).toBe(201);
    const stream = await openEventStream(guest.token);
    try {
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-has'),
        () => `replay did not include the non-empty channel: ${stream.raw}`,
      );
      await pause(400);
      expect(stream.events.some((item) => asRecord(item).channelId === 'sse-empty')).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('does not replay a channel whose queued messages belong to someone else', async () => {
    const { owner, guest } = await channelWithGuest('sse-mine', 'sse-mine');
    const third = await sessionFor('sse-theirs-user');
    expect((await createChannel(owner.token, 'sse-theirs', 'sse-theirs', 'sse-theirs')).status).toBe(201);
    expect((await joinChannel(guest.token, 'sse-theirs')).status).toBe(200);
    expect((await joinChannel(third.token, 'sse-theirs')).status).toBe(200);
    expect((await sendMessage(owner.token, 'sse-mine', guest.userId, 'sse-mine-body')).status).toBe(201);
    expect((await sendMessage(owner.token, 'sse-theirs', third.userId, 'sse-theirs-body')).status).toBe(201);
    const stream = await openEventStream(guest.token);
    try {
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-mine'),
        () => `replay did not include the recipient channel: ${stream.raw}`,
      );
      await pause(400);
      expect(stream.events.some((item) => asRecord(item).channelId === 'sse-theirs')).toBe(false);
      expect(stream.raw.includes('sse-theirs-body')).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('replays every channel that still has messages for this user', async () => {
    const owner = await sessionFor('sse-both-owner');
    const guest = await sessionFor('sse-both-guest');
    for (const channelId of ['sse-both-a', 'sse-both-b']) {
      expect((await createChannel(owner.token, channelId, channelId, channelId)).status).toBe(201);
      expect((await joinChannel(guest.token, channelId)).status).toBe(200);
      expect((await sendMessage(owner.token, channelId, guest.userId, `${channelId}-body`)).status).toBe(201);
    }
    const stream = await openEventStream(guest.token);
    try {
      await waitFor(
        () => {
          const ids = stream.events.map((item) => asRecord(item).channelId);
          return ids.includes('sse-both-a') && ids.includes('sse-both-b');
        },
        () => `replay missed a channel that still has messages: ${stream.raw}`,
      );
    } finally {
      stream.close();
    }
  });

  it('does not delete the message row when replaying on connect', async () => {
    const { owner, guest } = await channelWithGuest('sse-stay', 'sse-stay');
    const sent = await sendMessage(owner.token, 'sse-stay', guest.userId, 'sse-stay-body');
    expect(sent.status).toBe(201);
    const stream = await openEventStream(guest.token);
    try {
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-stay'),
        () => `replay did not arrive before the row check: ${stream.raw}`,
      );
      const found = await messageById(String(sent.body.id));
      expect(found).toBeTruthy();
      expect(columnValue(dataSource, Message, found!, 'body')).toBe('sse-stay-body');
      expect(
        await countWhere(dataSource, Message, { channel_id: 'sse-stay', recipient_user_id: guest.userId }),
      ).toBe(1);
    } finally {
      stream.close();
    }
  });

  it('omits body and companyId from a replayed SSE payload', async () => {
    const { owner, guest } = await channelWithGuest('sse-shape', 'sse-shape');
    expect((await sendMessage(owner.token, 'sse-shape', guest.userId, 'sse-shape-body')).status).toBe(201);
    const stream = await openEventStream(guest.token);
    try {
      await waitFor(
        () => stream.events.some((item) => asRecord(item).channelId === 'sse-shape'),
        () => `replay did not arrive: ${stream.raw}`,
      );
      const event = asRecord(stream.events.find((item) => asRecord(item).channelId === 'sse-shape'));
      expect(Object.hasOwn(event, 'body')).toBe(false);
      expect(Object.hasOwn(event, 'companyId')).toBe(false);
      expect(stream.raw.includes('sse-shape-body')).toBe(false);
      expect(stream.raw.includes('companyId')).toBe(false);
    } finally {
      stream.close();
    }
  });
});
