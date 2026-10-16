function foldAsciiLower(value: string): string {
  let folded = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 65 && codePoint <= 90) folded += String.fromCodePoint(codePoint + 32);
    else folded += character;
  }
  return folded;
}

export function literalIncludes(haystack: string, needle: string, ignoreAsciiCase = false): boolean {
  const left = ignoreAsciiCase ? foldAsciiLower(haystack) : haystack;
  const right = ignoreAsciiCase ? foldAsciiLower(needle) : needle;
  return left.includes(right);
}
