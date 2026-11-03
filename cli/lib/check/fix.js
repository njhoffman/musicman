const _ = require('lodash');
const path = require('path');
const NodeId3 = require('node-id3');

const { leftoverSpotifyFrame, nameKey, nameTarget, standardFrames } = require('./library.js');
const { multiDescriptions } = require('./files.js');
const { readTagBuffer } = require('./frames.js');
const { rewriteTags } = require('../metadata/write.js');

// checks check --fix repairs; the others need a decision per song and stay reports
const fixableChecks = ['drift', 'names', 'standard', 'spotify-id', 'multi', 'case', 'artwork'];

const leftoverDescription = leftoverSpotifyFrame.slice(5);
const sameText = (a, b) => `${a}`.trim() === `${b}`.trim();

// longest value shown in a change or a case left for a decision
const shownLength = 80;
// a value as shown in those texts: on one line, cut to shownLength (lyrics and notes span many lines)
const shown = value => {
  const text = `${value}`.replace(/\s+/g, ' ').trim();
  return text.length > shownLength ? `${text.slice(0, shownLength - 3)}...` : text;
};

// the text values of a standard frame in raw node-id3 tags (COMM and USLT hold { text })
const frameTexts = (raw, frame) =>
  _.compact(
    _.map([].concat(_.isNil(raw[frame]) ? [] : raw[frame]), value =>
      _.isPlainObject(value) ? value.text : value
    )
  );

// the raw value a custom field's text becomes in a standard frame, null when it cannot move there
const standardValue = (frame, text) => {
  // grouping decides Spotify playlists, so a custom grouping never fills TIT1 on its own
  if (frame === 'TIT1') {
    return null;
  }
  if (frame === 'TYER') {
    return /^\d{4}$/.test(`${text}`.trim()) ? `${text}`.trim() : null;
  }
  if (frame === 'COMM' || frame === 'USLT') {
    return { language: 'eng', shortText: '', text };
  }
  return text;
};

// a multi value field written cleanly: no empty or padded items, each item once (in any case)
const cleanMulti = value =>
  _.uniqBy(_.compact(_.map(`${value}`.split(','), _.trim)), _.toLower).join(',');

/**
 * What check --fix repairs, from the findings of the checks run: names (the custom field spelling each
 * name group is renamed to: a configured tag id or a check.names spelling first, else the most used),
 * standard (custom fields to fold into the standard frame they duplicate), spotify-id, multi (field
 * descriptions to rewrite cleanly), and case (the casing each multi value is written in).
 */
const fixContext = (results, config) => {
  const found = name => _.get(_.find(results, { name }), 'findings', []);
  const nameTargets = new Map(
    _.map(found('names'), ({ frames }) => [
      nameKey(frames[0]),
      nameTarget(
        _.map(frames, frame => frame.slice(5)),
        config
      )
    ])
  );
  const caseTargets = new Map(
    _.map(_.groupBy(found('case'), 'frame'), (groups, frame) => [
      frame.slice(5),
      new Map(
        _.flatMap(groups, ({ values }) => _.map(values, value => [_.toLower(value), values[0]]))
      )
    ])
  );
  return {
    nameTargets,
    standardKeys: new Set(_.map(found('standard'), ({ frame }) => nameKey(frame))),
    spotifyId: found('spotify-id').length > 0,
    multi: found('multi').length > 0 ? new Set(_.keys(multiDescriptions(config))) : new Set(),
    caseTargets
  };
};

/**
 * Applies the repairs of a fix context to a file's raw node-id3 tags, in order: the leftover Spotify id
 * (when sp_track_id holds the id), field names, fields duplicating standard frames, multi value
 * formatting, then case. Returns the new tags, the changes ({ check, text }), and what was left alone
 * for a decision (skipped). Pure: check --fix plans with it and writes with it.
 */
