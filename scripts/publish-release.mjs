// Publishes the packaged NXGS Play build as a GitHub Release, in the order
// SKILL.md requires: public installer first, then the update manifest.
//
//   node scripts/publish-release.mjs create --notes <file>  draft release on HEAD + the four build assets
//   node scripts/publish-release.mjs publish                 make it the published latest release
//   node scripts/publish-release.mjs write-manifest --summary "<one line>"
//                                                            write updates/windows-update.json (commit and push it next)
//   node scripts/publish-release.mjs upload-manifest         attach the pushed manifest to the release
//   node scripts/publish-release.mjs verify                  check assets, hashes and the anonymous update endpoint
//
// The version and tag come from package.json. The GitHub token comes from
// GH_TOKEN or the git credential manager and is never printed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'sowankispassah';
const REPO = 'nxgs_gaming';
const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(REPO_DIR, 'package.json'), 'utf8')).version;
const TAG = `v${VERSION}`;
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const INSTALLER = 'NXGS-Play-Setup.exe';
const INSTALLER_URL = `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${INSTALLER}`;
const MANIFEST_PATH = join(REPO_DIR, 'updates', 'windows-update.json');
const BUILD_ASSETS = [
  [INSTALLER, 'application/x-msdownload'],
  [`${INSTALLER}.blockmap`, 'application/octet-stream'],
  ['NXGS-Play.exe', 'application/x-msdownload'],
  ['latest.yml', 'application/octet-stream']
];

function git(...args) {
  return execFileSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8' }).trim();
}

function githubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const output = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore']
  });
  const token = output.match(/^password=(.+)$/m)?.[1];
  if (!token) throw new Error('No GitHub credential is stored for github.com.');
  return token;
}

let token;
async function api(path, init = {}) {
  token ??= githubToken();
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nxgs-release-script',
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function findRelease() {
  const releases = await api('/releases?per_page=30');
  return releases.find((release) => release.tag_name === TAG) ?? null;
}

async function uploadAsset(release, name, contentType, filePath) {
  const existing = release.assets.find((asset) => asset.name === name);
  if (existing) {
    await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    console.log(`replaced existing ${name}`);
  }
  const data = readFileSync(filePath);
  const asset = await api(`${release.upload_url.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Content-Length': String(data.length) },
    body: data
  });
  console.log(`uploaded ${name} (${asset.size} bytes, state=${asset.state})`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function assertPackagedVersion() {
  const latestYml = readFileSync(join(REPO_DIR, 'release', 'latest.yml'), 'utf8');
  const built = latestYml.match(/^version:\s*(\S+)/m)?.[1];
  if (built !== VERSION) throw new Error(`release/latest.yml is ${built}, package.json is ${VERSION}. Run npm run build:win first.`);
}

async function create() {
  const notesFile = option('--notes');
  if (!notesFile) throw new Error('create needs --notes <file> with the customer-facing release notes.');
  assertPackagedVersion();
  const head = git('rev-parse', 'HEAD');
  git('fetch', '-q', 'origin', 'main');
  if (git('rev-parse', 'origin/main') !== head) {
    throw new Error(`HEAD ${head.slice(0, 7)} is not origin/main. Merge and push main before releasing.`);
  }
  let release = await findRelease();
  if (!release) {
    release = await api('/releases', {
      method: 'POST',
      body: JSON.stringify({
        tag_name: TAG,
        target_commitish: head,
        name: `NXGS Play ${VERSION}`,
        body: readFileSync(notesFile, 'utf8').trim(),
        draft: true,
        prerelease: false
      })
    });
    console.log(`created draft release ${release.id} for ${TAG} at ${head.slice(0, 7)}`);
  } else {
    console.log(`reusing release ${release.id} for ${TAG} (draft=${release.draft})`);
  }
  for (const [name, contentType] of BUILD_ASSETS) {
    release = await api(`/releases/${release.id}`);
    await uploadAsset(release, name, contentType, join(REPO_DIR, 'release', name));
  }
}

async function publish() {
  const release = await findRelease();
  if (!release) throw new Error(`release ${TAG} not found; run create first.`);
  const updated = await api(`/releases/${release.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ draft: false, prerelease: false, make_latest: 'true' })
  });
  console.log(`published ${updated.tag_name}: ${updated.html_url}`);
  // Never point the manifest at an installer that is not publicly downloadable.
  const response = await fetch(INSTALLER_URL, { redirect: 'follow' });
  const remote = Buffer.from(await response.arrayBuffer());
  const local = readFileSync(join(REPO_DIR, 'release', INSTALLER));
  console.log(`anonymous installer download: ${response.status}, matches local build: ${sha256(remote) === sha256(local)}`);
  if (!response.ok || sha256(remote) !== sha256(local)) throw new Error('the public installer does not match the local build');
}

