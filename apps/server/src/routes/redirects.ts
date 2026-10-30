/**
 * redirects.ts - short-URL alias table preserving query parameters.
 *
 * `/s` and `/r` redirect to `/send` and `/receive` while carrying `?code=XXXXXXX`
 * intact so shared receiver links never drop their session identifier.
 */

export const ALIASES: Record<string, string> = {
  '/s': '/send',
  '/r': '/receive',
  '/send.html': '/send',
  '/receive.html': '/receive',
};

export function aliasTarget(pathname: string, search = ''): string | null {
  const target = ALIASES[pathname];
  if (!target) return null;
  return `${target}${search}`;
}
