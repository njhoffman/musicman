const { expect } = require('chai');
const { openDatabase } = require('../db/database.js');
const valuesCommand = require('./values.js');

describe('Values Command', () => {
  const config = {
    db: { path: ':memory:' },
    menu: { tagFields: ['mood', 'picks'] },
    library: {
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TXXX.Mood', name: 'mood', multi: true },
        { id: 'TXXX.Picks', name: 'picks', multi: true },
        { id: 'TXXX.Context', name: 'context', multi: true }
      ]
    }
  };
  // a.mp3: two moods as rows; b.mp3: one comma-joined row with a repeat; c.mp3: no mood
  const songs = [
    [
      'a.mp3',
      [
        ['TXXX.Mood', 'Mellow'],
        ['TXXX.Mood', 'Dreamy'],
        ['TXXX.Picks', 'Nick']
      ]
    ],
    [
      'b.mp3',
      [
        ['TXXX.Mood', 'Mellow, Upbeat,Mellow'],
        ['TPE1', 'Nas']
      ]
    ],
    ['c.mp3', [['TXXX.Context', 'Study']]]
  ];
  let db;
  let output;
  const write = text => {
    output += text;
  };
  // the command closes what it opens: a handle that leaves the in-memory database to afterEach
  const open = () => ({ prepare: sql => db.prepare(sql), close: () => {} });
  const run = (terms, switches = {}) =>
    valuesCommand.func({ options: { terms, switches }, config, open, write });

  beforeEach(() => {
    output = '';
    process.exitCode = 0;
    db = openDatabase(':memory:');
    const insertSong = db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)');
    const insertTag = db.prepare(
      'INSERT INTO song_tags (song_id, frame_id, value) VALUES (?, ?, ?)'
    );
    songs.forEach(([file, tags]) => {
      const { lastInsertRowid: id } = insertSong.run(file);
      tags.forEach(([frameId, value]) => insertTag.run(id, frameId, value));
    });
  });

  afterEach(() => {
    process.exitCode = 0;
    db.close();
  });

  it('counts each value once per song, comma-joined ones as their parts, most used first', () => {
    const fields = valuesCommand.resolveFields(['mood'], config);
    expect(valuesCommand.fieldValues(db, fields)).to.deep.equal({
      mood: [
        { value: 'Mellow', count: 2 },
        { value: 'Dreamy', count: 1 },
        { value: 'Upbeat', count: 1 }
      ]
    });
  });

  it("lists menu.tagFields when no field is named, under each field's name", async () => {
    const { values } = await run([]);
    expect(values).to.have.all.keys('mood', 'picks');
    expect(values.picks).to.deep.equal([{ value: 'Nick', count: 1 }]);
    expect(output).to.include('mood\n');
    expect(output).to.match(/ {2}Mellow {2}.*2/);
  });

  it('matches field names case-insensitively and keeps their library spelling', async () => {
    const { values } = await run(['Context']);
    expect(values).to.deep.equal({ context: [{ value: 'Study', count: 1 }] });
  });

  it('writes json, and oneline as field:value keys for fzf', async () => {
    await run(['mood'], { format: 'json' });
    expect(JSON.parse(output).mood[0]).to.deep.equal({ value: 'Mellow', count: 2 });
    output = '';
    await run(['mood'], { format: 'oneline' });
    const keys = output
      .trim()
      .split('\n')
      .map(line => line.split('\t')[0]);
    expect(keys).to.deep.equal(['mood:Mellow', 'mood:Dreamy', 'mood:Upbeat']);
  });

  it('reports a field that is not a library tag, listing the multi value ones', async () => {
    const { values } = await run(['nope']);
    expect(values).to.equal(null);
    expect(process.exitCode).to.equal(1);
  });
});
