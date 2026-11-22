const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { shownAlbum } = require('./album.js');

describe('Shown album', () => {
  let dir;
  let config;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-album-'));
    fs.writeFileSync(
      path.join(dir, 'beets.yaml'),
      "paths:\n  'singleton:true': Singles/$artist - $title\n  default: $albumartist/$album/$title\n"
    );
    config = {
      mpd: { baseDirectory: '/music' },
      sync: { beetsConfig: path.join(dir, 'beets.yaml') }
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const meta = { album: 'Handpicked Indie-Rock', sp_album: 'The Real Album' };

  it('should show the Spotify album of a single played from MPD', () => {
    const shown = { source: 'mpd', meta, album: 'Handpicked Indie-Rock' };
    expect(shownAlbum(config, { ...shown, file: 'Singles/A - b.mp3' })).to.equal('The Real Album');
    expect(shownAlbum(config, { ...shown, file: '/music/Singles/A - b.mp3' })).to.equal(
      'The Real Album'
    );
  });

  it('should show the player album otherwise', () => {
    const shown = {
      source: 'mpd',
      meta,
      album: 'Handpicked Indie-Rock',
      file: 'Singles/A - b.mp3'
    };
    // a song in an album, Spotify playing, no match, no file, no beets config
    expect(shownAlbum(config, { ...shown, file: 'A/B/c.mp3' })).to.equal('Handpicked Indie-Rock');
    expect(shownAlbum(config, { ...shown, source: 'spotify', album: 'X' })).to.equal('X');
    expect(shownAlbum(config, { ...shown, meta: { album: 'H' } })).to.equal(
      'Handpicked Indie-Rock'
    );
    expect(shownAlbum(config, { ...shown, meta: null })).to.equal('Handpicked Indie-Rock');
    expect(shownAlbum(config, { ...shown, file: null })).to.equal('Handpicked Indie-Rock');
    expect(shownAlbum({ mpd: config.mpd }, shown)).to.equal('Handpicked Indie-Rock');
  });
});
