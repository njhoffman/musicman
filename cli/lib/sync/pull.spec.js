const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const {
  addToManifest,
  buildManifest,
  downloadStatus,
  filterTags,
  writeManifest
} = require('./pull.js');

describe('Sync Pull Manifest', () => {
  const ids = {
    rock: '5MUDXMSHkjbA2CIYXjj1Vz',
    study: '6hik9wlDckKrPZ9FTusxJH',
    lounge: '5ewgiAwSOXnUpiTZ0SKqpW'
  };
  const config = {
    library: {
      tags: [
        { id: 'TIT1', name: 'grouping' },
        { id: 'TXXX.Context', name: 'context', multi: true }
      ]
    },
    sync: {
      playlists: [
        { filter: 'grouping:IndieRock.Artists', playlist: ids.rock },
        { filter: 'context:Study', playlist: ids.study },
        { filter: 'context:Lounge', playlist: ids.lounge }
      ]
    }
  };
  const track = (trackId, name) => ({ track_id: trackId, name, artists: 'Artist', album: 'Album' });
  const target = (id, name, pull) => ({ id, name, pull });

  it('should derive tags from a playlist filter', () => {
    expect(filterTags('grouping:IndieRock.Artists', config)).to.deep.equal({
      grouping: 'IndieRock.Artists'
    });
    expect(filterTags('context:Study', config)).to.deep.equal({ context: ['Study'] });
  });

  it('should derive the rating of an exact rating filter, and no rating from a minimum', () => {
    expect(filterTags('rating:4.5-4.5', config)).to.deep.equal({ rating: '4.5' });
    expect(filterTags('rating:5-5', config)).to.deep.equal({ rating: '5.0' });
    expect(filterTags('rating:4', config)).to.deep.equal({});
    expect(filterTags('~rating:4-4', config)).to.deep.equal({});
  });

  it('should list each track once with its targets and merged tags', () => {
    const manifest = buildManifest(
      [
        target('liked', 'Liked Songs', [track('t1', 'One')]),
        target(ids.rock, 'Indie Rock', [track('t1', 'One'), track('t2', 'Two')]),
        target(ids.study, 'Study', [track('t1', 'One')]),
        target(ids.lounge, 'Lounge', [track('t1', 'One')])
      ],
      config,
      new Date('2026-10-20T00:00:00Z')
    );
    expect(manifest.createdAt).to.equal('2026-10-20T00:00:00.000Z');
    expect(manifest.tracks).to.deep.equal([
      {
        trackId: 't1',
        url: 'https://open.spotify.com/track/t1',
        name: 'One',
        artists: 'Artist',
        album: 'Album',
        targets: ['Liked Songs', 'Indie Rock', 'Study', 'Lounge'],
        tags: { grouping: 'IndieRock.Artists', context: ['Study', 'Lounge'] }
      },
      {
        trackId: 't2',
        url: 'https://open.spotify.com/track/t2',
        name: 'Two',
        artists: 'Artist',
        album: 'Album',
        targets: ['Indie Rock'],
        tags: { grouping: 'IndieRock.Artists' }
      }
    ]);
  });

  it('should write the manifest to the download directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-pull-'));
    try {
      const file = writeManifest(
        { sync: { downloadDirectory: path.join(directory, 'download') } },
        { tracks: [] }
      );
      expect(file).to.equal(path.join(directory, 'download', 'manifest.json'));
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).to.deep.equal({ tracks: [] });
      // written whole through a temporary file
      expect(fs.readdirSync(path.dirname(file))).to.deep.equal(['manifest.json']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('addToManifest and downloadStatus', () => {
    let directory;
    let downloads;
    const ids2 = {
      a: '0Q7a3AbWpEr162RRDyz5u6',
      b: '77exqyiyvw4D2BBmFNMUur',
      c: '4uLU6hMCjMI75M1A2tKUQC'
    };
    const plan = [
      target(ids.study, 'Study', [track(ids2.a, 'Song A'), track(ids2.b, 'Song B')]),
      target('liked', 'Liked Songs', [track(ids2.c, 'Song C')])
    ];
    const withDownloads = () => ({
      ...config,
      sync: { ...config.sync, downloadDirectory: downloads }
    });
    const read = () => JSON.parse(fs.readFileSync(path.join(downloads, 'manifest.json'), 'utf8'));

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-pull-'));
      downloads = path.join(directory, 'download');
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('should start a manifest with the picked tracks and their targets and tags', () => {
      const result = addToManifest(withDownloads(), plan, [ids2.a, 'x'.repeat(22)]);
      expect(result).to.deep.equal({ added: [ids2.a], unknown: ['x'.repeat(22)] });
      const [entry] = read().tracks;
      expect(entry).to.include({ trackId: ids2.a, name: 'Song A' });
      expect(entry.targets).to.deep.equal(['Study']);
      expect(entry.tags).to.deep.equal({ context: ['Study'] });
    });

    it('should keep the tracks already in the manifest, imported ones included', () => {
      const conf = withDownloads();
      writeManifest(conf, {
        createdAt: '2026-11-01T00:00:00.000Z',
        tracks: [{ trackId: ids2.b, artists: 'Artist', name: 'Song B', importedAt: '2026-11-01' }]
      });
      expect(addToManifest(conf, plan, [ids2.a, ids2.b, ids2.c]).added).to.deep.equal([
        ids2.a,
        ids2.c
      ]);
      const manifest = read();
      expect(manifest.createdAt).to.equal('2026-11-01T00:00:00.000Z');
      expect(manifest.tracks.map(t => t.trackId)).to.deep.equal([ids2.a, ids2.b, ids2.c]);
      expect(manifest.tracks[1]).to.include({ importedAt: '2026-11-01' });
      expect(addToManifest(conf, plan, [ids2.a]).added).to.deep.equal([]);
    });

    it('should tell queued, downloaded, and imported tracks apart', () => {
      const conf = withDownloads();
      writeManifest(conf, {
        tracks: [
          { trackId: ids2.a },
          { trackId: ids2.b },
          { trackId: ids2.c, importedAt: '2026-11-01' }
        ]
      });
      fs.writeFileSync(path.join(downloads, `Artist - Song B [${ids2.b}].mp3`), '');
      expect([...downloadStatus(conf)]).to.deep.equal([
        [ids2.a, 'queued'],
        [ids2.b, 'downloaded'],
        [ids2.c, 'imported']
      ]);
      expect(
        downloadStatus({ sync: { downloadDirectory: path.join(directory, 'none') } }).size
      ).to.equal(0);
    });
  });
});
