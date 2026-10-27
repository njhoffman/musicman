const { expect } = require('chai');
const { stripAnsi } = require('../utils/logger.js');
const chalk = require('chalk').default;
const { durationDiff, formatPlan, formatSongResult, formatUnassigned } = require('./sync.js');

describe('Sync Output', () => {
  const item = {
    file: '/music/a.mp3',
    song: { artist: 'Radiohead', title: 'Karma Police', duration: 264 }
  };
  const matched = {
    source: 'isrc',
    track: {
      name: 'Karma Police',
      artists: [{ name: 'Radiohead' }],
      album: { name: 'OK Computer' },
      duration_ms: 264000
    },
    writes: {
      custom: [
        { name: 'sp_track_id', value: 'id-1' },
        { name: 'sp_popularity', value: '82' }
      ],
      filled: [{ name: 'isrc_code', value: 'GBAYE9701368' }],
      kept: [{ name: 'title' }, { name: 'artist' }]
    }
  };

  it('should show the signed duration difference without a negative zero', () => {
    expect(durationDiff(item.song, 265200)).to.equal('+1.2s');
    expect(durationDiff(item.song, 262000)).to.equal('-2.0s');
    expect(durationDiff(item.song, 263980)).to.equal('0.0s');
    expect(durationDiff({}, 1000)).to.be.null;
  });

  it('should show one line with the matched track and counts of the fields written', () => {
    expect(stripAnsi(formatSongResult('match', item, matched))).to.equal(
      'MATCH   isrc   Radiohead - Karma Police -> Radiohead - Karma Police [OK Computer] (0.0s) +2 fields ~1 filled =2 kept'
    );
  });

  it('should leave out the counts of no filled or kept tags', () => {
    const writes = { ...matched.writes, filled: [], kept: [] };
    expect(stripAnsi(formatSongResult('refresh', item, { ...matched, writes }))).to.match(
      /\(0\.0s\) \+2 fields$/
    );
  });

  it('should mark the songs of a dry run', () => {
    expect(stripAnsi(formatSongResult('match', item, matched, { dryRun: true }))).to.match(
      /^MATCH {3}dry isrc {3}Radiohead - Karma Police/
    );
  });

  it('should list every field under the song when verbose', () => {
    const lines = stripAnsi(formatSongResult('match', item, matched, { verbose: true })).split(
      '\n'
    );
    expect(lines).to.deep.equal([
      'MATCH   isrc   Radiohead - Karma Police -> Radiohead - Karma Police [OK Computer] (0.0s)',
      '  fields  sp_track_id=id-1  sp_popularity=82',
      '  filled  isrc_code=GBAYE9701368',
      '  kept    title  artist'
    ]);
  });

  it('should show review candidates without fields', () => {
    const review = stripAnsi(
      formatSongResult('review', item, {
        source: 'search',
        candidate: {
          artists: 'Radiohead',
          name: 'Karma Police - Live',
          album: 'Live',
          durationMs: 300000
        }
      })
    );
    expect(review).to.equal(
      'REVIEW  search Radiohead - Karma Police -> Radiohead - Karma Police - Live [Live] (+36.0s)'
    );
  });

  it('should show errors on the song line, or below it when verbose', () => {
    const failed = { file: '/music/b.mp3' };
    expect(stripAnsi(formatSongResult('failed', failed, { error: '503' }))).to.equal(
      'FAILED         /music/b.mp3 503'
    );
    expect(
      stripAnsi(formatSongResult('failed', failed, { error: '503' }, { verbose: true }))
    ).to.equal('FAILED         /music/b.mp3\n  error   503');
  });

  it('should cut long values in the verbose field lines', () => {
    const output = stripAnsi(
      formatSongResult(
        'refresh',
        item,
        {
          candidate: { id: 'id-1' },
          writes: {
            custom: [{ name: 'sp_copyright', value: 'x'.repeat(60) }],
            filled: [],
            kept: []
          }
        },
        { verbose: true }
      )
    );
    expect(output).to.include(`sp_copyright=${'x'.repeat(39)}~`);
  });

  it('should list unassigned paths by how many songs had them', () => {
    expect(formatUnassigned({ 'track.a': 1, 'track.b': 3 })).to.equal(
      '  track.b (3 songs)\n  track.a (1 song)'
    );
  });

  describe('formatPlan', () => {
    const columns = [
      ['target', 'Target', target => target.name],
      ['add', 'Add', target => target.add],
      ['spotifyAdded', '+Spotify', target => target.spotifyAdded]
    ];
    const plan = [
      { name: 'Study', add: 44, spotifyAdded: 0 },
      { name: 'Liked Songs', add: 0, spotifyAdded: 3 }
    ];
    let originalLevel;

    beforeEach(() => {
      originalLevel = chalk.level;
      chalk.level = 1;
    });

    afterEach(() => {
      chalk.level = originalLevel;
    });

    it('should right align counts under their headers with a wide gutter', () => {
      const lines = stripAnsi(formatPlan(plan, columns)).split('\n');
      expect(lines[0].trimEnd()).to.equal('Target        Add   +Spotify');
      expect(lines[1].trimEnd()).to.equal('Study          44          0');
      expect(lines[2].trimEnd()).to.equal('Liked Songs     0          3');
    });

    it('should make the highlighted columns bold and dim zeros', () => {
      const [head, study, liked] = formatPlan(plan, columns, ['add']).split('\n');
      const bold = text => new RegExp(`\\u001b\\[1m[^ ]*${text}`);
      expect(head).to.match(bold('Add'));
      expect(head).to.not.match(bold('\\+Spotify'));
      expect(study).to.match(bold('44'));
      expect(liked).to.not.match(bold('3'));
      expect(liked).to.not.match(bold('0'));
      expect(study).to.not.equal(stripAnsi(study));
    });
  });
});
