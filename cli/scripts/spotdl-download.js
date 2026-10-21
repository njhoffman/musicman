#!/usr/bin/env node
// Downloads the tracks of the sync --pull manifest with spotDL into sync.downloadDirectory. Tracks that
// were downloaded or imported already are skipped, so a cancelled run resumes where it stopped. Run
// musicman sync --import afterwards to tag the downloads and import them with beets.
//
//   pnpm download [--dry-run]
const _ = require('lodash');
const { spawnSync } = require('child_process');
const { loadConfig } = require('musicman-common/config');

const {
  downloadedFiles,
  manifestPath,
  pendingTracks,
  readManifest,
  spotdlCommand
} = require('../lib/sync/download.js');

// tracks passed to each spotDL run, so progress is kept between runs of a long download
const batchSize = 20;

const main = ({ args = process.argv.slice(2), config = loadConfig(), spawn = spawnSync } = {}) => {
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const manifest = readManifest(config);
  if (!manifest) {
    console.error(`No manifest at ${manifestPath(config)}, run: musicman sync --pull`);
    return 1;
  }
  const pending = pendingTracks(manifest, downloadedFiles(config));
  const total = _.get(manifest, 'tracks', []).length;
  console.log(`${pending.length} of ${total} manifest tracks to download`);
  if (pending.length === 0) {
    return 0;
  }
  if (dryRun) {
    pending.forEach(track => console.log(`  ${track.artists} - ${track.name}  ${track.url}`));
    return 0;
  }
  let failed = 0;
  _.chunk(pending, batchSize).forEach((batch, i) => {
    console.log(`Batch ${i + 1}/${Math.ceil(pending.length / batchSize)}`);
    const [command, commandArgs] = spotdlCommand(config, _.map(batch, 'url'));
    const result = spawn(command, commandArgs, { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      failed += 1;
      console.error(
        `spotDL ${result.error ? `failed: ${result.error.message}` : `exited with ${result.status}`}`
      );
    }
  });
  const left = pendingTracks(manifest, downloadedFiles(config)).length;
  console.log(
    `${pending.length - left} downloaded, ${left} still missing${
      failed ? ` (${failed} spotDL runs failed)` : ''
    }; next: musicman sync --import`
  );
  return left > 0 ? 1 : 0;
};

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
