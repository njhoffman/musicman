const _ = require('lodash');
const { expect } = require('chai');
const { stripAnsi } = require('../utils/logger.js');
const chalk = require('chalk').default;
const {
  durationDiff,
  formatMatchSummary,
  formatPlan,
  formatPushResults,
  formatSongResult,
  formatUnassigned
} = require('./sync.js');

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

  describe('formatMatchSummary', () => {
    const summary = {
      targets: 2642,
      tagged: 1833,
      cached: 809,
      cachedReview: 756,
      notInDatabase: 0,
      match: 0,
      refresh: 0,
      review: 0,
      missing: 0,
      failed: 0,
      skipped: 0,
      reused: 0,
      bySource: { beets: 0, isrc: 0, search: 0 },
      artistImages: { saved: [], failed: [] }
    };
    const lines = text => stripAnsi(text).split('\n');

    it('should right align the counts with notes after them', () => {
      const [title, ...rows] = lines(
        formatMatchSummary(summary, { dryRun: true, threshold: 95, autoAccept: 496, toReview: 260 })
      );
      expect(title).to.equal('Spotify ids (dry run, only the lookups were cached)');
      expect(rows[0]).to.equal('  songs for Liked Songs or playlists   2642');
      expect(rows[2]).to.equal(
        '    recently checked                    809   756 waiting for review, 53 not found'
      );
      expect(rows).to.include('  to auto-accept                        496   at 95% or more');
      expect(rows).to.include('  to review                             260   0 new; sync --review');
      expect(_.uniq(rows.map(row => row.indexOf('   ', 36)))).to.have.length(1);
    });

    it('should leave out auto-accept without a threshold and show a rate limit', () => {
      const rows = lines(formatMatchSummary({ ...summary, skipped: 12 }, { toReview: 756 }));
      expect(rows.join('\n')).to.not.include('auto-accept');
      expect(rows[rows.length - 1]).to.match(/^ {2}not looked up +12 {3}Spotify rate limit$/);
    });

    it('should highlight the counts waiting on a decision and dim zeros', () => {
      const originalLevel = chalk.level;
      chalk.level = 1;
      try {
        const rows = formatMatchSummary(summary, {
          threshold: 95,
          autoAccept: 496,
          toReview: 260
        }).split('\n');
        const row = label => rows.find(line => stripAnsi(line).includes(label));
        const bold = '\u001b[1m';
        expect(row('to auto-accept')).to.include(bold).and.include('496');
        expect(row('already tagged')).to.not.include(bold);
        expect(row('not found ')).to.not.equal(stripAnsi(row('not found ')));
      } finally {
        chalk.level = originalLevel;
      }
    });
  });

  describe('formatPushResults', () => {
    const results = [
      { id: 'liked', name: 'Liked Songs', added: 241, removed: 0 },
      { id: 'p1', name: '[Rock] Pop-Rock', added: 0, removed: 0 },
      { id: 'p2', name: 'Study', added: 232, removed: 3 }
    ];

    it('should list the targets that changed and a total', () => {
      expect(stripAnsi(formatPushResults(results)).split('\n')).to.deep.equal([
        'Target        Added   Removed',
        'Liked Songs     241         0',
        'Study           232         3',
        'Total           473         3'
      ]);
    });

    it('should bold the totals', () => {
      const originalLevel = chalk.level;
      chalk.level = 1;
      try {
        const total = formatPushResults(results).split('\n')[3];
        expect(total).to.include('\u001b[1m');
        expect(stripAnsi(total)).to.match(/^Total/);
      } finally {
        chalk.level = originalLevel;
      }
    });
  });
});
