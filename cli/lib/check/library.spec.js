const { expect } = require('chai');
const _ = require('lodash');

const { openDatabase } = require('../db/database.js');
const library = require('./library.js');

describe('Library checks', () => {
  let db;
  let songs;
  const config = {
    library: {
      tags: [
        { name: 'context', id: 'TXXX.Context', multi: true },
        { name: 'mood', id: 'TXXX.Mood', multi: true }
      ]
    },
    rating: { tag: 'POPM', max: 5 }
  };

  // a song with frames as { frame_id: value or [values] }, and its row
  const addSong = (file, frames, { duration = 200, mbTrackId = null } = {}) => {
    const { lastInsertRowid: id } = db
      .prepare(
        'INSERT INTO songs (path, mtime, size, duration, mb_track_id) VALUES (?, 1, 1, ?, ?)'
      )
      .run(file, duration, mbTrackId);
    const insert = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
    Object.entries(frames).forEach(([frame, value]) =>
      [].concat(value).forEach(item => insert.run(id, frame, item))
    );
  };
  const popm = rating => JSON.stringify({ email: 'Default', rating, counter: 0 });
  // runs one check over every song
  const check = (fn, scope = null) => {
    songs = db.prepare('SELECT id, path, duration, mb_track_id FROM songs').all();
    return library.withScope(db, scope || songs, () => fn({ db, config, songs }));
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    addSong(
      'a.mp3',
      {
        TPE1: 'Mazzy Star',
        TIT2: 'Fade Into You',
        'TXXX.AlbumArtist': 'Mazzy Star',
        TPE2: 'Mazzy Star',
        'TXXX.Comment': 'x',
        'TXXX.sp_track_id': 't1',
        'TXXX.spotify_track_id': 't1',
        'TXXX.Context': ['Study', 'study'],
        POPM: popm(255)
      },
      { duration: 295 }
    );
    addSong(
      'b.mp3',
      {
        TPE1: 'Mazzy Star!',
        TIT2: 'fade into you',
        'TXXX.ALBUM ARTIST': 'Mazzy Star',
        'TXXX.sp_track_id': 't2',
        'TXXX.Context': 'Study',
        POPM: popm(145),
        TALB: 'Erased Tapes 20･･－0'
      },
      { duration: 296.5 }
    );
    addSong(
      'c.mp3',
      {
        TPE1: 'Mazzy Star',
        TIT2: 'Fade Into You',
        'TXXX.ALBUMARTIST': 'Mazzy Star',
        'TXXX.sp_track_id': 't1',
        POPM: popm(128)
      },
      { duration: 240, mbTrackId: 'm1' }
    );
    addSong('d.mp3', { TPE1: 'Other', TIT2: 'Song', POPM: '{bad' }, { mbTrackId: 'm1' });
  });

  afterEach(() => db.close());

  it('should group custom names that differ by case or punctuation, suggesting the most used', () => {
    const [group] = check(library.names);
    expect(group.frames).to.deep.equal([
      'TXXX.ALBUM ARTIST',
      'TXXX.ALBUMARTIST',
      'TXXX.AlbumArtist'
    ]);
    expect(group.detail).to.match(
      /^ALBUM ARTIST \(1\) \/ ALBUMARTIST \(1\) \/ AlbumArtist \(1\) {2}-> {2}/
    );
    expect(library.nameKey('TXXX.Album_Artist')).to.equal('albumartist');
  });

  it('should suggest the spelling check --fix renames to: configured or check.names first', () => {
    const target = configured => {
      config.check = { names: configured };
      try {
        return check(library.names)[0].detail.split('  ->  ')[1];
      } finally {
        delete config.check;
      }
    };
    expect(target([])).to.equal('ALBUM ARTIST');
    expect(target(['AlbumArtist'])).to.equal('AlbumArtist');
    expect(
      library.nameTarget(['GAIN', 'gain'], { library: { tags: [{ id: 'TXXX.gain' }] } })
    ).to.equal('gain');
    expect(library.nameTarget(['GAIN', 'gain'], {})).to.equal('GAIN');
  });

  it('should report custom fields duplicating standard frames, with songs having both', () => {
    const findings = check(library.standard);
    const byFrame = Object.fromEntries(findings.map(f => [f.frame, f]));
    expect(byFrame['TXXX.AlbumArtist'].detail).to.equal(
      'AlbumArtist duplicates TPE2: 1 song, 1 with TPE2 too'
    );
    expect(byFrame['TXXX.ALBUM ARTIST'].detail).to.include('0 with TPE2 too');
    expect(byFrame['TXXX.Comment'].standard).to.equal('COMM');
    expect(byFrame['TXXX.sp_track_id']).to.equal(undefined);
  });

  it('should list files with the leftover Spotify id frame, only those in scope', () => {
    expect(check(library.spotifyId)).to.deep.equal([
      { file: 'a.mp3', detail: 'TXXX.spotify_track_id' }
    ]);
    const onlyB = db.prepare("SELECT id FROM songs WHERE path = 'b.mp3'").all();
    expect(check(library.spotifyId, onlyB)).to.deep.equal([]);
  });

  it('should group multi values that differ only in case', () => {
    expect(check(library.caseVariants)).to.deep.equal([
      {
        file: null,
        detail: 'context: Study (2) / study (1)',
        field: 'context',
        frame: 'TXXX.Context',
        values: ['Study', 'study']
      }
    ]);
  });

  it('should measure edits between words, a swap of neighbors as one', () => {
    expect(library.editDistance('Ubpeat', 'Upbeat')).to.equal(1);
    expect(library.editDistance('Groovy', 'Gloomy')).to.equal(2);
    expect(library.editDistance('Study', 'study')).to.equal(0);
    expect(library.editDistance('', 'abc')).to.equal(3);
  });

  it('should report values few songs use, with a close common value when there is one', () => {
    const rareConfig = {
      ...config,
      stats: { multiFields: ['mood'] },
      check: { rareCount: 2 }
    };
    ['e', 'f', 'g'].forEach(name => addSong(`${name}.mp3`, { 'TXXX.Mood': 'Upbeat' }));
    addSong('h.mp3', { 'TXXX.Mood': ['Ubpeat', 'Gloomy'] });
    addSong('i.mp3', { 'TXXX.Mood': 'Gloomy', 'TXXX.Context': 'Lone' });
    songs = db.prepare('SELECT id, path, duration, mb_track_id FROM songs').all();
    const findings = library.withScope(db, songs, () =>
      library.rare({ db, config: rareConfig, songs })
    );
    expect(
      findings.map(({ field, value, files, suggestion }) => [field, value, files, suggestion])
    ).to.deep.equal([
      ['mood', 'Ubpeat', ['h.mp3'], 'Upbeat'],
      ['mood', 'Gloomy', ['h.mp3', 'i.mp3'], null]
    ]);
    expect(findings[0].detail).to.equal('mood:Ubpeat (1 song), maybe Upbeat (3): h.mp3');
    // counted over the whole library, listed only for the checked songs
    const narrowed = library.withScope(
      db,
      songs.filter(({ path }) => path === 'i.mp3'),
      () => library.rare({ db, config: rareConfig, songs })
    );
    expect(narrowed.map(({ value, files }) => [value, files])).to.deep.equal([
      ['Gloomy', ['i.mp3']]
    ]);
  });

  it('should report ratings off the half step scale and rating frames that cannot be read', () => {
    expect(check(library.rating)).to.deep.equal([
      { file: 'b.mp3', detail: 'rating 2.8 (POPM 145)' },
      { file: 'd.mp3', detail: 'POPM cannot be read: {bad' }
    ]);
  });

  it('should report text that looks garbled, but not accents or CJK text', () => {
    expect(check(library.encoding)).to.deep.equal([
      { file: 'b.mp3', detail: 'TALB: Erased Tapes 20･･－0' }
    ]);
    expect(library.looksGarbled('CafÃ©')).to.equal(true);
    expect(library.looksGarbled('â€™')).to.equal(true);
    expect(library.looksGarbled('Café')).to.equal(false);
    expect(library.looksGarbled('夜に駆ける！')).to.equal(false);
  });

  it('should find duplicates by Spotify id, MusicBrainz id, and artist, title and length', () => {
    const findings = check(library.duplicates);
    expect(findings.map(({ detail }) => detail.split(':')[0])).to.deep.equal([
      'Spotify track t1',
      'MusicBrainz track m1',
      'Same song Mazzy Star - Fade Into You'
    ]);
    expect(findings[0].files).to.deep.equal(['a.mp3', 'c.mp3']);
    // a and b match by name (punctuation and case aside) and are 1.5 seconds apart; c is 240s
    expect(findings[2].files).to.deep.equal(['a.mp3', 'b.mp3']);
  });

  it('should not list a group found by id again by name', () => {
    db.prepare("UPDATE songs SET duration = 295 WHERE path = 'c.mp3'").run();
    db.prepare("DELETE FROM songs WHERE path = 'b.mp3'").run();
    const findings = check(library.duplicates);
    expect(findings.map(({ detail }) => detail.split(':')[0])).to.deep.equal([
      'Spotify track t1',
      'MusicBrainz track m1'
    ]);
  });

  describe('actionableDuplicates', () => {
    const album = 'Rated/R/I/Artists/A/album/2000 - Album/01 - Song.mp3';
    const comp = 'Rated/R/I/Artists/A/compilation/2010 - Hits/05 - Song.mp3';
    const report = () => {
      const findings = check(library.duplicates);
      return library.actionableDuplicates({ db, config, findings });
    };
    const rate = (file, rating) =>
      db.prepare('UPDATE songs SET rating = ? WHERE path = ?').run(rating, file);

    beforeEach(() => {
      db.prepare('DELETE FROM songs').run();
      addSong(album, { 'TXXX.sp_track_id': 't1' });
      addSong(comp, { 'TXXX.sp_track_id': 't1' });
    });

    it('should not report an album copy beside its unrated compilation copy', () => {
      rate(album, 4);
      expect(check(library.duplicates)).to.have.length(1);
      expect(report()).to.deep.equal([]);
    });

    it('should report copies under Artists once more than one is rated', () => {
      rate(album, 4);
      rate(comp, 5);
      expect(_.map(report(), 'files')).to.deep.equal([[album, comp]]);
    });

    it('should report a Singles copy beside an album copy', () => {
      addSong('Rated/R/I/Singles/A - Song.mp3', { 'TXXX.sp_track_id': 't1' });
      expect(_.map(report(), 'files')).to.deep.equal([
        [album, comp, 'Rated/R/I/Singles/A - Song.mp3']
      ]);
    });
  });

  describe('duplicates by ISRC', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM songs').run();
    });

    it('should group copies on other releases that share only an ISRC', () => {
      // an album copy matched to the single release's track, and a singleton without a MusicBrainz id
      // 2.13 seconds longer: no track id or name rule meets them
      addSong(
        'Rated/Artists/Coldplay/album/2002 - A Rush/05 - Clocks.mp3',
        { TPE1: 'Coldplay', TIT2: 'Clocks', TSRC: 'GBAYE0200771', 'TXXX.sp_track_id': 't-single' },
        { duration: 307.57, mbTrackId: 'm-album' }
      );
      addSong(
        'Unrated/_Singles/Coldplay - Clocks.mp3',
        { TPE1: 'Coldplay', TIT2: 'Clocks', TSRC: 'GBAYE0200771', 'TXXX.sp_track_id': 't-album' },
        { duration: 309.7 }
      );
      const findings = check(library.duplicates);
      expect(findings.map(({ detail }) => detail.split(':')[0])).to.deep.equal([
        'ISRC GBAYE0200771'
      ]);
      expect(findings[0].files).to.deep.equal([
        'Rated/Artists/Coldplay/album/2002 - A Rush/05 - Clocks.mp3',
        'Unrated/_Singles/Coldplay - Clocks.mp3'
      ]);
    });

    it('should meet a file ISRC and a Spotify ISRC written in another case or with hyphens', () => {
      addSong('Singles/x.mp3', { TSRC: 'gb-aye-02-00771' });
      addSong('Singles/y.mp3', { 'TXXX.sp_isrc': 'GBAYE0200771' });
      addSong('Singles/z.mp3', { TSRC: 'GBAYE0200999' });
      const findings = check(library.duplicates);
      expect(_.map(findings, 'files')).to.deep.equal([['Singles/x.mp3', 'Singles/y.mp3']]);
      expect(findings[0].detail).to.match(/^ISRC GBAYE0200771:/);
    });

    it('should leave live, remix and named versions out of ISRC groups', () => {
      // beets writes the studio ISRC on live files, and versions can share one on Spotify
      addSong('Rated/R/I/Artists/A/album/2000 - Album/01 - Song.mp3', { TSRC: 'I1' });
      addSong('Rated/R/I/Artists/A/live/2001 - Live/01 - Song.mp3', { TSRC: 'I1' });
      addSong('Rated/R/I/Artists/A/album/2000 - Album/12 - Song (new vocal version).mp3', {
        'TXXX.sp_isrc': 'I1'
      });
      expect(check(library.duplicates)).to.deep.equal([]);
      addSong('Unrated/_Singles/A - Song.mp3', { TSRC: 'I1' });
      expect(_.map(check(library.duplicates), 'files')).to.deep.equal([
        ['Rated/R/I/Artists/A/album/2000 - Album/01 - Song.mp3', 'Unrated/_Singles/A - Song.mp3']
      ]);
    });

    it('should split off an ISRC copy more than 15 seconds from the others', () => {
      // an album and single copy 11 seconds apart, and an extended mix 52 seconds longer
      addSong('Singles/album.mp3', { TSRC: 'I1' }, { duration: 200 });
      addSong('Singles/single.mp3', { TSRC: 'I1' }, { duration: 211 });
      addSong('Singles/extended.mp3', { TSRC: 'I1' }, { duration: 263 });
      expect(_.map(check(library.duplicates), 'files')).to.deep.equal([
        ['Singles/album.mp3', 'Singles/single.mp3']
      ]);
    });

    it('should chain ISRC copies by their nearest lengths, and not group a pair far apart', () => {
      addSong('Singles/a.mp3', { TSRC: 'I1' }, { duration: 200 });
      addSong('Singles/b.mp3', { TSRC: 'I1' }, { duration: 214 });
      addSong('Singles/c.mp3', { TSRC: 'I1' }, { duration: 228 });
      addSong('Singles/x.mp3', { TSRC: 'I2' }, { duration: 200 });
      addSong('Singles/y.mp3', { TSRC: 'I2' }, { duration: 215.5 });
      expect(_.map(check(library.duplicates), 'files')).to.deep.equal([
        ['Singles/a.mp3', 'Singles/b.mp3', 'Singles/c.mp3']
      ]);
    });

    it('should not list copies outside the Singles folders by ISRC: they are there deliberately', () => {
      addSong('Rated/R/I/Artists/A/album/2000 - Album/01 - Song.mp3', { TSRC: 'I1' });
      addSong('Rated/R/I/Artists/A/compilation/2010 - Hits/05 - Song.mp3', { TSRC: 'I1' });
      addSong('Unrated/A/2000 - Album/01 - Song.mp3', { TSRC: 'I1' });
      expect(check(library.duplicates)).to.deep.equal([]);
    });

    it('should count a song with both frames once', () => {
      addSong('Singles/x.mp3', { TSRC: 'GBAYE0200771', 'TXXX.sp_isrc': 'GBAYE0200771' });
      expect(check(library.duplicates)).to.deep.equal([]);
    });

    it('should not list a group found by Spotify id again by ISRC or by name', () => {
      const frames = { TPE1: 'A', TIT2: 'B', TSRC: 'I1', 'TXXX.sp_track_id': 't1' };
      addSong('Singles/x.mp3', frames);
      addSong('Singles/y.mp3', frames);
      expect(check(library.duplicates).map(({ detail }) => detail.split(':')[0])).to.deep.equal([
        'Spotify track t1'
      ]);
    });

    it('should list an ISRC group wider than the Spotify group', () => {
      addSong('Singles/x.mp3', { TSRC: 'I1', 'TXXX.sp_track_id': 't1' });
      addSong('Singles/y.mp3', { TSRC: 'I1', 'TXXX.sp_track_id': 't1' });
      addSong('Singles/z.mp3', { TSRC: 'I1', 'TXXX.sp_track_id': 't2' });
      expect(_.map(check(library.duplicates), 'files')).to.deep.equal([
        ['Singles/x.mp3', 'Singles/y.mp3'],
        ['Singles/x.mp3', 'Singles/y.mp3', 'Singles/z.mp3']
      ]);
    });
  });

  describe('artwork', () => {
    it('should list songs without a cover, with the Spotify album image when there is one', () => {
      addSong('covered.mp3', { APIC: '1', 'TXXX.sp_album_image': 'https://i/1' });
      addSong('spotify.mp3', { 'TXXX.sp_album_image': 'https://i/2', 'TXXX.sp_album': 'Album' });
      addSong('none.mp3', { TIT2: 'x' });
      const scope = db
        .prepare(
          `SELECT id, path FROM songs WHERE path IN ('covered.mp3', 'spotify.mp3', 'none.mp3')`
        )
        .all();
      expect(check(library.artwork, scope)).to.deep.equal([
        {
          file: 'none.mp3',
          detail: 'no cover, and no Spotify album image (not matched on Spotify)'
        },
        {
          file: 'spotify.mp3',
          detail: 'no cover, Spotify has the "Album" cover',
          image: 'https://i/2'
        }
      ]);
    });

    it('should list singles on the default image or without a cover, read from their files', () => {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const NodeId3 = require('node-id3');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-artwork-'));
      try {
        const placeholder = Buffer.from('the default image');
        fs.writeFileSync(path.join(dir, 'default.jpg'), placeholder);
        fs.writeFileSync(
          path.join(dir, 'beets.yaml'),
          "paths:\n  'singleton:true': Singles/$artist - $title\n  default: $albumartist/$album/$track - $title\n"
        );
        fs.mkdirSync(path.join(dir, 'Singles'));
        fs.mkdirSync(path.join(dir, 'A', 'B'), { recursive: true });
        const song = (file, image) => {
          fs.writeFileSync(path.join(dir, file), Buffer.from('audio'));
          if (image) {
            NodeId3.write(
              { image: { mime: 'image/jpeg', type: { id: 3 }, imageBuffer: image } },
              path.join(dir, file)
            );
          }
        };
        const spotify = {
          APIC: '1',
          'TXXX.sp_album_image': 'https://i/s',
          'TXXX.sp_album': 'Real'
        };
        song('Singles/X - placeholder.mp3', placeholder);
        addSong('Singles/X - placeholder.mp3', spotify);
        song('Singles/X - own.mp3', Buffer.from('own artwork'));
        addSong('Singles/X - own.mp3', spotify);
        song('A/B/01 - album.mp3', placeholder);
        addSong('A/B/01 - album.mp3', spotify);
        addSong('Singles/X - unmatched.mp3', { TIT2: 'x' });
        addSong('A/B/02 - unmatched.mp3', { TIT2: 'x' });
        const own = {
          ...config,
          mpd: { baseDirectory: dir },
          sync: { beetsConfig: path.join(dir, 'beets.yaml') },
          library: { ...config.library, defaultCover: path.join(dir, 'default.jpg') }
        };
        const scope = db.prepare(`SELECT id, path FROM songs WHERE path LIKE '%.mp3'`).all();
        const findings = library.withScope(db, scope, () =>
          library.artwork({ db, config: own, songs: scope })
        );
        expect(findings.filter(({ file }) => /^(Singles|A)\//.test(file))).to.deep.equal([
          {
            file: 'A/B/02 - unmatched.mp3',
            detail: 'no cover, and no Spotify album image (not matched on Spotify)'
          },
          {
            file: 'Singles/X - placeholder.mp3',
            detail: 'the default image, Spotify has the "Real" cover',
            image: 'https://i/s'
          },
          {
            file: 'Singles/X - unmatched.mp3',
            detail: 'no cover, gets the default image (not matched on Spotify)',
            cover: 'default'
          }
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
