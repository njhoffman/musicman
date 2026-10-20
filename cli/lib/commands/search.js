const _ = require('lodash');
const path = require('path');

const { getFilteredFiles } = require('./common.js');
const { queueSongs } = require('../clients/mpd.js');
const { matchingPaths } = require('../db/search.js');
const { outputMetadata } = require('../output/index.js');
const parseFilters = require('../parser/options/filters.js');
const logger = require('../utils/logger.js');

// field names that can be searched, keyed by lowercase name
const searchFields = config =>
  _.keyBy(['rating'].concat(_.map(_.get(config, 'library.tags'), 'name')), name =>
    name.toLowerCase()
  );

/**
 * Splits search terms into field filters and free text words. Fields can be given as field:value
 * (field:"some value") or mpc style as separate field and value arguments; ~ negates either form.
 * Anything else, including field:value with an unknown field, is free text.
 */
const parseTerms = (terms, config) => {
  const fields = searchFields(config);
  const fieldOf = term => fields[term.replace(/^~/, '').toLowerCase()];
  const filterArgs = [];
  const words = [];
  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    const [key, ...rest] = term.split(':');
    const negate = term.startsWith('~') ? '~' : '';
    if (rest.length > 0 && fieldOf(key)) {
      filterArgs.push(`${negate}${fieldOf(key)}:${rest.join(':')}`);
    } else if (rest.length === 0 && fieldOf(term) && i + 1 < terms.length) {
      filterArgs.push(`${negate}${fieldOf(term)}:${terms[i + 1]}`);
      i += 1;
    } else {
      words.push(term.toLowerCase());
    }
  }
  return { filters: parseFilters(filterArgs, config, 'search'), words };
};

// every free text word appears in the artist or title
const matchesWords =
  words =>
  ([, meta]) => {
    const text = `${meta.artist || ''} ${meta.title || ''}`.toLowerCase();
    return _.every(words, word => text.includes(word));
  };

const searchCommand = async ({ target, options, config }) => {
  const terms = options.terms || [];
  if (terms.length === 0) {
    logger.warn(
      'search needs terms, e.g. search rating:4.5 mood:Upbeat or search artist "The Doors"'
    );
    return { results: [] };
  }

  const { filters, words } = parseTerms(terms, config);
  // the database narrows the candidates, the same filters as view decide the results
  const matched = await getFilteredFiles({
    target,
    options: { ...options, switches: { ...options.switches, recursive: true }, filters },
    config,
    prefilter: db => matchingPaths(db, { config, filters, words })
  });
  const results = _.filter(matched, matchesWords(words));

  if (results.length === 0) {
    logger.info('No songs found');
    return { results };
  }

  outputMetadata({
    target,
    metadata: _.map(results, 1),
    config,
    options,
    format: results.length === 1 ? 'list' : 'table'
  });
  logger.info(`${results.length} ${results.length === 1 ? 'song' : 'songs'} found`);

  const { add, play } = options.switches;
  let queued = 0;
  if (add || play) {
    const baseDirectory = path.resolve(config.mpd.baseDirectory);
    const songPaths = _.map(results, ([file]) => path.relative(baseDirectory, file));
    queued = await queueSongs(config.mpd, songPaths, { replace: Boolean(play) });
    const songs = `${queued} ${queued === 1 ? 'song' : 'songs'}`;
    logger.info(play ? `Playing ${songs}` : `Added ${songs} to the queue`);
  }
  return { results, queued };
};

// searches always cover the whole library, arguments are never path targets
const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'search',
  description: 'Search the whole library by field:value, mpc style pairs, or free text',
  usage: 'musicman search [field:value | field value | text ...] [--add | --play]',
  switches: ['add', 'play', 'files'],
  func: searchCommand,
  defaultTarget,
  targetArgs: false,
  parseTerms
};
