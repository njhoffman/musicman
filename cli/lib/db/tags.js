const _ = require('lodash');
const globalTags = require('musicman-common/config/tags.json');
const { transaction } = require('./database.js');

const isCustom = frameId => /^TXXX\./.test(frameId);

// a custom frame name reduced to letters and digits, lowercase: names equal this way are one field
// spelled differently (TXXX.replaygain_track_gain, TXXX.REPLAYGAIN_TRACK_GAIN)
const nameKey = frameId =>
  frameId
    .replace(/^TXXX\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// a stored custom field now spelled differently, single or multi value as before: song_tags keeps
// each file's frames under their own spelling, so only the definition row changes
const respelled = (existing, definition) =>
  isCustom(definition.frame_id) &&
  existing.multi === definition.multi &&
  nameKey(existing.frame_id) === nameKey(definition.frame_id);

// config tags take precedence over tags.json entries with the same name
const tagDefinitions = config => {
  const configTags = _.map(_.get(config, 'tags', []), ({ name, id, multi }) => ({
    name,
    frame_id: id,
    multi: multi ? 1 : 0,
    source: 'config'
  }));
  const configNames = new Set(_.map(configTags, 'name'));
  const jsonTags = _.uniqBy(
    _.filter(globalTags, ({ name }) => !configNames.has(name)),
    'name'
  ).map(({ name, id }) => ({ name, frame_id: id, multi: 0, source: 'tags.json' }));
  return configTags.concat(jsonTags);
};

const describe = ({ name, frame_id: frameId, multi }) =>
  `${name} (${frameId}${multi ? ', multi' : ''})`;

/**
 * Stores tag definitions from tags.json and the config without deleting existing rows.
 * New tags are inserted, and standard frame changes and custom fields only spelled differently
 * (same nameKey, same multi) update the row. Any other changed definition of a stored custom (TXXX)
 * field from the config is returned as an error and nothing is written.
 */
const syncTagDefinitions = (db, config) => {
  const stored = _.keyBy(
    db.prepare('SELECT name, frame_id, multi, source FROM tags').all(),
    'name'
  );
  const storedCustom = _.filter(
    _.values(stored),
    row => row.source === 'config' && isCustom(row.frame_id)
  );

  const errors = [];
  const inserts = [];
  const updates = [];
  _.each(tagDefinitions(config), definition => {
    const existing = stored[definition.name];
    const renamed = _.find(
      storedCustom,
      row => row.frame_id === definition.frame_id && row.name !== definition.name
    );
    if (renamed && definition.source === 'config') {
      errors.push(
        `Custom field ${describe(renamed)} is stored in the database but is now named '${
          definition.name
        }'`
      );
    } else if (!existing) {
      inserts.push(definition);
    } else if (existing.frame_id !== definition.frame_id || existing.multi !== definition.multi) {
      if (
        existing.source === 'config' &&
        isCustom(existing.frame_id) &&
        !respelled(existing, definition)
      ) {
        errors.push(
          `Custom field ${describe(
            existing
          )} is stored in the database but is now defined as ${describe(definition)}`
        );
      } else {
        updates.push(definition);
      }
    }
  });

  if (errors.length > 0) {
    return { errors, inserted: 0, updated: 0 };
  }

  const insert = db.prepare('INSERT INTO tags (name, frame_id, multi, source) VALUES (?, ?, ?, ?)');
  const update = db.prepare('UPDATE tags SET frame_id = ?, multi = ?, source = ? WHERE name = ?');
  transaction(db, () => {
    inserts.forEach(({ name, frame_id: frameId, multi, source }) =>
      insert.run(name, frameId, multi, source)
    );
    updates.forEach(({ name, frame_id: frameId, multi, source }) =>
      update.run(frameId, multi, source, name)
    );
  });
  return { errors, inserted: inserts.length, updated: updates.length };
};

module.exports = { nameKey, syncTagDefinitions, tagDefinitions };
