/**
 * Turns HTML library documents into plain text for seeding.
 *
 * Tags are removed until none remain (so nested tricks can't leave a tag
 * behind), and entities are decoded once, at the end, so decoded text can
 * never turn back into markup.
 */
/** Applies a replacement until the text stops changing, so nested tricks like "<scr<script>ipt>" are fully removed. */
export function replaceUntilStable(text: string, pattern: RegExp, replacement: string): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, replacement);
  } while (text !== previous);
  return text;
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: '—', ndash: '–',
};

/** Decodes HTML entities in ONE pass, so "&amp;lt;" becomes "&lt;" (text), never "<". */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Strips every tag, repeating until none are left. */
export const stripTags = (html: string) => replaceUntilStable(html, /<[^<>]*>/g, '');

export function htmlToText(html: string): string {
  let text = replaceUntilStable(html, /<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '');
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ');
  text = stripTags(text);
  // Decode last, and only once, so decoded text can't turn back into tags
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
