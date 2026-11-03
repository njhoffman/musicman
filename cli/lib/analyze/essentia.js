const _ = require('lodash');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

/**
 * Audio analysis of the library's own files with Essentia (cli/scripts/essentia-analyze.py, run through
 * uv): tempo and key for the songs ReccoBeats left without them, danceability, and mood probabilities.
 * Essentia's numbers are on scales of their own, so they go to es_<field> tags, never to rb_* ones.
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
  'mood_party'
];

const analysisPrefix = 'es_';
const analyzedName = `${analysisPrefix}analyzed_at`;
const analysisName = field => `${analysisPrefix}${field}`;

// Essentia names some keys with flats; TKEY gets the sharps ReccoBeats' keys are written with
const sharps = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const keyName = (key, scale) =>
  key ? `${sharps[key] || key}${scale === 'minor' ? 'm' : ''}` : null;

/**
 * The tag writes for one analysis: { custom: [{ name, value }], standard: { TBPM, TKEY } }. Tempo and
 * key go only into empty frames (current: the file's TBPM and TKEY), the rest into es_<field> with
 * es_analyzed_at stamped at now.
 */
const analysisWrites = (
  result,
  { fields = analysisFields, current = {}, now = new Date() } = {}
) => {
  const custom = [];
  const standard = {};
  _.each(fields, field => {
    if (field === 'tempo') {
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
 * Resolves when every worker exits; stop() ends them (their files in progress are left for next time).
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
  const done = _.times(Math.min(workers, queue.length), () => {
    const child = spawnProcess(command[0], command[1], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    // one file at a time, the next once its result arrives, so a fast worker takes more of them
    const feed = () => {
      const file = queue.shift();
      if (file) {
        child.stdin.write(`${file}\n`);
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
    return new Promise(resolve => {
      child.on('error', err => {
        onLog(`analysis worker: ${err.message}`);
        resolve();
      });
      child.on('close', () => resolve());
    });
  });
  return {
    done: Promise.all(done),
    stop: () => {
      queue.length = 0;
      children.forEach(child => child.kill('SIGTERM'));
    }
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

module.exports = {
  analysisFields,
  analysisName,
  analysisWrites,
  analyzeScript,
  analyzedName,
  keyName,
  runAnalysis,
  songsToAnalyze
};
