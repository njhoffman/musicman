const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  idleDefaults,
  idleReady,
  idleSettings,
  loadAverages,
  lockFile,
  lockHolder,
  onBattery,
  takeLock,
  watchIdle
} = require('./idle.js');

describe('Idle analysis', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-idle-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should read the load averages and the settings with their defaults', () => {
    expect(loadAverages(() => '0.52 0.80 1.25 2/1043 98765\n')).to.deep.equal({
      one: 0.52,
      five: 0.8,
      fifteen: 1.25
    });
    expect(idleSettings({})).to.deep.equal(idleDefaults);
    expect(idleSettings({ analyze: { idle: { workers: 1 } } })).to.include({ workers: 1, load: 1 });
  });

  describe('onBattery', () => {
    // a power_supply directory with the supplies given as { name: { type, online, status } }
    const supplies = list => {
      const root = path.join(dir, 'power_supply');
      fs.rmSync(root, { recursive: true, force: true });
      Object.entries(list).forEach(([name, fields]) => {
        fs.mkdirSync(path.join(root, name), { recursive: true });
        Object.entries(fields).forEach(([field, value]) =>
          fs.writeFileSync(path.join(root, name, field), `${value}\n`)
        );
      });
      return root;
    };

    it('should be on AC with mains or USB power online, or without batteries', () => {
      const battery = { type: 'Battery', status: 'Full' };
      expect(onBattery(supplies({ ADP1: { type: 'Mains', online: 1 }, BAT0: battery }))).to.equal(
        false
      );
      expect(
        onBattery(
          supplies({
            ADP1: { type: 'Mains', online: 0 },
            'ucsi-source-psy-USBC000:002': { type: 'USB', online: 1 },
            BAT0: { type: 'Battery', status: 'Charging' }
          })
        )
      ).to.equal(false);
      expect(onBattery(supplies({}))).to.equal(false);
      expect(onBattery(path.join(dir, 'missing'))).to.equal(false);
    });

    it('should be on battery when one discharges, or no power source is online', () => {
      expect(
        onBattery(
          supplies({
            ADP1: { type: 'Mains', online: 1 },
            BAT0: { type: 'Battery', status: 'Discharging' }
          })
        )
      ).to.equal(true);
      expect(
        onBattery(
          supplies({
            ADP1: { type: 'Mains', online: 0 },
            BAT0: { type: 'Battery', status: 'Not charging' }
          })
        )
      ).to.equal(true);
    });
  });

  describe('lock', () => {
    it('should live in the runtime directory', () => {
      expect(lockFile({ XDG_RUNTIME_DIR: '/run/x' })).to.equal('/run/x/musicman/analyze.lock');
    });

    it('should be taken once, released, and refused while a live process holds it', () => {
      const file = path.join(dir, 'musicman', 'analyze.lock');
      const release = takeLock(file);
      expect(fs.readFileSync(file, 'utf8')).to.equal(`${process.pid}\n`);
      release();
      expect(fs.existsSync(file)).to.equal(false);
      // the parent of the test run is alive
      fs.writeFileSync(file, `${process.ppid}\n`);
      expect(lockHolder(file)).to.equal(process.ppid);
      expect(() => takeLock(file)).to.throw(
        `another musicman analyze is running (pid ${process.ppid})`
      );
      expect(fs.readFileSync(file, 'utf8')).to.equal(`${process.ppid}\n`);
    });

    it('should take over a lock left by a process that is gone', () => {
      const file = path.join(dir, 'analyze.lock');
      const { pid } = spawnSync(process.execPath, ['-e', '']);
      fs.writeFileSync(file, `${pid}\n`);
      expect(lockHolder(file)).to.equal(null);
      const release = takeLock(file);
      expect(fs.readFileSync(file, 'utf8')).to.equal(`${process.pid}\n`);
      release();
    });
  });

  describe('idleReady', () => {
    const settings = idleDefaults;
    const quiet = { one: 0.2, five: 0.3, fifteen: 0.4 };
    const ready = extra =>
      idleReady({ settings, load: quiet, battery: false, holder: null, left: () => 12, ...extra });

    it('should start when idle on AC with songs left', () => {
      expect(ready()).to.deep.equal({ ready: true, reason: '12 songs to analyse', songs: 12 });
    });

    it('should say why it does not start', () => {
      expect(ready({ battery: true }).reason).to.equal('on battery');
      expect(ready({ load: { ...quiet, fifteen: 1 } }).reason).to.equal(
        '15 minute load 1 is not under 1'
      );
      expect(ready({ holder: 42 }).reason).to.equal('another musicman analyze is running (pid 42)');
      expect(ready({ left: () => 0 })).to.deep.equal({
        ready: false,
        reason: 'every song is analysed'
      });
      // the songs are only counted once everything else allows a start
      expect(
        ready({
          battery: true,
          left: () => {
            throw new Error('counted');
          }
        }).ready
      ).to.equal(false);
    });
  });

  describe('watchIdle', () => {
    // a timer driven by hand: tick() runs the sample once
    const manualTimer = () => {
      const timer = { fn: null, cleared: false };
      return {
        timer,
        setTimer: fn => {
          timer.fn = fn;
          return timer;
        },
        clearTimer: t => {
          t.cleared = true;
        },
        tick: () => timer.fn()
      };
    };

    it('should stop once other processes keep the load up for busyMinutes, its workers left out', () => {
      const clock = manualTimer();
      const loads = [3, 4.5, 4.5, 4.5, 4.5];
      const stops = [];
      const unwatch = watchIdle({
        settings: { ...idleDefaults, busyLoad: 2, busyMinutes: 1 },
        workers: () => 2,
        stop: reason => stops.push(reason),
        load: () => ({ one: loads.shift() }),
        battery: () => false,
        sampleMs: 30000,
        ...clock
      });
      // 3 - 2 workers = 1: not busy; then 2.5 twice in a row (one minute of 30 s samples)
      clock.tick();
      clock.tick();
      expect(stops).to.be.empty;
      clock.tick();
      expect(stops).to.deep.equal(['other processes kept the load over 2 for 1 minutes']);
      clock.tick();
      expect(stops).to.have.length(1);
      unwatch();
      expect(clock.timer.cleared).to.equal(true);
    });

    it('should count busy samples again after a quiet one, and stop on battery', () => {
      const clock = manualTimer();
      const loads = [5, 1, 5];
      let battery = false;
      const stops = [];
      watchIdle({
        settings: { ...idleDefaults, busyMinutes: 1 },
        workers: () => 0,
        stop: reason => stops.push(reason),
        load: () => ({ one: loads.shift() }),
        battery: () => battery,
        ...clock
      });
      clock.tick();
      clock.tick();
      clock.tick();
      expect(stops).to.be.empty;
      battery = true;
      clock.tick();
      expect(stops).to.deep.equal(['on battery']);
    });
  });
});
