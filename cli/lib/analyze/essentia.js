const _ = require('lodash');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

/**
 * Audio analysis of the library's own files with Essentia (cli/scripts/essentia-analyze.py, run through
 * uv): tempo and key for the songs ReccoBeats left without them, danceability, mood probabilities, and
 * Discogs styles. Essentia's numbers are on scales of their own, so they go to es_<field> tags, never to
 * rb_* ones.
 */
const analyzeScript = path.join(__dirname, '..', '..', 'scripts', 'essentia-analyze.py');

// the fields analyze writes (analyze.fields picks among them); tempo and key fill TBPM and TKEY when empty
const analysisFields = [
  'tempo',
  'key',
  'danceability',
  'mood_happy',
  'mood_sad',
  'mood_relaxed',
  'mood_aggressive',
  'mood_party',
  'styles'
];

const analysisPrefix = 'es_';
const analyzedName = `${analysisPrefix}analyzed_at`;
const analysisName = field => `${analysisPrefix}${field}`;
// the styles field writes the chosen styles (multi value) and the scores they were chosen from
const stylesName = analysisName('styles');
const styleScoresName = analysisName('style_scores');

/**
 * Which Discogs styles a song gets from its scores (the script's [name, score] pairs, best first):
 * at most max of them, each scoring at least min and at least relative times the best score. The
 * defaults come from a sample of 44 songs (2026-11-28): the scores are low (the best is often under
 * 0.3), so a fixed high threshold leaves most songs without a style.
 */
const defaultStyleSettings = { min: 0.12, relative: 0.5, max: 3 };
const styleSettings = config => ({
  ...defaultStyleSettings,
  ..._.pick(_.get(config, 'analyze.styles') || {}, ['min', 'relative', 'max'])
});
const pickStyles = (scores, { min, relative, max } = defaultStyleSettings) => {
  const best = _.get(scores, [0, 1], 0);
  const cut = Math.max(min, relative * best);
  return _.take(
    _.filter(scores, ([, score]) => score >= cut).map(([name]) => name),
    max
  );
};
// the scores as written to es_style_scores: Name=0.43; Other=0.36 (';', since styles are a comma list)
const styleScoresText = scores =>
  _.map(scores, ([name, score]) => `${name}=${score.toFixed(2)}`).join('; ');

// Essentia names some keys with flats; TKEY gets the sharps ReccoBeats' keys are written with
const sharps = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const keyName = (key, scale) =>
  key ? `${sharps[key] || key}${scale === 'minor' ? 'm' : ''}` : null;

/**
 * The tag writes for one analysis: { custom: [{ name, value }], standard: { TBPM, TKEY } }. Tempo and
 * key go only into empty frames (current: the file's TBPM and TKEY), the rest into es_<field> with
 * es_analyzed_at stamped at now. Styles write es_styles (pickStyles with styles settings, empty when
 * none is sure enough) and es_style_scores. A field the result lacks (a styles only analysis has no
 * tempo or moods) is left as it is.
 */
const analysisWrites = (
  result,
  { fields = analysisFields, current = {}, now = new Date(), styles = defaultStyleSettings } = {}
) => {
  const custom = [];
  const standard = {};
  _.each(fields, field => {
    if (field === 'styles') {
      if (_.isArray(result.styles)) {
        custom.push({ name: stylesName, value: pickStyles(result.styles, styles).join(',') });
        custom.push({ name: styleScoresName, value: styleScoresText(result.styles) });
      }
    } else if (field === 'tempo') {
      if (!current.TBPM && _.isNumber(result.bpm) && result.bpm > 0) {
        standard.TBPM = `${Math.round(result.bpm)}`;
      }
    } else if (field === 'key') {
      const key = keyName(result.key, result.scale);
      if (!current.TKEY && key) {
        standard.TKEY = key;
      }
    } else {
      const value = field.startsWith('mood_')
        ? _.get(result, ['moods', field.slice(5)])
        : result[field];
      if (_.isNumber(value)) {
        custom.push({ name: analysisName(field), value: value.toFixed(2) });
      }
    }
  });
  custom.push({ name: analyzedName, value: now.toISOString().slice(0, 10) });
  return { custom, standard };
};

