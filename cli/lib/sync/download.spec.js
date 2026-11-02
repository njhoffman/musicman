const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const {
  downloadTrackId,
  downloadedFiles,
  pendingTracks,
  readManifest,
  spotdlCommand
} = require('./download.js');
const { main } = require('../../scripts/spotdl-download.js');

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
    config = { sync: { downloadDirectory: directory, spotdlCommand: 'spotdl --threads 2' } };
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

  it('should read the manifest, or null when there is none', () => {
    expect(readManifest(config)).to.be.null;
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    expect(readManifest(config).tracks).to.have.length(3);
  });

  describe('download script', () => {
    let log;
    let error;

    beforeEach(() => {
      log = sinon.stub(console, 'log');
      error = sinon.stub(console, 'error');
    });

    afterEach(() => {
      log.restore();
      error.restore();
    });

    it('should download the pending tracks with spotDL and report what is left', () => {
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
      expect(main({ args: [], config, spawn })).to.equal(0);
      expect(runs).to.deep.equal([['spotdl', [`https://open.spotify.com/track/${idB}`]]]);
    });

    it('should download only the first N pending tracks with --limit', () => {
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
      expect(main({ args: ['--limit', '2'], config, spawn })).to.equal(0);
      expect(runs).to.deep.equal([_.map(three.tracks.slice(0, 2), 'url')]);
      expect(main({ args: ['--limit=5'], config, spawn })).to.equal(0);
      expect(runs[1]).to.deep.equal([three.tracks[2].url]);
      expect(main({ args: ['--limit', 'x'], config, spawn })).to.equal(1);
      expect(runs).to.have.length(2);
    });

    it('should not run spotDL in a dry run or without a manifest', () => {
      const spawn = sinon.spy();
      expect(main({ args: [], config, spawn })).to.equal(1);
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
      expect(main({ args: ['--dry-run'], config, spawn })).to.equal(0);
      expect(spawn).to.not.have.been.called;
    });
  });
});
