import { runtimeHeaders } from './src/security.ts';
import { releaseRoute, type ReleaseInfo } from './src/patch/releases.ts';

const repository = 'justjake/fujimod';
const api = `https://api.github.com/repos/${repository}/releases`;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'fujimod-web' };
interface GitHubRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string; state: string }[];
}
interface Context {
  waitUntil(promise: Promise<unknown>): void;
}
interface Assets {
  fetch(request: Request): Promise<Response>;
}
export interface ReleaseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<unknown>;
}
class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Release upstream unavailable.');
    this.status = status;
  }
}
async function currentRelease(fetcher: typeof fetch): Promise<ReleaseInfo | undefined> {
  let newest: GitHubRelease | undefined;
  // GitHub orders by creation rather than publication time. Inspect every page,
  // including prereleases and releases published from older tags.
  for (let page = 1; ; page++) {
    const response = await fetcher(`${api}?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new UpstreamError(response.status);
    const releases = (await response.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) throw new UpstreamError(502);
    for (const release of releases) {
      if (
        !release.draft &&
        release.published_at &&
        release.assets.some(
          (asset) => asset.name === 'patches.json' && asset.state === 'uploaded',
        ) &&
        (!newest || Date.parse(release.published_at) > Date.parse(newest.published_at!))
      )
        newest = release;
    }
    if (!response.headers.get('link')?.includes('rel="next"')) break;
  }
  return newest
    ? {
        tag: newest.tag_name,
        name: newest.name || newest.tag_name,
        published_at: newest.published_at!,
        prerelease: newest.prerelease,
      }
    : undefined;
}
function failure(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { ...runtimeHeaders, 'Cache-Control': 'no-store' },
  });
}
/** Only successful release responses enter the edge cache; credentials are never forwarded. */
export async function serveRelease(
  request: Request,
  cache: ReleaseCache,
  context: Context,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    route = releaseRoute(url.pathname);
  if (!route) return failure(404, 'Release route not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  url.search = '';
  const key = new Request(url, { method: 'GET' });
  const head = (response: Response) =>
    request.method === 'HEAD'
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  const cached = await cache.match(key);
  if (cached) return head(cached);
  try {
    let response: Response;
    if (route.kind === 'current') {
      const release = await currentRelease(fetcher);
      if (!release) return head(failure(404, 'No patch release has been published.'));
      response = Response.json(release);
    } else {
      const upstream = await fetcher(
        `https://github.com/${repository}/releases/download/${encodeURIComponent(route.tag)}/${encodeURIComponent(route.file)}`,
        { headers: { 'User-Agent': 'fujimod-web' }, redirect: 'follow' },
      );
      if (!upstream.ok)
        return head(failure(upstream.status === 404 ? 404 : 502, 'Release asset unavailable.'));
      const contentType = route.file.endsWith('.json')
        ? 'application/json'
        : route.file.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'application/octet-stream';
      response = new Response(upstream.body, { headers: { 'Content-Type': contentType } });
    }
    for (const [name, value] of Object.entries(runtimeHeaders)) response.headers.set(name, value);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set(
      'Cache-Control',
      `public, max-age=0, s-maxage=${route.kind === 'current' ? 300 : 31536000}`,
    );
    context.waitUntil(cache.put(key, response.clone()));
    return head(response);
  } catch (error) {
    return head(
      failure(
        502,
        error instanceof UpstreamError && [403, 429].includes(error.status)
          ? 'GitHub release rate limit reached. Try again later.'
          : 'Release upstream unavailable.',
      ),
    );
  }
}
export default {
  async fetch(request: Request, env: { ASSETS: Assets }, context: Context): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/releases/')) return env.ASSETS.fetch(request);
    return serveRelease(request, await caches.open('fujimod-releases'), context);
  },
};
