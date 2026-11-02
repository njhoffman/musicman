const _ = require('lodash');
const path = require('path');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const fs = require('fs');
const os = require('os');
const NodeId3 = require('node-id3');

const {
  groupingHintFrame,
  sortCandidates,
  sortSongs,
  sortedGroupings,
  unsortedFolder
} = require('./sort.js');

describe('Beets Sort', () => {
  let db;
  const config = { mpd: { baseDirectory: '/music' } };
  const beets = {
    paths: {
      'grouping:IndieRock.Artists': 'Rated/Rock/Indie-Rock/Artists/$albumartist/$title',
      'singleton:true': 'Unrated/_Singles/$artist - $title',
      default: 'Unrated/$albumartist/$album/$title'
    }
  };
  const addSong = (songPath, rating, grouping) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO songs (path, mtime, size, rating) VALUES (?, 1, 1, ?)')
      .run(songPath, rating);
    if (grouping) {
      db.prepare("INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, 'TIT1', ?)").run(
        lastInsertRowid,
        grouping
      );
    }
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    addSong('Unrated/A/a.mp3', 4.5, 'IndieRock.Artists');
    addSong('Unrated/_Singles/b.mp3', 3, 'IndieRock.Artists');
    addSong('Unrated/C/c.mp3', null, 'IndieRock.Artists');
    addSong('Unrated/D/d.mp3', 5, 'Unmapped.Artists');
    addSong('Unrated/E/e.mp3', 5, null);
    addSong('Rated/Rock/f.mp3', 5, 'IndieRock.Artists');
  });

  afterEach(() => {
    db.close();
  });

  it('should read the unsorted folder and sorted groupings from beets paths', () => {
    expect(unsortedFolder(beets)).to.equal('Unrated');
    expect([...sortedGroupings(beets)]).to.deep.equal(['IndieRock.Artists']);
  });

  it('should select rated songs in the unsorted folder with a sorted grouping', () => {
    const candidates = sortCandidates(db, {
      config,
      beets,
      beetsItems: new Set(['/music/Unrated/A/a.mp3'])
    });
    expect(candidates.map(({ path: songPath, action }) => [songPath, action])).to.deep.equal([
      ['Unrated/A/a.mp3', 'move'],
      ['Unrated/_Singles/b.mp3', 'import']
    ]);
  });

  it('should take the grouping hint of a rated song without a grouping, marked fromHint', () => {
    const hint = db.prepare('INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)');
    // e.mp3 (rated, no grouping) has a hint beets has a rule for; a.mp3's own grouping wins over its hint
    hint.run(5, groupingHintFrame, 'IndieRock.Artists');
    hint.run(1, groupingHintFrame, 'Unmapped.Artists');
    const { lastInsertRowid } = db
      .prepare("INSERT INTO songs (path, mtime, size) VALUES ('Unrated/_Singles/u.mp3', 1, 1)")
      .run();
    // an unrated song with a hint stays
    hint.run(lastInsertRowid, groupingHintFrame, 'IndieRock.Artists');
    const candidates = sortCandidates(db, { config, beets, beetsItems: new Set() });
    expect(
      candidates.map(({ path: songPath, grouping, fromHint }) => [songPath, grouping, fromHint])
    ).to.deep.equal([
      ['Unrated/A/a.mp3', 'IndieRock.Artists', false],
      ['Unrated/_Singles/b.mp3', 'IndieRock.Artists', false],
      ['Unrated/E/e.mp3', 'IndieRock.Artists', true]
    ]);
  });

  it('should write a hinted grouping to TIT1 and drop the hint before beets runs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-sort-'));
    try {
      const file = path.join(directory, 'e.mp3');
      fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
      NodeId3.update(
        {
          userDefinedText: [
            { description: 'playlist_grouping', value: 'IndieRock.Singles' },
            { description: 'Context', value: 'Study' }
          ]
        },
        file
      );
      const seen = [];
      const result = await sortSongs(
        [
          {
            file,
            path: 'Unrated/_Singles/e.mp3',
            grouping: 'IndieRock.Singles',
            fromHint: true,
            action: 'import'
          }
        ],
        {
          runBeet: async () => {
            const raw = NodeId3.read(file).raw;
            seen.push([raw.TIT1, _.map([].concat(raw.TXXX || []), 'description')]);
          }
        }
      );
      expect(result).to.include({ sorted: 1, failed: 0 });
      expect(seen).to.have.length(1);
      expect(seen[0][0]).to.equal('IndieRock.Singles');
      expect(seen[0][1]).to.include('Context');
      expect(seen[0][1]).to.not.include('playlist_grouping');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should not write a grouping for candidates with their own', async () => {
    const written = [];
    await sortSongs([{ file: '/music/a.mp3', grouping: 'X', fromHint: false, action: 'move' }], {
      runBeet: async () => {},
      writeGrouping: (...args) => written.push(args)
    });
    expect(written).to.be.empty;
  });

  it('should return no candidates without beets path rules', () => {
    expect(sortCandidates(db, { config, beets: { paths: {} }, beetsItems: new Set() })).to.be.empty;
  });

  it('should update and move songs beets has, and import the others as singletons', async () => {
    const calls = [];
    const candidates = sortCandidates(db, {
      config,
      beets,
      beetsItems: new Set(['/music/Unrated/A/a.mp3'])
    });
    const result = await sortSongs(candidates, {
      beetsConfig: '/beets/config.yaml',
      runBeet: async args => calls.push(args)
    });
    expect(result).to.include({ sorted: 2, failed: 0 });
    expect(calls).to.deep.equal([
      [
        '-c',
        '/beets/config.yaml',
        'update',
        '-m',
        `path:${path.join('/music', 'Unrated/A/a.mp3')}`
      ],
      [
        '-c',
        '/beets/config.yaml',
        'import',
        '-s',
        '-q',
        '-A',
        path.join('/music', 'Unrated/_Singles/b.mp3')
      ]
    ]);
  });

  it('should report beets failures per song and keep going', async () => {
    const candidates = sortCandidates(db, { config, beets, beetsItems: new Set() });
    const result = await sortSongs(candidates, {
      runBeet: async args => {
        if (args.includes(path.join('/music', 'Unrated/A/a.mp3'))) {
          throw new Error('beet import failed: database locked');
        }
      }
    });
    expect(result).to.include({ sorted: 1, failed: 1 });
    expect(result.results[0]).to.include({
      status: 'failed',
      error: 'beet import failed: database locked'
    });
  });
});
