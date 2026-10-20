const _ = require('lodash');

// SQLite LIKE and NOCASE only fold ASCII case, so non-ASCII values are left to the JavaScript filters
const isAscii = value => /^[\x20-\x7e]*$/.test(value);

const likeContains = value => `%${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;

const hasFrame = 'EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.frame_id = ?';

/**
 * Paths of stored songs that can match the search, as a superset of what the JavaScript filters
 * (metadata/filter.js) and free text matching accept; null when nothing narrows the search.
 * Only conditions SQLite evaluates at least as loosely are used: includes and ratings, not excludes,
 * ASCII values only, and free text words without spaces (a word with spaces can span artist and title).
 */
const matchingPaths = (db, { config, filters = {}, words = [] }) => {
  const frameOf = name => _.get(_.find(_.get(config, 'library.tags'), { name }), 'id');
  const conditions = [];
  const params = [];

  _.each(filters.include, (value, name) => {
    const frameId = frameOf(name);
    if (!frameId) {
      return;
    }
    if (value === '') {
      conditions.push(`NOT ${hasFrame})`);
      params.push(frameId);
    } else if (_.isArray(value)) {
      _.filter(value, isAscii).forEach(item => {
        conditions.push(`${hasFrame} AND t.value = ? COLLATE NOCASE)`);
        params.push(frameId, item);
      });
    } else if (isAscii(value)) {
      conditions.push(`${hasFrame} AND t.value LIKE ? ESCAPE '\\')`);
      params.push(frameId, likeContains(value));
    }
  });

  const { min, max, exclude } = filters.rating || {};
  if (!exclude && min !== '') {
    if (!_.isNaN(parseFloat(min))) {
      conditions.push('s.rating >= ?');
      params.push(parseFloat(min));
    }
    if (!_.isNaN(parseFloat(max))) {
      conditions.push('s.rating <= ?');
      params.push(parseFloat(max));
    }
  }

  const textFrames = _.compact([frameOf('artist'), frameOf('title')]);
  if (textFrames.length > 0) {
    _.filter(words, word => isAscii(word) && !/\s/.test(word)).forEach(word => {
      conditions.push(
        `EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.frame_id IN (${textFrames
          .map(() => '?')
          .join(', ')}) AND t.value LIKE ? ESCAPE '\\')`
      );
      params.push(...textFrames, likeContains(word));
    });
  }

  if (conditions.length === 0) {
    return null;
  }
  const rows = db
    .prepare(`SELECT s.path FROM songs s WHERE ${conditions.join(' AND ')}`)
    .all(...params);
  return new Set(_.map(rows, 'path'));
};

module.exports = { matchingPaths };
