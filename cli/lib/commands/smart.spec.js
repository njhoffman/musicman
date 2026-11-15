const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('./smart.js');
const { readPresets } = require('../smart/presets.js');

describe('Smart command', () => {
  const config = {
    mpd: { baseDirectory: '/music' },
    library: { tags: [{ name: 'context' }, { name: 'mood' }, { name: 'artist' }] }
  };
  const songs = [
    ['/music/Rated/a.mp3', { artist: 'Band', title: 'A', rating: 4.5, sp_track_id: 'ta' }],
    ['/music/Rated/b.mp3', { artist: 'Band', title: 'B', rating: 5 }],
    ['/music/c.mp3', { title: 'C\tTab' }]
  ];
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-smart-'));
    file = path.join(dir, 'smart.yml');
    fs.writeFileSync(file, 'study: context:Study rating:4.5\nnone: mood:Nothing\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // runs smart with a fake search (mood:Nothing matches no song) and a recording player and stdout
  const runSmart = async (terms, switches = {}) => {
    const written = [];
    const played = [];
    const result = await run({
      options: { terms, switches },
      config,
      file,
      find: async ({ terms: searched }) => (searched.includes('mood:Nothing') ? [] : songs),
      player: async args => {
        played.push(args.options);
        return { source: 'mpd', action: 'play' };
      },
      out: { write: text => written.push(text) }
    });
    return { result, out: written.join(''), played };
  };

  it('should list the presets with their song counts as tsv or json', async () => {
    const { out } = await runSmart([], { format: 'tsv' });
    expect(out).to.equal('study\tcontext:Study rating:4.5\t3\t1\nnone\tmood:Nothing\t0\t0\n');
    const json = await runSmart(['list'], { format: 'json' });
    expect(JSON.parse(json.out)[0]).to.deep.equal({
      name: 'study',
      terms: ['context:Study', 'rating:4.5'],
      text: 'context:Study rating:4.5',
      songs: 3,
      spotify: 1
    });
    const listed = await runSmart(['show'], { list: true });
    expect(listed.result).to.have.length(2);
  });

  it("should show a preset's songs, files under the music directory, up to --limit", async () => {
    const { out } = await runSmart(['show', 'study'], { format: 'tsv', limit: '3' });
    expect(out).to.equal('Band\tA\t4.5\tRated/a.mp3\nBand\tB\t5\tRated/b.mp3\n\tC Tab\t\tc.mp3\n');
    const { result } = await runSmart(['show', 'study'], { limit: '1' });
    expect(result).to.include({ name: 'study', songs: 3, spotify: 1 });
    expect(result.tracks).to.deep.equal([
      { artist: 'Band', title: 'A', rating: '4.5', file: 'Rated/a.mp3' }
    ]);
  });

  it('should save a new preset, replace one in place, and remove them', async () => {
    const saved = await runSmart(['save', 'mazzy', 'artist:Mazzy Star', 'mood:Sad']);
    expect(saved.result).to.deep.equal({
      name: 'mazzy',
      terms: ['artist:Mazzy Star', 'mood:Sad'],
      songs: 3,
      replaced: false
    });
    await runSmart(['save', 'study', 'context:Study']);
    expect(readPresets(file)).to.deep.equal([
      { name: 'study', terms: ['context:Study'] },
      { name: 'none', terms: ['mood:Nothing'] },
      { name: 'mazzy', terms: ['artist:Mazzy Star', 'mood:Sad'] }
    ]);
    await runSmart(['rm', 'none', 'study']);
    expect(readPresets(file)).to.deep.equal([
      { name: 'mazzy', terms: ['artist:Mazzy Star', 'mood:Sad'] }
    ]);
  });

  it('should refuse unknown fields, no terms, bad names, and unknown presets', async () => {
    const reject = async (terms, message, switches) =>
      runSmart(terms, switches).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.match(message)
      );
    await reject(['save', 'x', 'contxt:Study'], /^Filter unknown field 'contxt'/);
    await reject(['save', 'x'], /needs search terms/);
    await reject(['save', 'list', 'rating:5'], /is a smart action/);
    await reject(['rm', 'study', 'gone'], /No smart playlist 'gone'/);
    await reject(['rm'], /needs the names/);
    await reject(['show', 'gone'], /No smart playlist 'gone'/);
    await reject(['show', 'study'], /--limit takes a count/, { limit: 'x' });
    await reject(['study', 'extra'], /takes no more words/);
    await reject([], /smart prints default, tsv, json, not csv/, { format: 'csv' });
    expect(readPresets(file)).to.have.length(2);
  });

  it('should play a preset through player play, passing --shuffle and --main', async () => {
    const { played } = await runSmart(['study'], { shuffle: true, main: true, list: false });
    expect(played).to.deep.equal([
      { terms: ['play', 'context:Study', 'rating:4.5'], switches: { shuffle: true, main: true } }
    ]);
  });
});
