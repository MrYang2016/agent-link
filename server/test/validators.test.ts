import {
  validateChannelDescription,
  validateChannelId,
  validateChannelName,
  validateMessageBody,
  validatePassword,
  validateUsername,
} from '../src/validators';

describe('validateUsername', () => {
  it('returns ok false for a 201-character username within 50ms', () => {
    const started = performance.now();
    const result = validateUsername(`${'a'.repeat(200)}!`);
    const elapsed = performance.now() - started;
    expect(result).toEqual({ ok: false });
    expect(elapsed).toBeLessThan(50);
  }, 10000);

  it('accepts 32 code points', () => {
    expect(validateUsername('a'.repeat(32))).toEqual({ ok: true });
  });

  it('rejects 33 code points', () => {
    expect(validateUsername('a'.repeat(33))).toEqual({ ok: false });
  });

  it('counts one emoji as one code point', () => {
    expect(validateUsername('😀'.repeat(32))).toEqual({ ok: true });
    expect(validateUsername('😀'.repeat(33))).toEqual({ ok: false });
  });

  it.each([
    ['empty', ''],
    ['internal space', 'a b'],
    ['newline', 'a\n'],
    ['tab', 'a\t'],
    ['nul', 'a\u0000'],
    ['delete', 'a\u007f'],
  ])('rejects %s', (_label, value) => {
    expect(validateUsername(value)).toEqual({ ok: false });
  });

  it('allows punctuation that is not whitespace', () => {
    expect(validateUsername('user!')).toEqual({ ok: true });
  });

  it('allows a Chinese username', () => {
    expect(validateUsername('张三')).toEqual({ ok: true });
  });

  it.each([undefined, 1, null])('rejects non-string %p', (value) => {
    expect(validateUsername(value)).toEqual({ ok: false });
  });
});

describe('validatePassword', () => {
  it('rejects 7 code points', () => {
    expect(validatePassword('a'.repeat(7))).toEqual({ ok: false });
  });

  it('accepts 8 code points', () => {
    expect(validatePassword('a'.repeat(8))).toEqual({ ok: true });
  });

  it('accepts 128 code points', () => {
    expect(validatePassword('a'.repeat(128))).toEqual({ ok: true });
  });

  it('rejects 129 code points', () => {
    expect(validatePassword('a'.repeat(129))).toEqual({ ok: false });
  });

  it('accepts 8 spaces', () => {
    expect(validatePassword('        ')).toEqual({ ok: true });
  });

  it('accepts regex metacharacters when the length is in range', () => {
    expect(validatePassword('.*+?^$()')).toEqual({ ok: true });
  });

  it('rejects a non-string', () => {
    expect(validatePassword(12345678)).toEqual({ ok: false });
  });
});

describe('validateChannelId', () => {
  it('returns ok false for a 201-character channel id within 50ms', () => {
    const started = performance.now();
    const result = validateChannelId(`${'a'.repeat(200)}!`);
    const elapsed = performance.now() - started;
    expect(result).toEqual({ ok: false });
    expect(elapsed).toBeLessThan(50);
  }, 10000);

  it('accepts a single letter', () => {
    expect(validateChannelId('a')).toEqual({ ok: true });
  });

  it('accepts letters, digits, dots, underscores, and hyphens after the first character', () => {
    expect(validateChannelId('A1._-')).toEqual({ ok: true });
  });

  it('accepts 64 characters', () => {
    expect(validateChannelId(`a${'b'.repeat(63)}`)).toEqual({ ok: true });
  });

  it('rejects 65 characters', () => {
    expect(validateChannelId('a'.repeat(65))).toEqual({ ok: false });
  });

  it.each(['', '.abc', '-abc', '_abc', 'a b', 'a/b', '中文', 'a!'])('rejects %p', (value) => {
    expect(validateChannelId(value)).toEqual({ ok: false });
  });
});

describe('validateChannelName', () => {
  it('rejects an empty name', () => {
    expect(validateChannelName('')).toEqual({ ok: false });
  });

  it('accepts 80 code points', () => {
    expect(validateChannelName('名'.repeat(80))).toEqual({ ok: true });
  });

  it('rejects 81 code points', () => {
    expect(validateChannelName('a'.repeat(81))).toEqual({ ok: false });
  });
});

describe('validateChannelDescription', () => {
  it('rejects an empty description', () => {
    expect(validateChannelDescription('')).toEqual({ ok: false });
  });

  it('accepts 2000 code points', () => {
    expect(validateChannelDescription('a'.repeat(2000))).toEqual({ ok: true });
  });

  it('rejects 2001 code points', () => {
    expect(validateChannelDescription('a'.repeat(2001))).toEqual({ ok: false });
  });
});

describe('validateMessageBody', () => {
  it('rejects an empty body', () => {
    expect(validateMessageBody('')).toEqual({ ok: false });
  });

  it('accepts 8000 code points', () => {
    expect(validateMessageBody('a'.repeat(8000))).toEqual({ ok: true });
  });

  it('rejects 8001 code points', () => {
    expect(validateMessageBody('a'.repeat(8001))).toEqual({ ok: false });
  });
});
