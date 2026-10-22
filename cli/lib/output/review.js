const _ = require('lodash');
const chalk = require('chalk').default;
const stringWidth = require('string-width').default;

const { titleDescriptors, titleWords } = require('../spotify/match.js');
const { durationDiff } = require('./sync.js');

const dim = text => chalk.hex('#888899')(text);

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

/**
 * fzf lines for review items, keyed by file: aligned columns of whether the match is linked (already on
 * Spotify), the song, the Spotify candidate, the differences, and the candidate's album.
 */
const reviewLines = items => {
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
        [
          item.linked ? chalk.hex('#DDCC44')('linked') : '      ',
          fit(songText(item), localWidth),
          dim('->'),
          fit(candidateText(item), spotifyWidth),
          chalk.hex('#DD9944')(fit(differences[i], differencesWidth)),
          dim(item.candidate.album || '')
        ].join('  ')
      ].join('\t')
    ])
  );
};

const reviewHeader =
  'linked: already on Spotify | song -> Spotify track | differences (+ Spotify only, - song only) | album';

module.exports = { reviewDifferences, reviewHeader, reviewLines };