function writeManifest() {
  const summary = option('--summary');
  if (!summary) throw new Error('write-manifest needs --summary "<one customer-facing line>".');
  const manifest = {
    version: VERSION,
    downloadUrl: INSTALLER_URL,
    sha256: sha256(readFileSync(join(REPO_DIR, 'release', INSTALLER))),
    required: false,
    notes: summary
  };
  // Same layout as the PowerShell-written manifest already in the repo.
  const body = Object.entries(manifest)
    .map(([key, value]) => `    ${JSON.stringify(key)}:  ${JSON.stringify(value)}`)
    .join(',\n');
  writeFileSync(MANIFEST_PATH, `{\n${body}\n}`);
  console.log(`wrote updates/windows-update.json for ${VERSION} (sha256 ${manifest.sha256})`);
}

async function uploadManifest() {
  const release = await findRelease();
  if (!release || release.draft) throw new Error('publish the release before uploading the manifest.');
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.version !== VERSION) throw new Error(`updates/windows-update.json is ${manifest.version}; run write-manifest.`);
  git('fetch', '-q', 'origin', 'main');
  if (git('show', 'origin/main:updates/windows-update.json').replace(/\r\n/g, '\n') !== readFileSync(MANIFEST_PATH, 'utf8').replace(/\r\n/g, '\n')) {
    throw new Error('commit and push updates/windows-update.json to main before uploading it.');
  }
  await uploadAsset(release, 'windows-update.json', 'application/json', MANIFEST_PATH);
}

async function verify() {
  const latest = await api('/releases/latest');
  console.log(`latest release: ${latest.tag_name} draft=${latest.draft} prerelease=${latest.prerelease}`);
  if (latest.tag_name !== TAG) throw new Error(`latest release is ${latest.tag_name}, expected ${TAG}`);
  const names = latest.assets.map((asset) => asset.name);
  const missing = [...BUILD_ASSETS.map(([name]) => name), 'windows-update.json'].filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`missing assets: ${missing.join(', ')}`);
  console.log(`assets: ${names.sort().join(', ')}`);

  // Everything below is fetched anonymously, exactly as kiosks fetch it.
  const installer = Buffer.from(await (await fetch(INSTALLER_URL, { redirect: 'follow' })).arrayBuffer());
  const installerHash = sha256(installer);
  const localHash = sha256(readFileSync(join(REPO_DIR, 'release', INSTALLER)));
  const response = await fetch(`https://github.com/${OWNER}/${REPO}/releases/latest/download/windows-update.json`, { redirect: 'follow' });
  const live = response.ok ? await response.json() : null;
  const raw = await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/updates/windows-update.json`);
  const repoManifest = raw.ok ? await raw.json() : null;
  console.log(`installer: ${installer.length} bytes, matches local build: ${installerHash === localHash}`);
  console.log(`live manifest (anonymous): ${response.status} version=${live?.version} sha256 matches installer: ${live?.sha256 === installerHash}`);
  console.log(`repo manifest on main: ${raw.status} version=${repoManifest?.version}`);
  if (installerHash !== localHash || live?.version !== VERSION || live?.downloadUrl !== INSTALLER_URL ||
      live?.sha256 !== installerHash || repoManifest?.version !== VERSION) {
    throw new Error('the live update endpoint does not serve this release');
  }
  console.log(`verified: kiosks will be offered NXGS Play ${VERSION}`);
}

const commands = { create, publish, 'write-manifest': writeManifest, 'upload-manifest': uploadManifest, verify };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`usage: node scripts/publish-release.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
await command();
