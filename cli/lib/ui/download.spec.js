const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { downloadJobs, importJobs, logTail } = require('./download.js');

describe('UI downloads', () => {
  const idA = 'AAAAAAAAAAAAAAAAAAAAAA';
  const idB = 'BBBBBBBBBBBBBBBBBBBBBB';
  const idC = 'CCCCCCCCCCCCCCCCCCCCCC';
  let directory;
  let config;
  let runs;
  let kills;
  let groups;
  let alive;
  let spawned;

  // process.kill: signal 0 checks a process (pid) or a group (-pid), other signals are recorded
  const kill = (pid, signal) => {
    if (signal === 0) {
      const exists = pid < 0 ? groups.has(-pid) : alive.has(pid);
      if (!exists) {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }
      return true;
    }
    kills.push([pid, signal]);
    return true;
  };
  const spawnProcess = (command, args, options) => {
    spawned.push({ command, args, options });
    alive.add(4242);
    return { pid: 4242, unref: () => {} };
  };
  const jobs = () =>
    downloadJobs({
      config,
      running: () => runs,
      spawnProcess,
      kill,
      script: '/repo/cli/scripts/spotdl-download.js',
      nodePath: '/usr/bin/node'
    });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-ui-download-'));
    config = { sync: { downloadDirectory: directory } };
    runs = [];
    kills = [];
    groups = new Set();
    alive = new Set();
    spawned = [];
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        tracks: [
          { trackId: idA },
          { trackId: idB },
          { trackId: idC, importedAt: '2026-11-01T00:00:00.000Z' }
        ]
      })
    );
    fs.writeFileSync(path.join(directory, `A - One [${idA}].mp3`), '');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should count the manifest tracks by state when nothing is downloading', () => {
    expect(jobs().status()).to.deep.equal({
      running: null,
      queued: 1,
      downloaded: 1,
      imported: 1,
      log: []
    });
  });

  it('should start the script detached with its output in download.log, and refuse a second start', () => {
    const downloads = jobs();
    expect(downloads.start()).to.deep.equal({ started: true, pid: 4242 });
    expect(spawned).to.have.length(1);
    expect(spawned[0]).to.deep.include({
      command: '/usr/bin/node',
      args: ['/repo/cli/scripts/spotdl-download.js']
    });
    expect(spawned[0].options).to.include({ cwd: '/repo/cli', detached: true });
    expect(fs.existsSync(path.join(directory, 'download.log'))).to.equal(true);
    // the script has not written its run report yet, but it runs
    expect(downloads.status().running).to.include({ pid: 4242 });
    expect(() => downloads.start()).to.throw('A download is running already (pid 4242)');
    alive.delete(4242);
    expect(downloads.status().running).to.equal(null);
  });

  it('should refuse to start without a manifest', () => {
    fs.rmSync(path.join(directory, 'manifest.json'));
    expect(() => jobs().start()).to.throw(/No download manifest yet/);
    expect(spawned).to.deep.equal([]);
  });

  it('should cancel a download the page started by its process group, not one from a terminal', () => {
    runs = [{ command: 'download', pid: 500, startedAt: '2026-11-03T00:00:00.000Z', id: 'r1' }];
    expect(() => jobs().cancel()).to.throw(/started in a terminal/);
    const terminal = jobs().status();
    expect(terminal.running).to.include({ pid: 500, fromPage: false });
    expect(terminal.log).to.deep.equal([]);
    groups.add(500);
    expect(jobs().status().running).to.include({ fromPage: true });
    expect(jobs().cancel()).to.deep.equal({ cancelled: true, pid: 500 });
    expect(kills).to.deep.equal([[-500, 'SIGTERM']]);
    runs = [];
    expect(() => jobs().cancel()).to.throw('No download is running');
  });

  it('should show the last lines of the output without escape codes and progress redraws', () => {
    const file = path.join(directory, 'download.log');
    fs.writeFileSync(
      file,
      'Batch 1/2\n\u001b[32mDownloaded "A - One"\u001b[0m\r  10%\r  55%\r\nmissing: B - Two\n\n'
    );
    expect(logTail(file)).to.deep.equal([
      'Batch 1/2',
      'Downloaded "A - One"',
      '  10%',
      '  55%',
      'missing: B - Two'
    ]);
    expect(logTail(file, 2)).to.deep.equal(['  55%', 'missing: B - Two']);
    expect(logTail(path.join(directory, 'none.log'))).to.deep.equal([]);
    expect(jobs().status().log).to.deep.equal(logTail(file));
  });

  it('should download only the first N queued tracks when given a limit, refusing a bad one', () => {
    const downloads = jobs();
    expect(() => downloads.start({ limit: 0 })).to.throw('limit must be a positive whole number');
    expect(() => downloads.start({ limit: 2.5 })).to.throw('limit must be a positive whole number');
    downloads.start({ limit: 3 });
    expect(spawned[0].args).to.deep.equal(['/repo/cli/scripts/spotdl-download.js', '--limit', '3']);
  });

  describe('imports', () => {
    const imports = () =>
      importJobs({
        config,
        running: () => runs,
        spawnProcess,
        kill,
        cli: '/repo/cli/lib/cli.js',
        nodePath: '/usr/bin/node'
      });

    it('should run sync --import --yes detached, with its output in import.log', () => {
      expect(imports().start()).to.deep.equal({ started: true, pid: 4242 });
      expect(spawned[0]).to.deep.include({
        command: '/usr/bin/node',
        args: ['/repo/cli/lib/cli.js', 'sync', '--import', '--yes']
      });
      expect(spawned[0].options).to.include({ cwd: '/repo/cli', detached: true });
      expect(fs.existsSync(path.join(directory, 'import.log'))).to.equal(true);
    });

    it('should see an import from a terminal, and never start one beside a download or another import', () => {
      runs = [{ command: 'sync', args: ['sync', '--import'], pid: 600, startedAt: 't' }];
      expect(imports().status().running).to.include({ pid: 600, fromPage: false });
      expect(() => imports().start()).to.throw('An import is running already (pid 600)');
      // a download does not start beside it either: the import takes its files
      expect(() => jobs().start()).to.throw('An import is running: download when it is done');
      runs = [{ command: 'download', pid: 700, startedAt: 't' }];
      expect(() => imports().start()).to.throw('A download is running: import when it is done');
      runs = [{ command: 'sync', args: ['sync', '--match'], pid: 800, startedAt: 't' }];
      expect(imports().status().running).to.equal(null);
      expect(spawned).to.deep.equal([]);
    });
  });
});
