const _ = require('lodash');

// parenthetical or " - " suffixes that mark a different recording, never stripped
const versionMarker =
  /\b(live|remix|re-?mix|acoustic|instrumental|demo|cover|karaoke|unplugged|a ?cappella)\b/i;
// suffixes that do not change the recording
const noiseWords = [
  'remaster(ed)?',
  'version',
  'mix',
  'edit',
  'feat\\.?',
  'featuring',
  'ft\\.?',
  'with',
  'explicit',
  'clean',
  'mono',
  'stereo',
  'single',
  'bonus',
  'deluxe',
  'anniversary',
  'original',
  'album'
];
const noiseMarker = new RegExp(`\\b(${noiseWords.join('|')})\\b`, 'i');

const plain = text =>
  `${text || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b0+(\d)/g, '$1')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();

// title text without noise suffixes like "(Remastered 2009)", " - New Stereo Mix", or "feat. X",
// keeping version markers such as "(NEUS Remix)"
const stripTitleNoise = title => {
  let text = `${title || ''}`;
  const strip = segment => !versionMarker.test(segment) && noiseMarker.test(segment);
  text = text.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner) => (strip(inner) ? '' : whole));
  text = text.replace(/\s+-\s+([^-]+)$/, (whole, suffix) => (strip(suffix) ? '' : whole));
  // an inline feature runs to the next bracket or " - " suffix, names can have hyphens (Topley-Bird)
  text = text.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*?(?=\s*[([]|\s+-\s+|$)/i, '');
  return text.trim();
};

const normalizeTitle = title => plain(stripTitleNoise(title));

// words of stripped suffixes that do not tell recordings apart; the others (Campfire, Dub, Early, Radio)
// name a different mix, edit, or version
const neutralWords = new Set([
  'remaster',
  'remastered',
  'remasters',
  'digital',
  'digitally',
  'version',
  'mix',
  'edit',
  'explicit',
  'clean',
  'mono',
  'stereo',
  'single',
  'bonus',
  'track',
  'deluxe',
  'edition',
  'expanded',
  'anniversary',
  'original',
  'album',
  'lp',
  'a',
  'an',
  'and',
  'of',
  'from',
  'the',
  'to',
  'in',
  'on'
]);

/**
 * Words of the suffixes stripTitleNoise removes that could name a different recording, sorted: [] for
 * "Junkhead (2022 Remaster)" or "Song (feat. X)", ['early'] for "Song (Early Version) - 2019 Remaster",
 * ['campfire', 'keys', 'miura'] for "Rise (Miura Keys Campfire mix)".
 */
const titleDescriptors = title => {
  const stripped = segment => !versionMarker.test(segment) && noiseMarker.test(segment);
  const segments = [];
  const rest = `${title || ''}`.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner) => {
    if (stripped(inner)) {
      segments.push(inner);
      return '';
    }
    return whole;
  });
  const suffix = rest.match(/\s+-\s+([^-]+)$/);
  if (suffix && stripped(suffix[1])) {
    segments.push(suffix[1]);
  }
  return _.uniq(
    _.flatMap(
      _.reject(segments, segment => /^\s*(feat\.?|ft\.?|featuring|with)\b/i.test(segment)),
      segment => plain(segment).split(' ')
    ).filter(word => word && !neutralWords.has(word) && !/^\d+$/.test(word))
  ).sort();
};

// title words that tell recordings apart: no neutral words or years, which kept suffixes can also have
// (Buck-Wild Remix/Remastered 2009, Original Demo Version)
const titleWords = title =>
  normalizeTitle(title)
    .split(' ')
    .filter(word => word && !neutralWords.has(word) && !/^(19|20)\d\d$/.test(word));

// the same title once noise is removed, and the same words in the removed suffixes
const sameTitle = (localTitle, spotifyTitle) =>
  _.isEqual(titleWords(localTitle), titleWords(spotifyTitle)) &&
  _.isEqual(titleDescriptors(localTitle), titleDescriptors(spotifyTitle));

// version markers in a title, so a studio track never matches its live or remix version
const versions = title =>
  _.uniq(
    (`${title || ''}`.toLowerCase().match(new RegExp(versionMarker, 'gi')) || []).map(_.toLower)
  );

// first credited artist, without features and collaborators
const primaryArtist = artist =>
  plain(`${artist || ''}`.split(/,|;|\s&\s|\s(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s/i)[0]);

const artistMatches = (localArtist, spotifyArtists) => {
  const local = primaryArtist(localArtist);
  const full = plain(localArtist);
  return _.some(spotifyArtists, ({ name }) => {
    const spotify = plain(name);
    return spotify === local || spotify === full || (spotify.length > 3 && full.includes(spotify));
  });
};

const candidateOf = track => ({
  id: track.id,
  name: track.name,
  artists: _.map(track.artists, 'name').join(', '),
  album: _.get(track, 'album.name'),
  durationMs: track.duration_ms
});

/**
 * How well a Spotify track matches a local song ({ artist, title, duration } in seconds):
 * 'match' when it is the same recording, 'review' when it probably is, otherwise null.
 */
const rateCandidate = (song, track, { isrc = false } = {}) => {
  const durationDiff =
    song.duration && track.duration_ms ? Math.abs(song.duration - track.duration_ms / 1000) : 0;
  // an ISRC can be shared by versions with different titles (Happy Home, Happy Home II)
  if (isrc) {
    return durationDiff <= 5 && sameTitle(song.title, track.name) ? 'match' : 'review';
  }
  if (
    !_.isEqual(versions(song.title), versions(track.name)) ||
    !artistMatches(song.artist, track.artists)
  ) {
    return null;
  }
  const local = normalizeTitle(song.title);
  const spotify = normalizeTitle(track.name);
  if (sameTitle(song.title, track.name)) {
    if (durationDiff <= 3) {
      return 'match';
    }
    // same title and artist but a different edit or version length, worth a look
    return durationDiff <= 60 ? 'review' : null;
  }
  // the same base title with differently named suffixes (Campfire mix, Dub Mix) is another version
  if (local === spotify) {
    return durationDiff <= 60 ? 'review' : null;
  }
  const similar =
    local.length > 3 && spotify.length > 3 && (local.includes(spotify) || spotify.includes(local));
  return similar && durationDiff <= 3 ? 'review' : null;
};

/**
 * Best of the candidate tracks for a song: { status: 'match' | 'review' | 'missing', candidate, track }
 * with the full Web API track when one qualifies.
 * Matches beat review candidates; ties go to the closest duration.
 */
const bestCandidate = (song, tracks, options) => {
  const rated = _.compact(
    _.map(tracks, track => {
      const status = rateCandidate(song, track, options);
      if (!status) {
        return null;
      }
      const diff =
        song.duration && track.duration_ms ? Math.abs(song.duration - track.duration_ms / 1000) : 0;
      return { status, diff, track };
    })
  );
  const best = _.sortBy(rated, [({ status }) => (status === 'match' ? 0 : 1), 'diff'])[0];
  return best
    ? { status: best.status, candidate: candidateOf(best.track), track: best.track }
    : { status: 'missing', candidate: null };
};

const queryArtist = song =>
  `${song.artist || ''}`.split(/,|;|\s&\s|\s(?:feat\.?|ft\.?|featuring)\s/i)[0];

// Spotify rejects queries over 250 characters, very long titles are cut to their first words
const maxTitleLength = 150;

const queryTitle = title => {
  const text = stripTitleNoise(title).replace(/\s+/g, ' ').trim();
  return text.length > maxTitleLength ? text.slice(0, maxTitleLength).replace(/\s+\S*$/, '') : text;
};

// Spotify search query for a song, quoting fields so words stay together; version markers are kept
// so remixes and covers find their own recording
const searchQuery = song => {
  const title = queryTitle(song.title)
    .replace(/[()[\]"]/g, ' ')
    .replace(/\s+/g, ' ');
  return `track:"${title.trim()}" artist:"${queryArtist(song).replace(/"/g, '').trim()}"`;
};

// looser query of plain words, for titles the field query misses (punctuation, alternate spellings)
const looseQuery = song => `${plain(queryTitle(song.title))} ${plain(queryArtist(song))}`.trim();

module.exports = {
  bestCandidate,
  sameTitle,
  titleDescriptors,
  titleWords,
  candidateOf,
  looseQuery,
  normalizeTitle,
  primaryArtist,
  rateCandidate,
  searchQuery
};
