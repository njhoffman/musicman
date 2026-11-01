const _ = require('lodash');

const { nextRepeat, repeatCycle, spotifyPlayer } = require('../menu/players.js');
const { reportErrors } = require('./common.js');
const logger = require('../utils/logger.js');

const shuffleModes = ['on', 'off', 'toggle'];
// repeat next steps through off, playlist, track
const repeatModes = [...repeatCycle, 'next'];

const usage =
  'musicman spotify [shuffle on|off|toggle] [repeat off|playlist|track|next], status without arguments';

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
 * spotify: shows or changes shuffle and repeat in the Spotify desktop app (MPRIS, through playerctl).
 * Smart Shuffle cannot be controlled this way: neither MPRIS nor the Web API expose it.
 */
const spotifyCommand = async ({ options = {}, player = spotifyPlayer() }) => {
  const settings = parseSettings(options.terms || []);
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
  description: 'Show or set shuffle and repeat in the Spotify desktop app',
  usage,
  switches: [],
  completes: [],
  func: reportErrors(spotifyCommand),
  run: spotifyCommand,
  defaultTarget,
  targetArgs: false,
  parseSettings
};