const fixRaw = (raw, context) => {
  const tags = _.cloneDeep(raw || {});
  let entries = [].concat(tags.TXXX || []);
  const changes = [];
  const skipped = [];
  const change = (check, text) => changes.push({ check, text });

  if (context.spotifyId && _.some(entries, { description: 'sp_track_id' })) {
    const before = entries.length;
    entries = _.reject(entries, { description: leftoverDescription });
    if (entries.length < before) {
      change('spotify-id', `remove ${leftoverDescription}`);
    }
  }

  // one entry at a time against those kept so far, so two spellings never both become the target
  entries = _.reduce(
    entries,
    (kept, entry) => {
      const target = context.nameTargets.get(nameKey(`TXXX.${entry.description}`));
      if (!target || entry.description === target) {
        return [...kept, entry];
      }
      const existing = [
        ..._.filter(kept, { description: target }),
        ..._.filter(entries, { description: target })
      ];
      if (existing.length === 0) {
        change('names', `rename ${entry.description} to ${target}`);
        return [...kept, { ...entry, description: target }];
      }
      if (_.every(existing, ({ value }) => sameText(value, entry.value))) {
        change('names', `remove ${entry.description} (same as ${target})`);
        return kept;
      }
      skipped.push({
        check: 'names',
        text: `${entry.description} '${shown(entry.value)}' differs from ${target} '${shown(existing[0].value)}'`
      });
      return [...kept, entry];
    },
    []
  );

  entries = _.compact(
    _.map(entries, entry => {
      const key = nameKey(`TXXX.${entry.description}`);
      if (!context.standardKeys.has(key)) {
        return entry;
      }
      const frame = standardFrames[key];
      const texts = frameTexts(tags, frame);
      if (_.some(texts, text => sameText(text, entry.value))) {
        change('standard', `remove ${entry.description} (same as ${frame})`);
        return null;
      }
      const value = texts.length === 0 ? standardValue(frame, entry.value) : null;
      if (value !== null) {
        tags[frame] = value;
        change('standard', `move ${entry.description} to ${frame}: ${shown(entry.value)}`);
        return null;
      }
      skipped.push({
        check: 'standard',
        text:
          texts.length === 0
            ? `${entry.description} '${shown(entry.value)}' is not kept in ${frame}`
            : `${entry.description} '${shown(entry.value)}' differs from ${frame} '${shown(texts[0])}'`
      });
      return entry;
    })
  );

  entries = _.compact(
    _.map(entries, entry => {
      let { value } = entry;
      if (context.multi.has(entry.description)) {
        const clean = cleanMulti(value);
        // a field with no items left (written as '' or ',') is removed rather than kept empty
        if (clean === '') {
          change('multi', `remove ${entry.description} '${value}' (no items)`);
          return null;
        }
        if (clean !== value) {
          change('multi', `${entry.description} '${value}' to '${clean}'`);
          value = clean;
        }
      }
      const casing = context.caseTargets.get(entry.description);
      if (casing) {
        const cased = _.map(
          `${value}`.split(','),
          item => casing.get(_.toLower(item)) || item
        ).join(',');
        if (cased !== value) {
          change('case', `${entry.description} '${value}' to '${cased}'`);
          value = cased;
        }
      }
      return value === entry.value ? entry : { ...entry, value };
    })
  );

  if (entries.length > 0) {
    tags.TXXX = entries;
  } else {
    delete tags.TXXX;
  }
  return { raw: tags, changes, skipped };
};

// the raw frames of a file's tag, read without the audio (node-id3 reads the whole file when given a path)
const readTagRaw = file => {
  const tag = readTagBuffer(file);
  return tag ? _.get(NodeId3.read(tag), 'raw', {}) : {};
};

/**
 * The files check --fix would change and how, reading each candidate file's tag: the songs checked
 * that hold a frame some repair is about (or a multi finding). Resolves to { context, files, skipped }
 * with files [{ file, changes }] (paths relative to mpd.baseDirectory) that have changes.
 */
