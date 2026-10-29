const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { buildManifest, filterTags, writeManifest } = require('./pull.js');

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
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
