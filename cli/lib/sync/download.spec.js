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
    const [command, args] = spotdlCommand(config, ['url-1', 'url-2']);
    expect(command).to.equal('spotdl');
    expect(args).to.deep.equal([
      '--threads',
      '2',
      'download',
      'url-1',
      'url-2',
      '--output',
      path.join(directory, '{artists} - {title} [{track-id}].{output-ext}'),
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
      const spawn = (command, args) => {
        runs.push([command, args.filter(arg => arg.startsWith('https://'))]);
        // spotDL downloads the first track only
        fs.writeFileSync(path.join(directory, `B - Two [${idB}].mp3`), '');
        return { status: 0 };
      };
      fs.writeFileSync(path.join(directory, `A - One [${idA}].mp3`), '');
      expect(main({ args: [], config, spawn })).to.equal(0);
      expect(runs).to.deep.equal([['spotdl', [`https://open.spotify.com/track/${idB}`]]]);
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