const planFixes = async ({
  db,
  config,
  results,
  songs,
  readRaw = readTagRaw,
  onProgress = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const context = fixContext(results, config);
  const checked = new Map(_.map(songs, song => [song.id, song.path]));
  const frames = _.uniq(
    _.compact([
      ..._.flatMap(_.get(_.find(results, { name: 'names' }), 'findings', []), 'frames'),
      ..._.map(_.get(_.find(results, { name: 'standard' }), 'findings', []), 'frame'),
      context.spotifyId ? leftoverSpotifyFrame : null,
      ..._.map([...context.caseTargets.keys()], description => `TXXX.${description}`)
    ])
  );
  const artworkFindings = _.get(_.find(results, { name: 'artwork' }), 'findings', []);
  const select = db.prepare('SELECT DISTINCT song_id FROM song_tags WHERE frame_id = ?');
  const candidates = _.uniq([
    ..._.flatMap(frames, frame =>
      _.compact(_.map(select.all(frame), ({ song_id: id }) => checked.get(id)))
    ),
    ..._.map(_.get(_.find(results, { name: 'multi' }), 'findings', []), 'file'),
    ..._.map(_.filter(artworkFindings, 'image'), 'file')
  ]).sort();
  // the Spotify cover each song without one gets, by file
  const covers = _.fromPairs(
    _.map(_.filter(artworkFindings, 'image'), ({ file, image }) => [file, image])
  );

  const files = [];
  const skipped = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const file = candidates[i];
    const planned = fixRaw(readRaw(path.join(baseDirectory, file)), context);
    if (covers[file]) {
      planned.changes.push({ check: 'artwork', text: 'embed the Spotify album cover' });
    }
    if (planned.changes.length > 0) {
      files.push({ file, changes: planned.changes });
    }
    _.each(planned.skipped, item => skipped.push({ file, ...item }));
    if (i % 50 === 49 || i === candidates.length - 1) {
      onProgress(i + 1, candidates.length);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  _.each(_.reject(artworkFindings, 'image'), ({ file }) =>
    skipped.push({
      check: 'artwork',
      file,
      text: 'no Spotify album image (not matched on Spotify)'
    })
  );
  return { context, files, skipped, covers };
};

// an APIC front cover frame (node-id3 raw) from an image URL
const downloadCover = async (url, fetchImpl) => {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`cover ${url}: HTTP ${response.status}`);
  }
  return {
    mime: `${response.headers.get('content-type') || 'image/jpeg'}`.split(';')[0],
    type: { id: 3, name: 'front cover' },
    description: '',
    imageBuffer: Buffer.from(await response.arrayBuffer())
  };
};

/**
 * Writes a plan (planFixes): each file's tag is rewritten once with fixRaw applied to its tag as it is
 * now, keeping frames node-id3 does not understand, plus the Spotify cover of the files in plan.covers
 * (downloaded once per URL with fetchImpl). Resolves to { written, failed } with absolute paths
 * written and [{ file, error }].
 */
const applyFixes = async ({
  config,
  plan,
  write = rewriteTags,
  fetchImpl = fetch,
  onProgress = _.noop
}) => {
  const baseDirectory = path.resolve(config.mpd.baseDirectory);
  const written = [];
  const failed = [];
  // songs of one album share its cover, downloaded once
  const images = new Map();
  const cover = url => {
    if (!images.has(url)) {
      images.set(url, downloadCover(url, fetchImpl));
    }
    return images.get(url);
  };
  for (let i = 0; i < plan.files.length; i += 1) {
    const file = path.join(baseDirectory, plan.files[i].file);
    try {
      const url = _.get(plan, ['covers', plan.files[i].file]);
      const apic = url ? await cover(url) : null;
      const result = write(file, raw => {
        const fixed = fixRaw(raw, plan.context).raw;
        return apic ? { ...fixed, APIC: apic } : fixed;
      });
      if (result instanceof Error) {
        failed.push({ file: plan.files[i].file, error: result.message });
      } else {
        written.push(file);
      }
    } catch (err) {
      failed.push({ file: plan.files[i].file, error: err.message });
    }
    if (i % 50 === 49 || i === plan.files.length - 1) {
      onProgress(i + 1, plan.files.length);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return { written, failed };
};

module.exports = {
  applyFixes,
  cleanMulti,
  fixContext,
  fixRaw,
  fixableChecks,
  planFixes,
  readTagRaw
};