/**
 * Analyses files with workers processes of the script, each taking files from a shared queue as it
 * finishes one, and calls onResult(result) for each JSON line ({ file, ... } or { file, error }).
 * Resolves when every worker exits; stop() ends them (their files in progress are left for next time),
 * finish() lets each worker finish the file it has and then exit, and active() counts the workers left.
 * Dependencies: spawnProcess, command (uv run --script <script>).
 */
const runAnalysis = ({
  files,
  workers = 4,
  onResult,
  onLog = _.noop,
  spawnProcess = spawn,
  command = ['uv', ['run', '--script', analyzeScript]]
}) => {
  const queue = [...files];
  const children = [];
  let running = 0;
  const done = _.times(Math.min(workers, queue.length), () => {
    const child = spawnProcess(command[0], command[1], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    running += 1;
    // one file at a time, the next once its result arrives, so a fast worker takes more of them
    // a file is a path (every part) or { file, parts }, sent as path<TAB>part,part
    const feed = () => {
      const file = queue.shift();
      if (file) {
        child.stdin.write(
          _.isString(file) ? `${file}\n` : `${file.file}\t${file.parts.join(',')}\n`
        );
      } else {
        child.stdin.end();
      }
    };
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let result;
      try {
        result = JSON.parse(line);
      } catch {
        return;
      }
      onResult(result);
      feed();
    });
    readline.createInterface({ input: child.stderr }).on('line', line => onLog(line));
    feed();
    // a worker that fails to start may report error without close, or both: counted down once
    let ended = false;
    const end = () => {
      if (!ended) {
        ended = true;
        running -= 1;
      }
    };
    return new Promise(resolve => {
      child.on('error', err => {
        onLog(`analysis worker: ${err.message}`);
        end();
        resolve();
      });
      child.on('close', () => {
        end();
        resolve();
      });
    });
  });
  return {
    done: Promise.all(done),
    stop: () => {
      queue.length = 0;
      children.forEach(child => child.kill('SIGTERM'));
    },
    finish: () => {
      queue.length = 0;
    },
    active: () => running
  };
};

/**
 * Library songs to analyse: those without es_analyzed_at, every song with refresh, as paths relative
 * to mpd.baseDirectory, the first limit of them when given.
 */
const songsToAnalyze = (db, { refresh = false, limit = null } = {}) => {
  const rows = db
    .prepare(
      `SELECT s.path FROM songs s
       WHERE ? OR NOT EXISTS (
         SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.frame_id = ?
       )
       ORDER BY s.path`
    )
    .all(refresh ? 1 : 0, `TXXX.${analyzedName}`);
  return _.map(limit ? _.take(rows, limit) : rows, 'path');
};

/**
 * Songs analysed before styles were (es_analyzed_at without es_style_scores), for a styles only
 * analysis, which skips tempo, key, and danceability and takes about a third of the time. Paths as
 * songsToAnalyze gives them.
 */
const songsWithoutStyles = (db, { limit = null } = {}) => {
  const rows = db
    .prepare(
      `SELECT s.path FROM songs s
       WHERE EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.frame_id = ?)
         AND NOT EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.frame_id = ?)
       ORDER BY s.path`
    )
    .all(`TXXX.${analyzedName}`, `TXXX.${styleScoresName}`);
  return _.map(limit ? _.take(rows, limit) : rows, 'path');
};

module.exports = {
  analysisFields,
  analysisName,
  analysisWrites,
  analyzeScript,
  analyzedName,
  defaultStyleSettings,
  keyName,
  pickStyles,
  runAnalysis,
  songsToAnalyze,
  songsWithoutStyles,
  styleSettings
};
