const _ = require('lodash');
const os = require('os');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const stringWidth = require('string-width').default;

const { titleDescriptors, titleWords } = require('../spotify/match.js');
const { durationDiff } = require('./sync.js');

const dim = text => chalk.hex('#888899')(text);

// nerd font link icon for a match already on Spotify, and the arrow between song and Spotify track
const linkedIcon = '\uf0c1';
const arrow = '\u2192';

// widest each column may get, so long titles do not push the differences off screen
const maxWidths = { local: 48, spotify: 52, differences: 30 };

const fit = (text, width) => {
  let cut = text;
  while (stringWidth(cut) > width) {
    cut = cut.slice(0, -1);
  }
  const shown = cut === text ? cut : `${cut.slice(0, -1)}~`;
  return shown + ' '.repeat(Math.max(0, width - stringWidth(shown)));
};

/**
 * Why a review candidate differs from the song: the duration difference, and the title words only one of
 * them has, + for Spotify's and - for the song's (e.g. +18.0s +rough +mix).
 */
const reviewDifferences = ({ song = {}, candidate }) => {
  const words = title => _.uniq([...titleWords(title), ...titleDescriptors(title)]);
  const local = words(song.title);
  const spotify = words(candidate.name);
  return _.compact([
    durationDiff(song, candidate.durationMs),
    ..._.difference(spotify, local).map(word => `+${word}`),
    ..._.difference(local, spotify).map(word => `-${word}`)
  ]).join(' ');
};

const songText = ({ song = {}, path }) =>
  song.artist || song.title ? `${song.artist || '?'} - ${song.title || '?'}` : path;

const candidateText = ({ candidate }) => `${candidate.artists} - ${candidate.name}`;

// similarity colored green at or above the auto-accept threshold (95 without one), yellow from 80
const percentText = (percent, threshold = 95) => {
  const text = `${percent}%`.padStart(4);
  if (percent >= threshold) {
    return chalk.hex('#55CC55')(text);
  }
  return percent >= 80 ? chalk.hex('#DDCC44')(text) : chalk.hex('#DD7744')(text);
};

/**
 * fzf lines for review items, keyed by file: the file and the candidate's Spotify id (hidden, for the
 * play binds), then aligned columns of the similarity, whether the match is linked (already on
 * Spotify), the song, the Spotify candidate, the differences, and the candidate's album.
 */
const reviewLines = (items, { threshold } = {}) => {
  const width = (key, text) =>
    Math.min(maxWidths[key], _.max(_.map(items, item => stringWidth(text(item)))) || 0);
  const localWidth = width('local', songText);
  const spotifyWidth = width('spotify', candidateText);
  const differences = _.map(items, reviewDifferences);
  const differencesWidth = Math.min(
    maxWidths.differences,
    _.max(_.map(differences, stringWidth)) || 0
  );
  return new Map(
    _.map(items, (item, i) => [
      item.file,
      [
        item.file,
        item.candidate.id,
        [
          percentText(item.similarity.percent, threshold),
          item.linked ? chalk.hex('#DDCC44')(linkedIcon) : ' ',
          fit(songText(item), localWidth),
          dim(arrow),
          fit(candidateText(item), spotifyWidth),
          chalk.hex('#DD9944')(fit(differences[i], differencesWidth)),
          dim(item.candidate.album || '')
        ].join('  ')
      ].join('\t')
    ])
  );
};

const reviewHeader = [
  `similarity | ${linkedIcon} already on Spotify | song ${arrow} Spotify track | differences (+ Spotify only, - song only) | album`,
  'ctrl-l play song | ctrl-s play on Spotify | ctrl-x stop'
].join('\n');

// the mpv playing a song from the review list, stopped before the next one plays
const playerPidFile = path.join(os.tmpdir(), 'musicman-review-player.pid');

/**
 * fzf binds to listen to both versions while reviewing: the song with mpv (pausing Spotify), the
 * candidate in the Spotify desktop app through playerctl (or its spotify: URI handler when the app is
 * not running), and stop. Fields are {1} the file and {2} the Spotify id of reviewLines.
 */
const reviewBinds = (pidFile = playerPidFile) => {
  const stop = `[ -f ${pidFile} ] && kill "$(cat ${pidFile})" 2>/dev/null; rm -f ${pidFile}`;
  const uri = 'spotify:track:{2}';
  return [
    `ctrl-l:execute-silent:${stop}; playerctl -p spotify pause 2>/dev/null; ` +
      `nohup mpv --no-video --really-quiet {1} >/dev/null 2>&1 & echo $! > ${pidFile}`,
    `ctrl-s:execute-silent:${stop}; playerctl -p spotify open ${uri} 2>/dev/null || ` +
      `(nohup xdg-open ${uri} >/dev/null 2>&1 &)`,
    `ctrl-x:execute-silent:${stop}; playerctl -p spotify pause 2>/dev/null`
  ];
};

// stops a song still playing from the review list once fzf is closed
const stopReviewPlayback = (pidFile = playerPidFile) => {
  try {
    process.kill(Number(fs.readFileSync(pidFile, 'utf8')));
  } catch {
    // nothing was playing, or it already ended
  }
  fs.rmSync(pidFile, { force: true });
};

// review items in the order to decide them: most similar first to accept, least similar first to reject
const sortForDecision = (items, accept) =>
  _.orderBy(items, ['similarity.percent', 'path'], [accept ? 'desc' : 'asc', 'asc']);

module.exports = {
  playerPidFile,
  reviewBinds,
  reviewDifferences,
  reviewHeader,
  reviewLines,
  sortForDecision,
  stopReviewPlayback
};
