const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * What musicman analyze --idle (the musicman-analyze timer) goes by: the load average, whether the
 * computer is on AC power, and a lock so a manual analyze and the background one never analyse the same
 * songs at once. Settings are analyze.idle (idleSettings).
 */

// analyze.idle, with its defaults: start when the 15 minute load average is under load; stop once the
// 1 minute load of other processes (the workers' own share taken out) stays over busyLoad for busyMinutes
const idleDefaults = { load: 1, busyLoad: 2, busyMinutes: 2, workers: 2 };
const idleSettings = config => ({ ...idleDefaults, ..._.get(config, 'analyze.idle', {}) });

// the 1, 5 and 15 minute load averages
const loadAverages = (read = () => fs.readFileSync('/proc/loadavg', 'utf8')) => {
  const [one, five, fifteen] = _.map(read().trim().split(/\s+/).slice(0, 3), Number);
  return { one, five, fifteen };
};

/**
 * Whether the computer runs on battery: a battery is discharging, or there are batteries and no mains or
 * USB power source is online. A computer without batteries (a desktop) is never on battery.
 */
const onBattery = (directory = '/sys/class/power_supply') => {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return false;
  }
  const read = (name, field) => {
    try {
      return fs.readFileSync(path.join(directory, name, field), 'utf8').trim();
    } catch {
      return '';
    }
  };
  const supplies = _.map(names, name => ({
    type: read(name, 'type'),
    online: read(name, 'online'),
    status: read(name, 'status')
  }));
  const batteries = _.filter(supplies, { type: 'Battery' });
  if (batteries.length === 0) {
    return false;
  }
  if (_.some(batteries, { status: 'Discharging' })) {
    return true;
  }
  return !_.some(supplies, ({ type, online }) => ['Mains', 'USB'].includes(type) && online === '1');
};

// $XDG_RUNTIME_DIR/musicman/analyze.lock, /run/user/<uid> without XDG_RUNTIME_DIR
const lockFile = (env = process.env) =>
  path.join(env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'musicman', 'analyze.lock');

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

// the pid of a running analyze holding the lock, or null (no lock, or one left by a process that died)
const lockHolder = file => {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return pid > 0 && pid !== process.pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
};

/**
 * Takes the analyze lock for this process: resolves to a release function, or throws naming the pid of
 * the analyze that holds it. A lock left by a process that is gone is taken over.
 */
const takeLock = file => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      const release = () => {
        if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) {
          fs.rmSync(file, { force: true });
        }
      };
      return release;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      const holder = lockHolder(file);
      if (holder) {
        const error = new Error(`another musicman analyze is running (pid ${holder})`);
        error.holder = holder;
        throw error;
      }
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error(`could not take the analyze lock ${file}`);
};

/**
 * Whether a background analyze should start now: { ready, reason }. Not on battery, the 15 minute load
 * average under analyze.idle.load, no other analyze running, and songs left (left() counts them).
 */
const idleReady = ({ settings, load, battery, holder, left }) => {
  if (battery) {
    return { ready: false, reason: 'on battery' };
  }
  if (!(load.fifteen < settings.load)) {
    return { ready: false, reason: `15 minute load ${load.fifteen} is not under ${settings.load}` };
  }
  if (holder) {
    return { ready: false, reason: `another musicman analyze is running (pid ${holder})` };
  }
  const songs = left();
  if (songs === 0) {
    return { ready: false, reason: 'every song is analysed' };
  }
  return { ready: true, reason: `${songs} songs to analyse`, songs };
};

/**
 * Watches a background analyze while it runs: every sampleMs, stop(reason) is called once when the
 * computer goes on battery, or once the 1 minute load less the workers' own (workers()) stays over
 * analyze.idle.busyLoad for busyMinutes. Returns a function that ends the watch.
 */
const watchIdle = ({
  settings,
  workers,
  stop,
  load = loadAverages,
  battery = onBattery,
  sampleMs = 30000,
  setTimer = setInterval,
  clearTimer = clearInterval
}) => {
  const needed = Math.max(1, Math.ceil((settings.busyMinutes * 60000) / sampleMs));
  let busySamples = 0;
  let stopped = false;
  const timer = setTimer(() => {
    if (stopped) {
      return;
    }
    if (battery()) {
      stopped = true;
      stop('on battery');
      return;
    }
    const others = load().one - workers();
    busySamples = others > settings.busyLoad ? busySamples + 1 : 0;
    if (busySamples >= needed) {
      stopped = true;
      stop(
        `other processes kept the load over ${settings.busyLoad} for ${settings.busyMinutes} minutes`
      );
    }
  }, sampleMs);
  if (timer && timer.unref) {
    timer.unref();
  }
  return () => clearTimer(timer);
};

module.exports = {
  idleDefaults,
  idleReady,
  idleSettings,
  loadAverages,
  lockFile,
  lockHolder,
  onBattery,
  takeLock,
  watchIdle
};
