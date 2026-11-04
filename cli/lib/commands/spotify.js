const _ = require('lodash');

const { outputFormat } = require('../output/formats.js');
const { nextRepeat, repeatCycle, spotifyPlayer } = require('../player/players.js');
const { describeQueue, spotifyQueue } = require('../spotify/queue.js');
const { lazyUserClient } = require('../spotify/userClient.js');
const { reportErrors } = require('./common.js');
const logger = require('../utils/logger.js');

const shuffleModes = ['on', 'off', 'toggle'];
// repeat next steps through off, playlist, track
const repeatModes = [...repeatCycle, 'next'];

const usage =
  'musicman spotify [shuffle on|off|toggle] [repeat off|playlist|track|next], status without arguments; musicman spotify queue [--format json]';

/**
 * The changes asked for by terms: [{ setting: 'shuffle' | 'repeat', mode }]. Throws for anything else,
 * so a typo never sends a command.
 */
const parseSettings = terms => {
  const settings = [];
  for (let i = 0; i < terms.length; i += 2) {
    const setting = _.toLower(terms[i]);
    const mode = _.toLower(terms[i + 1] || '');
    const modes = { shuffle: shuffleModes, repeat: repeatModes }[setting];
    if (!modes) {
      throw new Error(`Unknown setting '${terms[i]}': ${usage}`);
    }
    if (!modes.includes(mode)) {
      throw new Error(`${setting} takes ${modes.join(', ')}, not '${terms[i + 1] || ''}'`);
    }
    settings.push({ setting, mode });
  }
  return settings;
};

const describeState = ({ shuffle, repeat }) =>
  `shuffle ${shuffle === null ? 'unknown' : shuffle ? 'on' : 'off'}, repeat ${repeat || 'unknown'}`;

/**
 * spotify queue: the track playing and the next few (Web API), as lines or with --format json as the contract
 * gives it (docs/09-contract.md), so other programs need no token of their own
 */
const queueCommand = async ({ options, config, env, client, out }) => {
  const format = outputFormat(options.switches || {});
  if (!['default', 'json'].includes(format)) {
    throw new Error(`spotify queue prints lines or --format json, not ${format}`);
  }
  const queue = await spotifyQueue(client || lazyUserClient(config, env));
  if (format === 'json') {
    out.write(`${JSON.stringify(queue, null, 2)}\n`);
  } else {
    describeQueue(queue).forEach(line => logger.info(line));
  }
  return queue;
};

/**
 * spotify: shows or changes shuffle and repeat in the Spotify desktop app (MPRIS, through playerctl), or with
 * queue shows what plays next. Smart Shuffle cannot be controlled this way: neither MPRIS nor the Web API
 * expose it.
 */
const spotifyCommand = async ({
  options = {},
  config,
  env = process.env,
  player = spotifyPlayer(),
  client,
  out = process.stdout
}) => {
  const terms = options.terms || [];
  if (_.toLower(terms[0]) === 'queue') {
    if (terms.length > 1) {
      throw new Error(`spotify queue takes no more words: ${usage}`);
    }
    return queueCommand({ options, config, env, client, out });
  }
  const settings = parseSettings(terms);
  const before = await player.state();
  if (!before.state) {
    throw new Error(`Spotify is not running${before.error ? ` (${before.error})` : ''}`);
  }
  for (const { setting, mode } of settings) {
    if (setting === 'shuffle') {
      await player.shuffle(mode);
    } else {
      await player.repeat(mode === 'next' ? nextRepeat(before.repeat) : mode);
    }
  }
  const after = settings.length > 0 ? await player.state() : before;
  logger.info(`Spotify: ${describeState(after)}`);
  return { shuffle: after.shuffle, repeat: after.repeat };
};

const defaultTarget = baseDirectory => baseDirectory;

module.exports = {
  name: 'spotify',
  description:
    'Show or set shuffle and repeat in the Spotify desktop app (the same as musicman player spotify shuffle|repeat), or show the queue',
  usage,
  switches: ['format'],
  switchHelp: { format: 'With queue, the output format: default, or json' },
  completes: [],
  // each setting word is followed by one of its modes
  pairs: { shuffle: shuffleModes, repeat: repeatModes },
  func: reportErrors(spotifyCommand),
  run: spotifyCommand,
  defaultTarget,
  targetArgs: false,
  parseSettings
};
