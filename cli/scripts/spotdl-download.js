#!/usr/bin/env node
// Downloads the tracks of the sync --pull manifest with spotDL into sync.downloadDirectory. Tracks that
// were downloaded or imported already are skipped, so a cancelled run resumes where it stopped. Run
// musicman sync --import afterwards to tag the downloads and import them with beets.
//
//   pnpm download [--dry-run] [--limit N]   (--limit: only the first N pending tracks, e.g. for a trial)
const _ = require('lodash');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { loadConfig } = require('musicman-common/config');

const {
  downloadTrackId,
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
  const limitArg = _.find(args, arg => arg.startsWith('--limit'));
  const limitValue =
    limitArg === '--limit' ? args[args.indexOf(limitArg) + 1] : `${limitArg || ''}`.split('=')[1];
  const limit = limitArg ? Number(limitValue) : null;
  if (limitArg && !(Number.isInteger(limit) && limit > 0)) {
    console.error(`--limit needs a positive number, got '${limitValue}'`);
    return 1;
  }
  const manifest = readManifest(config);
  if (!manifest) {
    console.error(`No manifest at ${manifestPath(config)}, run: musicman sync --pull`);
    return 1;
  }
  const allPending = pendingTracks(manifest, downloadedFiles(config));
  const pending = limit ? _.take(allPending, limit) : allPending;
  const total = _.get(manifest, 'tracks', []).length;
  console.log(
    `${allPending.length} of ${total} manifest tracks to download${
      limit && pending.length < allPending.length ? `, the first ${pending.length} now` : ''
    }`
  );
  if (pending.length === 0) {
    return 0;
  }
  if (dryRun) {
    pending.forEach(track => console.log(`  ${track.artists} - ${track.name}  ${track.url}`));
    return 0;
  }
  fs.mkdirSync(config.sync.downloadDirectory, { recursive: true });
  let failed = 0;
  const run = tracks => {
    const [command, commandArgs, options] = spotdlCommand(config, _.map(tracks, 'url'));
    const result = spawn(command, commandArgs, { ...options, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      failed += 1;
      console.error(
        `spotDL ${result.error ? `failed: ${result.error.message}` : `exited with ${result.status}`}`
      );
      return false;
    }
    return true;
  };
  const notDownloaded = tracks => {
    const downloaded = new Set(
      _.compact(_.map(downloadedFiles(config), file => downloadTrackId(file)))
    );
    return _.reject(tracks, ({ trackId }) => downloaded.has(trackId));
  };
  _.chunk(pending, batchSize).forEach((batch, i) => {
    console.log(`Batch ${i + 1}/${Math.ceil(pending.length / batchSize)}`);
    // spotDL looks every track of a run up before downloading, so one track it cannot look up fails the
    // whole run: the tracks of a failed batch are tried again one by one
    const left = run(batch) ? [] : notDownloaded(batch);
    if (left.length > 1) {
      console.log(`Trying the ${left.length} tracks of batch ${i + 1} one by one`);
      left.forEach(track => run([track]));
    }
  });
  const stillPending = new Set(_.map(pendingTracks(manifest, downloadedFiles(config)), 'trackId'));
  const missedTracks = _.filter(pending, ({ trackId }) => stillPending.has(trackId));
  const missed = missedTracks.length;
  missedTracks.forEach(track =>
    console.log(`  missing: ${track.artists} - ${track.name}  ${track.url}`)
  );
  const later = stillPending.size - missed;
  console.log(
    `${pending.length - missed} downloaded, ${missed} still missing${
      failed ? ` (${failed} spotDL runs failed)` : ''
    }${later ? `, ${later} left for later runs` : ''}; next: musicman sync --import`
  );
  return missed > 0 ? 1 : 0;
};

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
