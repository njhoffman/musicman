const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { importDownloads, parseBeetsLog } = require('./import.js');

describe('Download Import', () => {
  const idA = 'AAAAAAAAAAAAAAAAAAAAAA';
  const idB = 'BBBBBBBBBBBBBBBBBBBBBB';
  let directory;
  let library;
  let config;
  let manifest;
  const download = (id, name) => path.join(directory, `${name} [${id}].mp3`);
  const custom = file =>
    Object.fromEntries((NodeId3.read(file).raw.TXXX || []).map(t => [t.description, t.value]));

  // fake beets: moves each imported file into the library and logs the second one as imported as is
  const fakeBeet = calls => async args => {
    calls.push(args);
    const files = args.slice(args.indexOf('-l') + 2);
    const log = args[args.indexOf('-l') + 1];
    fs.writeFileSync(log, `import started\nasis ${files[1] || ''}\n`);
    files.forEach(file => fs.renameSync(file, path.join(library, path.basename(file))));
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-import-'));
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-import-lib-'));
    const source = path.join(process.cwd(), 'test/data/source/dir1');
    const [first, second] = fs.readdirSync(source).filter(name => name.endsWith('.mp3'));
    fs.copyFileSync(path.join(source, first), download(idA, 'A - One'));
    fs.copyFileSync(path.join(source, second), download(idB, 'B - Two'));
    NodeId3.update({ TSRC: 'EXISTING' }, download(idA, 'A - One'));
    fs.writeFileSync(path.join(directory, 'notes.mp3'), '');
    config = {
      sync: { downloadDirectory: directory, beetsConfig: '/beets/config.yaml' },
      tags: [
        { id: 'TIT1', name: 'grouping' },
        { id: 'TXXX.Context', name: 'context', multi: true },
        { id: 'TSRC', name: 'isrc_code' }
      ],
      spotify: {
        fields: [
          { path: 'track.popularity', name: 'sp_popularity' },
          { path: 'track.external_ids.isrc', name: 'sp_isrc', fallback: 'isrc_code' }
        ],
        ignore: ['album', 'artists', 'name']
      }
    };
    manifest = {
      tracks: [
        {
          trackId: idA,
          artists: 'A',
          name: 'One',
          tags: { grouping: 'IndieRock.Artists', context: ['Study', 'Run'] }
        },
        { trackId: idB, artists: 'B', name: 'Two', tags: {} }
      ]
    };
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(library, { recursive: true, force: true });
  });

  const files = () =>
    fs
      .readdirSync(directory)
      .filter(name => name.endsWith('.mp3'))
      .sort()
      .map(name => path.join(directory, name));
  const client = objects => ({
    get: async url => {
      const [, type, ids] = url.match(/^\/(\w+)\?ids=(.*)$/);
      return { [type]: ids.split(',').map(id => objects[id] || null) };
    }
  });
  const tracks = {
    [idA]: { id: idA, popularity: 50, external_ids: { isrc: 'NEW' } },
    [idB]: { id: idB, popularity: 7, external_ids: { isrc: 'ISRCB' } }
  };

  it('should tag downloads with Spotify fields and playlist tags, then import them with beets', async () => {
    const calls = [];
    const events = [];
    const now = new Date('2026-10-21T10:00:00Z');
    const beetsLog = path.join(directory, 'beets-import.log');
    const [fileA, fileB] = [download(idA, 'A - One'), download(idB, 'B - Two')];
    const summary = await importDownloads({
      config,
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog,
      now,
      runBeet: async args => {
        // tags are written before beets runs
        expect(custom(fileA)).to.include({
          sp_track_id: idA,
          sp_popularity: '50',
          Context: 'Study,Run'
        });
        expect(NodeId3.read(fileA).raw.TIT1).to.equal('IndieRock.Artists');
        expect(NodeId3.read(fileA).raw.TSRC).to.equal('EXISTING');
        expect(NodeId3.read(fileB).raw.TSRC).to.equal('ISRCB');
        return fakeBeet(calls)(args);
      },
      onFile: status => events.push(status)
    });
    expect(calls[0].slice(0, 8)).to.deep.equal([
      '-c',
      '/beets/config.yaml',
      'import',
      '-s',
      '-q',
      '--quiet-fallback=asis',
      '-l',
      beetsLog
    ]);
    expect(calls[0].slice(8)).to.deep.equal([fileA, fileB]);
    expect(summary).to.include({ tagged: 2, imported: 2, detailsError: null });
    expect(summary.unknown).to.deep.equal([path.join(directory, 'notes.mp3')]);
    expect(summary.asis).to.deep.equal([fileB]);
    expect(_.map(manifest.tracks, 'importedAt')).to.deep.equal([
      now.toISOString(),
      now.toISOString()
    ]);
    expect(events).to.deep.equal(['unknown', 'tagged', 'tagged']);
  });

  it('should write ids and playlist tags without track details and skip imported tracks', async () => {
    manifest.tracks[1].importedAt = '2026-10-20T00:00:00.000Z';
    const limited = {
      get: async () => {
        throw new Error('rate limited');
      }
    };
    const calls = [];
    const summary = await importDownloads({
      config,
      client: limited,
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      runBeet: fakeBeet(calls)
    });
    expect(summary).to.include({ tagged: 1, detailsError: 'rate limited' });
    expect(calls[0].slice(8)).to.deep.equal([download(idA, 'A - One')]);
    const moved = path.join(library, path.basename(download(idA, 'A - One')));
    expect(custom(moved)).to.include({ sp_track_id: idA, Context: 'Study,Run' });
    expect(custom(moved)).to.not.have.property('sp_popularity');
  });

  it('should write the rating of a rating playlist like edit does', async () => {
    config.rating = { tag: 'POPM', email: 'Default', max: 5 };
    manifest.tracks[0].tags = { rating: '4.5' };
    manifest.tracks[1].importedAt = '2026-10-20T00:00:00.000Z';
    const summary = await importDownloads({
      config,
      client: { get: async () => ({}) },
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      runBeet: fakeBeet([])
    });
    const moved = path.join(library, path.basename(download(idA, 'A - One')));
    const popm = [].concat(NodeId3.read(moved).raw.POPM)[0];
    expect(popm).to.include({ email: 'Default', rating: 230 });
    expect(summary.files[0].playlist).to.deep.equal(['rating:4.5']);
  });

  it('should not write or run beets in a dry run', async () => {
    const before = fs.readFileSync(download(idA, 'A - One'));
    const runBeet = sinon.spy();
    const summary = await importDownloads({
      config,
      client: client(tracks),
      manifest,
      files: files(),
      beetsLog: path.join(directory, 'beets-import.log'),
      dryRun: true,
      runBeet
    });
    expect(summary).to.include({ tagged: 2, imported: 0, dryRun: true });
    expect(runBeet).to.not.have.been.called;
    expect(fs.readFileSync(download(idA, 'A - One')).equals(before)).to.be.true;
    expect(manifest.tracks[0]).to.not.have.property('importedAt');
  });

  it('should parse the files beets imported as is or skipped from its log', () => {
    expect(parseBeetsLog('import started\nasis /a.mp3\nskip /b.mp3; /c.mp3\n')).to.deep.equal({
      asis: [{ action: 'asis', file: '/a.mp3' }],
      skip: [{ action: 'skip', file: '/b.mp3' }]
    });
  });
});
