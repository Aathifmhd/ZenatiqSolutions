// Reading commit histories from GitHub (github.js), with GitHub's API answered by a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFrom, createGitHub } from '../github.js';

async function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (vals) => Object.entries(vals).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  apply(values);
  try { return await fn(); } finally { apply(saved); }
}
// Answers GitHub requests with answer(url) for the length of fn, and records them.
async function withGitHub(answer, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: init?.headers || {} }); return answer(String(url)); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}
const json = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers });

const REPO = { owner: 'Zen', name: 'site' };
const API = 'https://api.github.com/repos/Zen/site';
const commit = (n, { login = 'Aathifmhd', message = `Change ${n}` } = {}) => ({
  sha: String(n).repeat(40).slice(0, 40), html_url: `https://github.com/Zen/site/commit/${n}`,
  commit: { message, author: { name: 'Mohamed Aathif', date: '2026-10-30T10:00:00Z' }, committer: { date: `2026-10-31T1${n}:00:00Z` } },
  author: login ? { login, avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' } : null,
});
// A private repository with two branches and 123 commits on main.
function github(url) {
  if (url === API) return json({ owner: { login: 'Zen' }, name: 'site', html_url: 'https://github.com/Zen/site', private: true, default_branch: 'main' });
  if (url === `${API}/branches?per_page=100`) return json([{ name: 'dev' }, { name: 'main' }]);
  if (url === `${API}/commits?sha=main&per_page=1&page=1`) {
    return json([commit(1)], { headers: { link: `<${API}/commits?sha=main&per_page=1&page=2>; rel="next", <${API}/commits?sha=main&per_page=1&page=123>; rel="last"` } });
  }
  if (url === `${API}/commits?sha=main&per_page=50&page=1`) {
    return json([commit(1, { message: 'Fix the menu\n\nThe rail was too wide.' }), commit(2, { login: null })], {
      headers: { link: `<${API}/commits?sha=main&per_page=50&page=2>; rel="next", <${API}/commits?sha=main&per_page=50&page=3>; rel="last"` },
    });
  }
  if (url === `${API}/commits?sha=main&per_page=50&page=3`) return json([commit(9)], { headers: { link: `<${API}/commits?sha=main&per_page=50&page=2>; rel="prev"` } });
  if (url.startsWith(`${API}/commits?sha=feature%2Fmenu&`)) return json([commit(4)]);
  return json({ message: 'Not Found' }, { status: 404 });
}

test('GitHub addresses are recognised, other addresses are not', () => {
  for (const url of ['https://github.com/Zen/site', 'https://github.com/Zen/site.git', 'https://www.github.com/Zen/site/',
    'http://github.com/Zen/site/tree/main/src', ' https://github.com/Zen/site?tab=readme ']) {
    assert.deepEqual(repoFrom(url), REPO, url);
  }
  assert.deepEqual(repoFrom('https://github.com/Aathifmhd/zenatiq.website'), { owner: 'Aathifmhd', name: 'zenatiq.website' });
  for (const url of ['', null, 'https://github.com/Zen', 'https://gitlab.com/Zen/site', 'https://github.com.evil.example/Zen/site',
    'javascript:alert(1)//github.com/Zen/site', 'https://github.com/Zen/..', 'git@github.com:Zen/site.git']) {
    assert.equal(repoFrom(url), null, String(url));
  }
});

test('the first page: repository, branches, how many commits, and the newest 50', () => withEnv({ GITHUB_TOKEN: undefined }, () =>
  withGitHub(github, async (calls) => {
    const page = await createGitHub().commits(REPO);
    assert.deepEqual(page.repo, { owner: 'Zen', name: 'site', url: 'https://github.com/Zen/site', private: true });
    assert.equal(page.branch, 'main');
    assert.deepEqual(page.branches, ['main', 'dev'], 'the default branch comes first');
    assert.equal(page.total, 123);
    assert.equal(page.nextPage, 2);
    assert.deepEqual(page.commits[0], {
      sha: '1'.repeat(40), url: 'https://github.com/Zen/site/commit/1', message: 'Fix the menu\n\nThe rail was too wide.',
      name: 'Mohamed Aathif', login: 'Aathifmhd', avatar: 'https://avatars.githubusercontent.com/u/1?v=4', date: '2026-10-31T11:00:00Z',
    });
    assert.ok(page.commits[1].login === null && page.commits[1].avatar === null && page.commits[1].name === 'Mohamed Aathif', 'commits without a GitHub account');
    assert.ok(calls.every((c) => c.headers['User-Agent'] && c.headers['X-GitHub-Api-Version'] && !c.headers.Authorization), 'no token, no Authorization');
  })));
test('later pages only fetch commits, and the last one says there are no more', () => withGitHub(github, async (calls) => {
  const gh = createGitHub();
  await gh.commits(REPO);
  const before = calls.length;
  const last = await gh.commits(REPO, { page: 3 });
  assert.ok(last.nextPage === null && last.commits.length === 1 && !('branches' in last) && !('total' in last), JSON.stringify(last));
  assert.equal(calls.length - before, 1, 'one request for a later page');
  await gh.commits(REPO);
  assert.equal(calls.length - before, 1, 'the first page is remembered for a minute');
}));
test('branches with a slash in their name work', () => withGitHub(github, async () => {
  const page = await createGitHub().commits(REPO, { branch: 'feature/menu' });
  assert.ok(page.branch === 'feature/menu' && page.commits.length === 1, JSON.stringify(page));
}));
test('GITHUB_TOKEN is sent when it is set', () => withEnv({ GITHUB_TOKEN: 'github_pat_test' }, () => withGitHub(github, async (calls) => {
  await createGitHub().commits(REPO);
  assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer github_pat_test'));
})));

test('an empty repository has no commits; an unknown branch is explained', () => withGitHub((url) => {
  if (url.includes('/commits?sha=main&')) return json({ message: 'Git Repository is empty.' }, { status: 409 });
  if (url.includes('/commits?sha=gone&')) return json({ message: 'No commit found for SHA: gone' }, { status: 422 });
  return github(url);
}, async () => {
  const gh = createGitHub();
  const empty = await gh.commits(REPO);
  assert.ok(empty.total === 0 && empty.commits.length === 0 && empty.nextPage === null, JSON.stringify(empty));
  await assert.rejects(gh.commits(REPO, { branch: 'gone' }), { code: 'github_branch', message: 'There\'s no branch called "gone" in Zen/site.' });
}));
test("GitHub's errors become messages people can act on", async () => {
  const fails = (answer) => withGitHub(answer, async () => createGitHub().commits(REPO));
  await withEnv({ GITHUB_TOKEN: undefined }, () =>
    assert.rejects(fails(() => json({ message: 'Not Found' }, { status: 404 })), { code: 'github_not_found', message: /private repository, the portal needs a GITHUB_TOKEN/ }));
  await withEnv({ GITHUB_TOKEN: 'github_pat_test' }, async () => {
    await assert.rejects(fails(() => json({ message: 'Not Found' }, { status: 404 })), { message: /GITHUB_TOKEN isn't allowed to read it/ });
    await assert.rejects(fails(() => json({ message: 'Bad credentials' }, { status: 401 })), { code: 'github_token' });
  });
  const limited = () => json({ message: 'API rate limit exceeded' }, {
    status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 10 * 60) },
  });
  await withEnv({ GITHUB_TOKEN: undefined }, () =>
    assert.rejects(fails(limited), { code: 'github_limit', message: /Try again in 1[01] minutes, or add a GITHUB_TOKEN/ }));
  await assert.rejects(fails(() => { throw new TypeError('fetch failed'); }), { code: 'github_unreachable' });
});
