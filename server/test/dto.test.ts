import * as fs from 'fs';
import * as path from 'path';

const srcRoot = path.resolve(__dirname, '../src');

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), 'utf8');
}

function compact(source: string): string {
  return source.replace(/\s+/g, '');
}

function dtoFiles(): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && full.includes(`${path.sep}dto${path.sep}`) && full.endsWith('.ts')) found.push(full);
    }
  };
  visit(srcRoot);
  return found;
}

describe('ValidationPipe', () => {
  const main = () => read('main.ts');

  it('constructs ValidationPipe in main.ts', () => {
    expect(main()).toContain('ValidationPipe');
  });

  it('enables whitelist', () => {
    expect(compact(main())).toContain('whitelist:true');
  });

  it('enables transform', () => {
    expect(compact(main())).toContain('transform:true');
  });

  it('enables forbidNonWhitelisted', () => {
    expect(compact(main())).toContain('forbidNonWhitelisted:true');
  });
});

describe('TypeORM root', () => {
  const appModule = () => read('app.module.ts');

  it('registers TypeOrmModule.forRoot', () => {
    expect(compact(appModule())).toContain('TypeOrmModule.forRoot(');
  });

  it('synchronizes the schema from entities', () => {
    expect(compact(appModule())).toContain('synchronize:true');
  });

  it('does not register MysqlStore', () => {
    expect(appModule()).not.toContain('MysqlStore');
    expect(appModule()).not.toContain('mysql.store');
  });
});

describe('dto classes', () => {
  it('uses class-validator under server/src/**/dto', () => {
    const files = dtoFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).toContain('class-validator');
    }
  });

  it('decorates dto fields with ApiProperty', () => {
    const files = dtoFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).toContain('@ApiProperty');
    }
  });

  it.each([
    'validateUsername',
    'validatePassword',
    'validateChannelId',
    'validateChannelName',
    'validateChannelDescription',
    'validateMessageBody',
  ])('calls %s from a dto file', (fn) => {
    const files = dtoFiles();
    expect(files.length).toBeGreaterThan(0);
    const combined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(combined).toContain(fn);
  });
});
