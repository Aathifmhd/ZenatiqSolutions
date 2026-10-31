// A project's commit history from GitHub, for its Activity tab. With GITHUB_TOKEN (read-only) the
// portal can read private repositories, and GitHub allows 5,000 requests an hour instead of 60.
import { HttpError } from './http.js';

const API = 'https://api.github.com';
export const PER_PAGE = 50;

// { owner, name } from a GitHub address such as https://github.com/owner/name(.git), or null.
export function repoFrom(url) {
  const m = String(url ?? '').trim().match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:[/?#]|$)/i);
  const name = m?.[2].replace(/\.git$/i, '');
  return name && name !== '.' && name !== '..' ? { owner: m[1], name } : null;
}

const lastPage = (link) => Number(/[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link || '')?.[1]) || null;
const commitOf = (c) => ({
  sha: c.sha, url: c.html_url,
  message: String(c.commit?.message ?? '').trim().slice(0, 4000),
  name: c.commit?.author?.name || c.author?.login || 'Unknown',
  login: c.author?.login ?? null,
  avatar: c.author?.avatar_url ?? null,
  date: c.commit?.committer?.date || c.commit?.author?.date || null,
});

export function createGitHub() {
  // Repository details and branch lists change rarely, so they're kept for 5 minutes; commit
  // pages for one minute.
  const cache = new Map();
  async function remember(key, minutes, load) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await load();
    cache.set(key, { value, until: Date.now() + minutes * 60e3 });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  // One request to GitHub's API, with GitHub's errors turned into messages people can act on.
  // Statuses in `allow` come back as they are.
  async function ask(path, repo, { allow = [] } = {}) {
    const token = process.env.GITHUB_TOKEN?.trim();
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'zenatiq-portal',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new HttpError('GitHub could not be reached. Try again in a moment.', 'github_unreachable', 502);
    }
    if (res.ok || allow.includes(res.status)) return res;
    const where = `${repo.owner}/${repo.name}`;
    if (res.status === 401) throw new HttpError('GitHub refused GITHUB_TOKEN. Make a new token and update the setting.', 'github_token', 502);
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const minutes = Math.max(1, Math.ceil((Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now()) / 60e3) || 60);
      throw new HttpError(`GitHub's hourly limit is used up. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}${token ? '' : ', or add a GITHUB_TOKEN for a much higher limit'}.`, 'github_limit', 503);
    }
    if (res.status === 404 || res.status === 403) {
      throw new HttpError(token
        ? `GitHub can't find ${where}, or GITHUB_TOKEN isn't allowed to read it.`
        : `GitHub can't find ${where}. If it's a private repository, the portal needs a GITHUB_TOKEN that can read it.`, 'github_not_found', 404);
    }
    throw new HttpError(`GitHub answered ${res.status} for ${where}. Try again in a moment.`, 'github_error', 502);
  }

  return {
    // One page of a branch's commits, newest first, PER_PAGE at a time. The first page also lists
    // the branches and counts the branch's commits. branch: null means the default branch.
    async commits(repo, { branch = null, page = 1 } = {}) {
      const base = `/repos/${repo.owner}/${repo.name}`;
      const info = await remember(`repo ${base}`, 5, async () => {
        const r = await (await ask(base, repo)).json();
        return { owner: r.owner?.login || repo.owner, name: r.name || repo.name, url: r.html_url, private: Boolean(r.private), defaultBranch: r.default_branch };
      });
      const ref = branch || info.defaultBranch;
      const commitsOf = (perPage, n) => remember(`commits ${base} ${ref} ${perPage} ${n}`, 1, async () => {
        const res = await ask(`${base}/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}&page=${n}`, repo, { allow: [404, 409, 422] });
        // 409: the repository has no commits yet. 404 or 422: there's no such branch.
        if (res.status === 409) return { list: [], link: '' };
        if (!res.ok) throw new HttpError(`There's no branch called "${ref}" in ${info.owner}/${info.name}.`, 'github_branch', 404);
        return { list: (await res.json()).map(commitOf), link: res.headers.get('link') || '' };
      });

      const [current, branches, count] = await Promise.all([
        commitsOf(PER_PAGE, page),
        page === 1 ? remember(`branches ${base}`, 5, async () => (await (await ask(`${base}/branches?per_page=100`, repo)).json()).map((b) => b.name)) : null,
        page === 1 ? commitsOf(1, 1) : null,
      ]);
      return {
        repo: { owner: info.owner, name: info.name, url: info.url, private: info.private },
        branch: ref,
        defaultBranch: info.defaultBranch,
        ...(page === 1 ? { branches: [...new Set([info.defaultBranch, ...branches])], total: lastPage(count.link) ?? count.list.length } : {}),
        commits: current.list,
        nextPage: /rel="next"/.test(current.link) ? page + 1 : null,
      };
    },
  };
}
