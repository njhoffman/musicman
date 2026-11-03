const _ = require('lodash');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const {
  downloadTrackId,
  downloadedFiles,
  pendingTracks,
  readManifest,
  removePartialDownloads,
  spotdlCommand
} = require('./download.js');
const { main: runMain, stopStrays, strayProcesses } = require('../../scripts/spotdl-download.js');
const { listRuns } = require('../utils/runs.js');

describe('Spotify Downloads', () => {
  const idA = 'AAAAAAAAAAAAAAAAAAAAAA';
  const idB = 'BBBBBBBBBBBBBBBBBBBBBB';
  const idC = 'CCCCCCCCCCCCCCCCCCCCCC';
  let directory;
  let config;
  const manifest = {
    tracks: [
      { trackId: idA, url: `https://open.spotify.com/track/${idA}`, artists: 'A', name: 'One' },
      { trackId: idB, url: `https://open.spotify.com/track/${idB}`, artists: 'B', name: 'Two' },
      {
        trackId: idC,
        url: `https://open.spotify.com/track/${idC}`,
        artists: 'C',
        name: 'Three',
        importedAt: '2026-10-20T00:00:00.000Z'
      }
    ]
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-download-'));
    config = {
      sync: { downloadDirectory: directory, spotdlCommand: 'spotdl --threads 2' },
      logger: { archive: { directory: path.join(directory, 'runs') } }
    };
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should find the track id in the file name or the WOAS url', () => {
    expect(downloadTrackId(`/d/A - One [${idA}].mp3`)).to.equal(idA);
    expect(
      downloadTrackId('/d/A - One.mp3', { WOAS: { url: `https://open.spotify.com/track/${idB}` } })
    ).to.equal(idB);
    expect(downloadTrackId('/d/A - One.mp3', {})).to.be.null;
  });

  it('should list tracks not downloaded and not imported yet', () => {
    fs.writeFileSync(path.join(directory, `A - One [${idA}].mp3`), '');
    fs.writeFileSync(path.join(directory, 'notes.txt'), '');
    const files = downloadedFiles(config);
    expect(files).to.deep.equal([path.join(directory, `A - One [${idA}].mp3`)]);
    expect(pendingTracks(manifest, files).map(({ trackId }) => trackId)).to.deep.equal([idB]);
  });

  it('should run spotDL with the track id in the output template and skip existing files', () => {
    const [command, args, options] = spotdlCommand(config, ['url-1', 'url-2']);
    expect(command).to.equal('spotdl');
    // run in the download directory with a file name template: spotDL strips the dot of .musicman
    expect(options).to.deep.equal({ cwd: directory });
    expect(args).to.deep.equal([
      '--threads',
      '2',
      'download',
      'url-1',
      'url-2',
      '--output',
      '{artists} - {title} [{track-id}].{output-ext}',
      '--format',
      'mp3',
      '--overwrite',
      'skip',
      '--print-errors'
    ]);
  });

  it('should delete only the incomplete downloads', () => {
    fs.writeFileSync(path.join(directory, 'a.mp3'), 'tagged');
    fs.writeFileSync(path.join(directory, 'b.mp3'), 'cut');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'cut');
    const isComplete = file => fs.readFileSync(file, 'utf8') === 'tagged';
    expect(removePartialDownloads(config, { isComplete })).to.deep.equal(['b.mp3']);
    expect(fs.readdirSync(directory).sort()).to.deep.equal(['a.mp3', 'notes.txt']);
  });

  it('should read the manifest, or null when there is none', () => {
    expect(readManifest(config)).to.be.null;
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    expect(readManifest(config).tracks).to.have.length(3);
  });

  describe('download script', () => {
    let log;
    let error;
    // every download is complete and no run is archived, unless a test says otherwise
    const main = options =>
      runMain({
        isComplete: () => true,
        archive: false,
        signals: new EventEmitter(),
        strays: { find: () => [] },
        ...options
      });

    beforeEach(() => {
      log = sinon.stub(console, 'log');
      error = sinon.stub(console, 'error');
    });

    afterEach(() => {
      log.restore();
      error.restore();
    });

    it('should download the pending tracks with spotDL and report what is left', async () => {
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      const runs = [];
      const spawn = (command, args, options) => {
        expect(options).to.include({ cwd: directory, stdio: 'inherit' });
        runs.push([command, args.filter(arg => arg.startsWith('https://'))]);
        // spotDL downloads the first track only
        fs.writeFileSync(path.join(directory, `B - Two [${idB}].mp3`), '');
        return { status: 0 };
      };
      fs.writeFileSync(path.join(directory, `A - One [${idA}].mp3`), '');
      expect(await main({ args: [], config, spawn })).to.equal(0);
      expect(runs).to.deep.equal([['spotdl', [`https://open.spotify.com/track/${idB}`]]]);
    });

    it('should download only the first N pending tracks with --limit', async () => {
      const idC = 'CCCCCCCCCCCCCCCCCCCCCC';
      const three = {
        ...manifest,
        tracks: [
          ...manifest.tracks,
          { ...manifest.tracks[0], trackId: idC, url: `https://open.spotify.com/track/${idC}` }
        ]
      };
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(three));
      const runs = [];
      const spawn = (command, args) => {
        const urls = args.filter(arg => arg.startsWith('https://'));
        runs.push(urls);
        urls.forEach(url =>
          fs.writeFileSync(path.join(directory, `X [${url.split('/').pop()}].mp3`), '')
        );
        return { status: 0 };
      };
      expect(await main({ args: ['--limit', '2'], config, spawn })).to.equal(0);
      expect(runs).to.deep.equal([_.map(three.tracks.slice(0, 2), 'url')]);
      expect(await main({ args: ['--limit=5'], config, spawn })).to.equal(0);
      expect(runs[1]).to.deep.equal([three.tracks[2].url]);
      expect(await main({ args: ['--limit', 'x'], config, spawn })).to.equal(1);
      expect(runs).to.have.length(2);
    });

    it('should try the tracks of a failed batch one by one, so one bad track does not block the rest', async () => {
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      const runs = [];
      const spawn = (command, args) => {
        const urls = args.filter(arg => arg.startsWith('https://'));
        runs.push(urls);
        // spotDL cannot look up track A, and a run with it fails before downloading anything
        if (urls.some(url => url.endsWith(idA))) {
          return { status: 1 };
        }
        urls.forEach(url =>
          fs.writeFileSync(path.join(directory, `X [${url.split('/').pop()}].mp3`), '')
        );
        return { status: 0 };
      };
      expect(await main({ args: [], config, spawn })).to.equal(1);
      // C was imported already
      expect(runs).to.deep.equal([
        [manifest.tracks[0].url, manifest.tracks[1].url],
        [manifest.tracks[0].url],
        [manifest.tracks[1].url]
      ]);
      expect(fs.existsSync(path.join(directory, `X [${idB}].mp3`))).to.equal(true);
      expect(log.args.flat().join('\n')).to.include(`missing: ${manifest.tracks[0].artists}`);
    });

    it('should delete files of stopped downloads first and download those tracks again', async () => {
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      const partial = path.join(directory, `A - One [${idA}].mp3`);
      fs.writeFileSync(partial, 'cut short');
      fs.writeFileSync(path.join(directory, `B - Two [${idB}].mp3`), 'tagged');
      const runs = [];
      const spawn = (command, args) => {
        runs.push(args.filter(arg => arg.startsWith('https://')));
        return { status: 0 };
      };
      const isComplete = file => fs.readFileSync(file, 'utf8') === 'tagged';
      await main({ args: [], config, spawn, isComplete });
      expect(fs.existsSync(partial)).to.equal(false);
      expect(runs).to.deep.equal([[manifest.tracks[0].url]]);
    });

    it('should archive the run as a download, and refuse to start beside another download', async () => {
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      const spawn = (command, args) => {
        args
          .filter(arg => arg.startsWith('https://'))
          .forEach(url =>
            fs.writeFileSync(path.join(directory, `X [${url.split('/').pop()}].mp3`), '')
          );
        return { status: 0 };
      };
      expect(await main({ args: [], config, spawn, archive: true })).to.equal(0);
      const [report] = listRuns(path.join(directory, 'runs'));
      expect(report).to.include({ command: 'download', status: 'ok' });
      expect(report.result).to.deep.include({ downloaded: 2, missing: [] });
      // a running download of this process blocks a second one
      fs.writeFileSync(
        path.join(directory, 'runs', '29990101-000000-download.json'),
        JSON.stringify({ command: 'download', status: 'running', pid: process.pid })
      );
      const spy = sinon.spy();
      expect(await main({ args: [], config, spawn: spy })).to.equal(1);
      expect(spy).to.not.have.been.called;
      expect(error.args.flat().join('\n')).to.include('A download is running already');
      // nor beside an import, which takes the downloaded files
      fs.writeFileSync(
        path.join(directory, 'runs', '29990101-000000-download.json'),
        JSON.stringify({
          command: 'sync',
          args: ['sync', '--import'],
          status: 'running',
          pid: process.pid
        })
      );
      expect(await main({ args: [], config, spawn: spy })).to.equal(1);
      expect(spy).to.not.have.been.called;
      expect(error.args.flat().join('\n')).to.include('An import is running');
    });

    it('should stop spotDL on a signal, delete the unfinished file, and archive the run as interrupted', async () => {
      const many = {
        tracks: _.times(25, n => {
          const id = `${n}`.padStart(22, 'T');
          return {
            trackId: id,
            url: `https://open.spotify.com/track/${id}`,
            artists: 'A',
            name: `${n}`
          };
        })
      };
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(many));
      const signals = new EventEmitter();
      const child = { exitCode: null, kill: sinon.spy() };
      const runs = [];
      const spawn = (command, args, options, onChild) => {
        runs.push(args.filter(arg => arg.startsWith('https://')));
        onChild(child);
        // spotDL has written part of the first track when the stop comes
        fs.writeFileSync(
          path.join(directory, `A - 0 [${many.tracks[0].trackId}].mp3`),
          'cut short'
        );
        signals.emit('SIGTERM', 'SIGTERM');
        return { status: null, signal: 'SIGTERM' };
      };
      const isComplete = file => fs.readFileSync(file, 'utf8') === 'tagged';
      const code = await main({ args: [], config, spawn, isComplete, signals, archive: true });
      expect(code).to.equal(130);
      expect(child.kill).to.have.been.calledWith('SIGTERM');
      // the second batch never starts
      expect(runs).to.have.length(1);
      expect(downloadedFiles(config)).to.deep.equal([]);
      const [report] = listRuns(path.join(directory, 'runs'));
      expect(report).to.include({ command: 'download', status: 'interrupted', exitCode: 130 });
      expect(signals.listenerCount('SIGTERM')).to.equal(0);
    });

    it('should find and end the conversions spotDL leaves writing into the download directory', async () => {
      const list = () =>
        [
          `  101 ffmpeg -i /t/a.webm ${directory}/A - One [${idA}].mp3`,
          `  102 ffmpeg -i /t/b.webm ${directory}-other/B.mp3`,
          `  103 nvim ${directory}/manifest.json`,
          `  104 /usr/bin/ffmpeg -i /t/c.webm ${directory}/C.mp3`,
          '  105 bash'
        ].join('\n');
      expect(strayProcesses(directory, { list })).to.deep.equal([101, 104]);
      const kill = sinon.spy();
      let calls = 0;
      // the conversion exits after the first check
      const find = () => (calls++ === 0 ? [101] : []);
      expect(await stopStrays(directory, { find, kill })).to.deep.equal([101]);
      expect(kill).to.have.been.calledOnceWith(101, 'SIGTERM');
    });

    it('should not run spotDL in a dry run or without a manifest', async () => {
      const spawn = sinon.spy();
      expect(await main({ args: [], config, spawn })).to.equal(1);
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      expect(await main({ args: ['--dry-run'], config, spawn })).to.equal(0);
      expect(spawn).to.not.have.been.called;
    });
  });
});
