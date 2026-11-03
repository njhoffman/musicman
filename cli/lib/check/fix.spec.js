const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { applyFixes, cleanMulti, fixContext, fixRaw, planFixes, readTagRaw } = require('./fix.js');
const { run: checkCommand } = require('../commands/check.js');

// a fix context with every repair off, and the given ones on
const context = (overrides = {}) => ({
  nameTargets: new Map(),
  standardKeys: new Set(),
  spotifyId: false,
  multi: new Set(),
  caseTargets: new Map(),
  ...overrides
});
const txxx = pairs => _.map(pairs, ([description, value]) => ({ description, value }));
const texts = changes => _.map(changes, 'text');

describe('check --fix', () => {
  describe('fixRaw', () => {
    it('should remove the leftover Spotify id only when sp_track_id holds the id', () => {
      const on = context({ spotifyId: true });
      const linked = fixRaw(
        {
          TXXX: txxx([
            ['spotify_track_id', 'a'],
            ['sp_track_id', 'b']
          ])
        },
        on
      );
      expect(linked.raw.TXXX).to.deep.equal(txxx([['sp_track_id', 'b']]));
      expect(texts(linked.changes)).to.deep.equal(['remove spotify_track_id']);
      expect(fixRaw({ TXXX: txxx([['spotify_track_id', 'a']]) }, on).changes).to.be.empty;
    });

    it('should rename spellings to the target, drop equal copies, and leave differing ones', () => {
      const names = context({
        nameTargets: new Map([
          ['comment', 'Comment'],
          ['albumartist', 'AlbumArtist'],
          ['releasetype', 'ReleaseType']
        ])
      });
      const { raw, changes, skipped } = fixRaw(
        {
          TXXX: txxx([
            ['COMMENT', 'nice'],
            ['comment', 'nice'],
            ['AlbumArtist', 'Band'],
            ['ALBUM ARTIST', ' Band '],
            ['ReleaseType', '2'],
            ['Release type', 'Advance']
          ])
        },
        names
      );
      // two spellings never both become the target
      expect(raw.TXXX).to.deep.equal(
        txxx([
          ['Comment', 'nice'],
          ['AlbumArtist', 'Band'],
          ['ReleaseType', '2'],
          ['Release type', 'Advance']
        ])
      );
      expect(texts(changes)).to.deep.equal([
        'rename COMMENT to Comment',
        'remove comment (same as Comment)',
        'remove ALBUM ARTIST (same as AlbumArtist)'
      ]);
      expect(skipped).to.deep.equal([
        { check: 'names', text: "Release type 'Advance' differs from ReleaseType '2'" }
      ]);
    });

    it('should fold custom fields into the standard frame they duplicate', () => {
      const standard = context({
        standardKeys: new Set(['albumartist', 'comment', 'grouping', 'year', 'label'])
      });
      const { raw, changes, skipped } = fixRaw(
        {
          TPE2: 'Band',
          TPUB: 'Label A',
          TXXX: txxx([
            ['AlbumArtist', 'Band'],
            ['Comment', 'liner notes'],
            ['GROUPING', 'IndieRock.Artists'],
            ['YEAR', '1997-05-28'],
            ['LABEL', 'Label B']
          ])
        },
        standard
      );
      expect(raw.COMM).to.deep.equal({ language: 'eng', shortText: '', text: 'liner notes' });
      expect(raw.TIT1).to.equal(undefined);
      expect(raw.TPUB).to.equal('Label A');
      expect(raw.TXXX).to.deep.equal(
        txxx([
          ['GROUPING', 'IndieRock.Artists'],
          ['YEAR', '1997-05-28'],
          ['LABEL', 'Label B']
        ])
      );
      expect(texts(changes)).to.deep.equal([
        'remove AlbumArtist (same as TPE2)',
        'move Comment to COMM: liner notes'
      ]);
      // grouping decides Spotify playlists, a date is no TYER year, a different label is kept
      expect(texts(skipped)).to.deep.equal([
        "GROUPING 'IndieRock.Artists' is not kept in TIT1",
        "YEAR '1997-05-28' is not kept in TYER",
        "LABEL 'Label B' differs from TPUB 'Label A'"
      ]);
    });

    it('should compare against every COMM frame', () => {
      const { changes } = fixRaw(
        {
          COMM: [
            { language: 'eng', shortText: 'iTunNORM', text: '0001' },
            { language: 'eng', shortText: '', text: 'notes' }
          ],
          TXXX: txxx([['Comment', 'notes']])
        },
        context({ standardKeys: new Set(['comment']) })
      );
      expect(texts(changes)).to.deep.equal(['remove Comment (same as COMM)']);
    });

    it('should write multi value fields cleanly and in the most used casing', () => {
      const { raw, changes } = fixRaw(
        {
          TXXX: txxx([
            ['Context', ' Lounge,Study,,study '],
            ['Mood', 'mellow,Dark']
          ])
        },
        context({
          multi: new Set(['Context', 'Mood']),
          caseTargets: new Map([['Mood', new Map([['mellow', 'Mellow']])]])
        })
      );
      expect(raw.TXXX).to.deep.equal(
        txxx([
          ['Context', 'Lounge,Study'],
          ['Mood', 'Mellow,Dark']
        ])
      );
      expect(texts(changes)).to.deep.equal([
        "Context ' Lounge,Study,,study ' to 'Lounge,Study'",
        "Mood 'mellow,Dark' to 'Mellow,Dark'"
      ]);
      expect(cleanMulti('a, b,,A')).to.equal('a,b');
    });

    it('should remove a multi value field with no items, keeping the other fields', () => {
      const { raw, changes } = fixRaw(
        {
          TXXX: txxx([
            ['Mood', ''],
            ['Context', ','],
            ['Picks', 'Nick']
          ])
        },
        context({ multi: new Set(['Context', 'Mood', 'Picks']) })
      );
      expect(raw.TXXX).to.deep.equal(txxx([['Picks', 'Nick']]));
      expect(texts(changes)).to.deep.equal([
        "remove Mood '' (no items)",
        "remove Context ',' (no items)"
      ]);
      const only = fixRaw({ TXXX: txxx([['Mood', '']]) }, context({ multi: new Set(['Mood']) }));
      expect(only.raw).to.not.have.property('TXXX');
    });

    it('should show long or multi line values on one line, cut short', () => {
      const lyrics = `first line\n${'word '.repeat(40)}`;
      const { skipped } = fixRaw(
        {
          COMM: { language: 'eng', shortText: '', text: 'a comment' },
          TXXX: txxx([['Comment', lyrics]])
        },
        context({ standardKeys: new Set(['comment']) })
      );
      const [text] = texts(skipped);
      expect(text).to.not.include('\n');
      expect(text).to.match(
        /^Comment 'first line word word .*\.\.\.' differs from COMM 'a comment'$/
      );
      expect(text.length).to.be.below(130);
    });

    it('should change nothing when no repair applies, and not change its input', () => {
      const raw = { TIT2: 'Song', TXXX: txxx([['Context', 'Study']]) };
      const result = fixRaw(raw, context({ multi: new Set(['Context']) }));
      expect(result.changes).to.be.empty;
      expect(result.raw).to.deep.equal(raw);
      const removed = fixRaw(
        {
          TXXX: txxx([
            ['spotify_track_id', 'a'],
            ['sp_track_id', 'a']
          ])
        },
        context({ spotifyId: true })
      );
      expect(removed.raw.TXXX).to.have.length(1);
    });
  });

  describe('fixContext', () => {
    const results = [
      {
        name: 'names',
        findings: [
          { frames: ['TXXX.REPLAYGAIN_TRACK_GAIN', 'TXXX.replaygain_track_gain'] },
          { frames: ['TXXX.REPLAYGAIN_ALBUM_GAIN', 'TXXX.replaygain_album_gain'] },
          { frames: ['TXXX.Comment', 'TXXX.COMMENT'] }
        ]
      },
      { name: 'standard', findings: [{ frame: 'TXXX.LABEL', standard: 'TPUB' }] },
      { name: 'case', findings: [{ frame: 'TXXX.Mood', values: ['Mellow', 'mellow'] }] }
    ];

    it('should rename to a configured or check.names spelling first, else the most used', () => {
      const { nameTargets, standardKeys, caseTargets, spotifyId } = fixContext(results, {
        library: { tags: [{ name: 'gain', id: 'TXXX.replaygain_track_gain' }] },
        check: { names: ['replaygain_album_gain'] }
      });
      expect([...nameTargets]).to.deep.equal([
        ['replaygaintrackgain', 'replaygain_track_gain'],
        ['replaygainalbumgain', 'replaygain_album_gain'],
        ['comment', 'Comment']
      ]);
      expect([...standardKeys]).to.deep.equal(['label']);
      expect(caseTargets.get('Mood').get('mellow')).to.equal('Mellow');
      expect(spotifyId).to.equal(false);
    });
  });

  describe('command', () => {
    let library;
    let dbPath;
    let config;
    const file = name => path.join(library, name);
    const custom = name =>
      Object.fromEntries(
        (NodeId3.read(file(name)).raw.TXXX || []).map(t => [t.description, t.value])
      );
    // a value stored in the library database, read through a connection of its own
    const stored = (name, frame) => {
      const db = openDatabase(dbPath);
      try {
        return _.get(
          db
            .prepare(
              `SELECT t.value FROM song_tags t JOIN songs s ON s.id = t.song_id
               WHERE s.path = ? AND t.frame_id = ?`
            )
            .get(name, frame),
          'value'
        );
      } finally {
        db.close();
      }
    };

    beforeEach(async () => {
      library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-fix-'));
      fs.cpSync(path.join(process.cwd(), 'test/data/source/dir1'), library, { recursive: true });
      dbPath = path.join(library, 'musicman.sqlite');
      config = {
        mpd: { baseDirectory: library },
        db: { path: dbPath },
        rating: { tag: 'POPM', max: 5 },
        library: { tags: [{ id: 'TXXX.Context', name: 'context', multi: true }] },
        tags: []
      };
      NodeId3.update(
        {
          userDefinedText: txxx([
            ['spotify_track_id', 'old'],
            ['sp_track_id', 'new'],
            ['Context', 'Lounge,Study,']
          ])
        },
        file('testFile01.mp3')
      );
      const db = openDatabase(dbPath);
      syncTagDefinitions(db, config);
      await updateDatabase(db, { config, target: library });
      db.close();
    });

    afterEach(() => {
      fs.rmSync(library, { recursive: true, force: true });
    });

    const fix = (switches, confirm) =>
      checkCommand({
        target: library,
        options: { switches: { only: 'spotify-id,multi', fix: true, ...switches } },
        config,
        openDb: () => openDatabase(dbPath),
        confirm
      });

    it('should plan without writing in a dry run, when told no, and without a terminal', async () => {
      const before = fs.readFileSync(file('testFile01.mp3'));
      const asked = [];
      const dry = await fix({ dryRun: true }, async () => true);
      expect(dry.fixed).to.include({ dryRun: true });
      expect(
        dry.fixed.plan.files.map(({ file: name, changes }) => [name, texts(changes)])
      ).to.deep.equal([
        ['testFile01.mp3', ['remove spotify_track_id', "Context 'Lounge,Study,' to 'Lounge,Study'"]]
      ]);
      await fix({}, async message => {
        asked.push(message);
        return false;
      });
      expect(asked).to.deep.equal(['Write 2 changes to 1 file?']);
      const noTerminal = await fix({}, null);
      expect(noTerminal.fixed.written).to.be.empty;
      expect(fs.readFileSync(file('testFile01.mp3')).equals(before)).to.equal(true);
    });

    it('should write the repairs after confirm and update the database', async () => {
      const { fixed } = await fix({}, async () => true);
      expect(fixed.failed).to.be.empty;
      expect(fixed.written).to.deep.equal([file('testFile01.mp3')]);
      const after = custom('testFile01.mp3');
      expect(after).to.include({ sp_track_id: 'new', Context: 'Lounge,Study' });
      expect(after).to.not.have.property('spotify_track_id');
      expect(stored('testFile01.mp3', 'TXXX.spotify_track_id')).to.equal(undefined);
      expect(stored('testFile01.mp3', 'TXXX.sp_track_id')).to.equal('new');
    });
  });

  describe('applyFixes', () => {
    it('should report the files a write failed for and keep going', async () => {
      const plan = {
        context: context(),
        files: [
          { file: 'a.mp3', changes: [] },
          { file: 'b.mp3', changes: [] }
        ]
      };
      const { written, failed } = await applyFixes({
        config: { mpd: { baseDirectory: '/music' } },
        plan,
        write: file => (file.endsWith('a.mp3') ? new Error('read only') : true)
      });
      expect(written).to.deep.equal(['/music/b.mp3']);
      expect(failed).to.deep.equal([{ file: 'a.mp3', error: 'read only' }]);
    });
  });

  describe('artwork', () => {
    const image = Buffer.from('cover');
    const fakeFetch = calls => async url => {
      calls.push(url);
      return {
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => image
      };
    };

    it('should plan the Spotify cover for songs that have one and leave the others', async () => {
      const db = openDatabase(':memory:');
      const plan = await planFixes({
        db,
        config: { mpd: { baseDirectory: '/music' } },
        results: [
          {
            name: 'artwork',
            findings: [
              { file: 'a.mp3', detail: 'x', image: 'https://i/a' },
              { file: 'b.mp3', detail: 'x' }
            ]
          }
        ],
        songs: [],
        readRaw: () => ({})
      });
      expect(plan.files).to.deep.equal([
        { file: 'a.mp3', changes: [{ check: 'artwork', text: 'embed the Spotify album cover' }] }
      ]);
      expect(plan.covers).to.deep.equal({ 'a.mp3': 'https://i/a' });
      expect(plan.skipped).to.deep.equal([
        { check: 'artwork', file: 'b.mp3', text: 'no Spotify album image (not matched on Spotify)' }
      ]);
      db.close();
    });

    it('should embed each cover, downloading an album cover once', async () => {
      const calls = [];
      const tags = {};
      const { written } = await applyFixes({
        config: { mpd: { baseDirectory: '/music' } },
        plan: {
          context: context(),
          files: [{ file: 'a.mp3' }, { file: 'b.mp3' }, { file: 'c.mp3' }],
          covers: { 'a.mp3': 'https://i/1', 'b.mp3': 'https://i/1' }
        },
        fetchImpl: fakeFetch(calls),
        write: (file, change) => {
          tags[file] = change({ TIT2: 'x' });
          return true;
        }
      });
      expect(written).to.have.length(3);
      expect(calls).to.deep.equal(['https://i/1']);
      expect(tags['/music/a.mp3'].APIC).to.deep.include({ mime: 'image/jpeg', imageBuffer: image });
      expect(tags['/music/a.mp3'].APIC.type).to.deep.equal({ id: 3, name: 'front cover' });
      expect(tags['/music/c.mp3']).to.deep.equal({ TIT2: 'x' });
    });

    it('should fail the files whose cover cannot be downloaded', async () => {
      const { written, failed } = await applyFixes({
        config: { mpd: { baseDirectory: '/music' } },
        plan: {
          context: context(),
          files: [{ file: 'a.mp3' }],
          covers: { 'a.mp3': 'https://i/x' }
        },
        fetchImpl: async () => ({ ok: false, status: 404 }),
        write: () => true
      });
      expect(written).to.deep.equal([]);
      expect(failed).to.deep.equal([{ file: 'a.mp3', error: 'cover https://i/x: HTTP 404' }]);
    });
  });

  describe('planFixes', () => {
    it('should read only the checked songs holding a frame some repair is about', async () => {
      const db = openDatabase(':memory:');
      const add = (songPath, frames) => {
        const { lastInsertRowid: id } = db
          .prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)')
          .run(songPath);
        _.each(frames, frame =>
          db
            .prepare("INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, 'x')")
            .run(id, frame)
        );
        return { id, path: songPath };
      };
      const a = add('a.mp3', ['TXXX.spotify_track_id']);
      add('b.mp3', ['TXXX.spotify_track_id']);
      add('c.mp3', ['TIT2']);
      const read = [];
      const plan = await planFixes({
        db,
        config: { mpd: { baseDirectory: '/music' } },
        results: [{ name: 'spotify-id', findings: [{ file: 'a.mp3' }] }],
        songs: [a],
        readRaw: file => {
          read.push(file);
          return {
            TXXX: txxx([
              ['spotify_track_id', 'x'],
              ['sp_track_id', 'x']
            ])
          };
        }
      });
      expect(read).to.deep.equal(['/music/a.mp3']);
      expect(plan.files).to.deep.equal([
        { file: 'a.mp3', changes: [{ check: 'spotify-id', text: 'remove spotify_track_id' }] }
      ]);
      db.close();
    });
  });

  it('should read the frames of a file from its tag alone, the same as reading the whole file', () => {
    const file = path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3');
    const whole = _.omit(NodeId3.read(file).raw, ['APIC']);
    expect(_.omit(readTagRaw(file), ['APIC'])).to.deep.equal(whole);
    expect(_.keys(whole)).to.not.be.empty;
  });
});
