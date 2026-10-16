export interface ValidationOk {
  ok: true;
}

export interface ValidationFail {
  ok: false;
}

function invalid(): ValidationFail {
  return { ok: false };
}

function valid(): ValidationOk {
  return { ok: true };
}

function isWhitespaceOrControl(codePoint: number): boolean {
  if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  if (codePoint >= 0x80 && codePoint <= 0x9f) return true;
  if (codePoint === 0xa0 || codePoint === 0x1680 || codePoint === 0x2028 || codePoint === 0x2029) return true;
  if (codePoint === 0x202f || codePoint === 0x205f || codePoint === 0x3000 || codePoint === 0xfeff) return true;
  if (codePoint >= 0x2000 && codePoint <= 0x200a) return true;
  return false;
}

function isAsciiLetterOrDigit(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (codePoint >= 48 && codePoint <= 57) || (codePoint >= 65 && codePoint <= 90) || (codePoint >= 97 && codePoint <= 122);
}

function codePointLengthExceeds(value: string, max: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > max) return true;
  }
  return false;
}

export function usernameKey(username: string): string {
  let key = '';
  for (const character of username) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 65 && codePoint <= 90) key += String.fromCodePoint(codePoint + 32);
    else key += character;
  }
  return key;
}

export function validateUsername(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  let count = 0;
  for (const character of input) {
    count += 1;
    if (count > 32) return invalid();
    const codePoint = character.codePointAt(0) ?? 0;
    if (isWhitespaceOrControl(codePoint)) return invalid();
  }
  if (count < 1) return invalid();
  return valid();
}

export function validatePassword(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  if (codePointLengthExceeds(input, 128)) return invalid();
  let count = 0;
  for (const _character of input) count += 1;
  if (count < 8) return invalid();
  return valid();
}

export function validateChannelId(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  let index = 0;
  for (const character of input) {
    index += 1;
    if (index > 64) return invalid();
    const allowed = isAsciiLetterOrDigit(character) || character === '.' || character === '_' || character === '-';
    if (!allowed) return invalid();
    if (index === 1 && !isAsciiLetterOrDigit(character)) return invalid();
  }
  if (index < 1) return invalid();
  return valid();
}

export function validateChannelName(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  let count = 0;
  for (const _character of input) {
    count += 1;
    if (count > 80) return invalid();
  }
  if (count < 1) return invalid();
  return valid();
}

export function validateChannelDescription(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  let count = 0;
  for (const _character of input) {
    count += 1;
    if (count > 2000) return invalid();
  }
  if (count < 1) return invalid();
  return valid();
}

export function validateMessageBody(input: unknown): ValidationOk | ValidationFail {
  if (typeof input !== 'string') return invalid();
  let count = 0;
  for (const _character of input) {
    count += 1;
    if (count > 8000) return invalid();
  }
  if (count < 1) return invalid();
  return valid();
}
