const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { openDatabase } = require('../db/database.js');
const { syncTagDefinitions } = require('../db/tags.js');
const { updateDatabase } = require('../db/update.js');
const { beginJournal, endJournal } = require('../history/journal.js');
const { applyUndo, findHistoryRun, listHistory, planUndo } = require('../history/undo.js');
const { rewriteTags } = require('../metadata/write.js');
const {
  applyDuplicates,
  duplicateGroups,
  mergedTags,
  planDuplicates,
  planGroup,
  releaseType,
  resolveGroup,
  trashPath
} = require('./duplicates.js');

describe('Duplicates repair', () => {
  describe('releaseType', () => {
    it('should read singles folders, release folders, and default to album', () => {
      expect(releaseType('Rated/E/Downbeat/Singles/A - Song.mp3')).to.equal('single');
      expect(releaseType('Unrated/_Singles/A - Song.mp3')).to.equal('single');
      expect(releaseType('Rated/R/Indie/Artists/A/ep/1992 - Drill/01 - Song.mp3')).to.equal('ep');
      expect(releaseType('Rated/Rap/Artists/Nas/compilation/2007 - Hits/17 - Song.mp3')).to.equal(
        'compilation'
      );
      expect(releaseType('Rated/R/P/Artists/Pink Floyd/live/1995 - Pulse/20 - Song.mp3')).to.equal(
        'live'
      );
      // an album named Live is still an album
      expect(releaseType('Rated/R/A/Artists/311/album/1998 - Live/01 - Down.mp3')).to.equal(
        'album'
      );
      expect(releaseType('Unrated/Men I Trust/2019 - Oncle Jazz/04 - Tailwhip.mp3')).to.equal(
        'album'
      );
    });
  });

  describe('planGroup', () => {
    const song = (songPath, mtime = 1) => ({ path: songPath, mtime });
    const album = 'Rated/R/I/Artists/A/album/2000 - Album/01 - Song.mp3';
    const ep = 'Rated/R/I/Artists/A/ep/1999 - EP/01 - Song.mp3';
    const single = 'Rated/R/I/Artists/A/single/1999 - Song/01 - Song.mp3';
    const singles = 'Rated/R/I/Singles/A - Song.mp3';
    const comp = 'Rated/R/I/Artists/A/compilation/2010 - Hits/05 - Song.mp3';
    const live = 'Rated/R/I/Artists/A/live/2005 - Live/03 - Song.mp3';

    it('should keep the album copy over EPs, singles, and compilations', () => {
      const plan = planGroup([song(comp), song(singles), song(album), song(ep), song(single)]);
      expect(plan.keep).to.equal(album);
      expect(plan.remove).to.have.members([comp, singles, ep, single]);
      expect(plan.reasons[singles]).to.equal('single copy, the album copy is kept');
      expect(plan.candidates).to.be.empty;
    });

    it('should keep an EP over a single and a single over a compilation', () => {
      expect(planGroup([song(single), song(ep)]).keep).to.equal(ep);
      expect(planGroup([song(comp), song(singles)]).keep).to.equal(singles);
    });

    it('should remove Unrated imports of a Rated song', () => {
      const plan = planGroup([song('Unrated/_Singles/A - Song.mp3'), song(singles)]);
      expect(plan).to.include({ keep: singles });
      expect(plan.remove).to.deep.equal(['Unrated/_Singles/A - Song.mp3']);
      expect(plan.reasons['Unrated/_Singles/A - Song.mp3']).to.equal(
        'Unrated import of a Rated song'
      );
    });

    it('should keep the file without a number of numbered copies, even when it is older', () => {
      const numbered = 'Rated/R/I/Singles/A - Song.1.mp3';
      const plan = planGroup([song(numbered, 9), song(singles, 1)]);
      expect(plan.keep).to.equal(singles);
      expect(plan.remove).to.deep.equal([numbered]);
    });

    it('should clear the match of a live copy instead of removing it', () => {
      const plan = planGroup([song(live), song(album)]);
      expect(plan).to.include({ keep: album });
      expect(plan.clear).to.deep.equal([live]);
      expect(plan.remove).to.be.empty;
    });

    it('should clear the match of a remix or a named version instead of removing it', () => {
      const remix = 'Rated/R/I/Artists/A/remix/2002 - Remixes/01 - Song (Arsenal mix).mp3';
      const edit = 'Rated/R/I/Artists/A/album/2000 - Album/13 - Song (radio edit).mp3';
      const albumVersion = 'Rated/R/I/Artists/A/single/1999 - Song/01 - Song (album version).mp3';
      const plan = planGroup([song(remix), song(edit), song(albumVersion), song(album)]);
      expect(plan).to.include({ keep: album });
      expect(plan.clear).to.deep.equal([remix, edit]);
      expect(plan.reasons[remix]).to.equal('remix matched to the original track');
      expect(plan.reasons[edit]).to.equal('(radio edit) version matched to the original track');
      // an album version is the same recording, so its single copy is removed
      expect(plan.remove).to.deep.equal([albumVersion]);
    });

    it('should leave copies that tie to a pick', () => {
      const other = 'Rated/E/Ambient/Singles/A - Song.mp3';
      const plan = planGroup([song(singles), song(other)]);
      expect(plan.keep).to.be.null;
      expect(plan.candidates).to.deep.equal([singles, other]);
      const resolved = resolveGroup({ ...plan, files: [] }, other);
      expect(resolved).to.include({ keep: other });
      expect(resolved.candidates).to.be.empty;
      expect(resolved.remove).to.deep.equal([singles]);
    });

    it('should treat two live copies as a tie, with nothing to clear', () => {
      const other = 'Rated/R/I/Artists/A/live/2008 - Unplugged/02 - Song.mp3';
      const plan = planGroup([song(live), song(other)]);
      expect(plan.clear).to.be.empty;
      expect(plan.candidates).to.have.members([live, other]);
    });

    it('should join groups that share a file, so no file is kept by one and removed by another', () => {
      const db = openDatabase(':memory:');
      [album, singles, comp].forEach(file =>
        db.prepare('INSERT INTO songs (path, mtime, size) VALUES (?, 1, 1)').run(file)
      );
      const groups = duplicateGroups(db, [{ files: [singles, comp] }, { files: [album, singles] }]);
      expect(groups.map(({ files }) => _.map(files, 'path'))).to.deep.equal([
        [album, comp, singles].sort()
      ]);
      expect(planDuplicates(groups)[0]).to.include({ keep: album });
      db.close();
    });

    it('should leave groups with nothing to do out of the plan', () => {
      expect(planDuplicates([{ files: [song(album)] }])).to.be.empty;
    });
  });

  describe('mergedTags', () => {
    const tags = (context, rating) => ({
      TXXX: [{ description: 'Context', value: context }],
      ...(rating ? { POPM: { email: 'x', rating, counter: 0 } } : {})
    });

    it('should merge multi values once in any case and take the newer rating', () => {
      const { raw, changes } = mergedTags({
        keepRaw: tags('Run,Study', 128),
        keepMtime: 1,
        others: [{ raw: tags('study,Lift', 255), mtime: 5 }],
        descriptions: ['Context']
      });
      expect(_.find(raw.TXXX, { description: 'Context' }).value).to.equal('Run,Study,Lift');
      expect(raw.POPM.rating).to.equal(255);
      expect(changes).to.deep.equal(['Context +Lift', 'rating of the newer copy']);
    });

    it('should keep the rating when the kept copy is newer or the newer copy has none', () => {
      expect(
        mergedTags({
          keepRaw: tags('Run', 128),
          keepMtime: 9,
          others: [{ raw: tags('Run', 255), mtime: 5 }],
          descriptions: ['Context']
        }).changes
      ).to.be.empty;
      expect(
        mergedTags({
          keepRaw: tags('Run', 128),
          keepMtime: 1,
          others: [{ raw: tags('Run'), mtime: 5 }],
          descriptions: ['Context']
        }).raw.POPM.rating
      ).to.equal(128);
    });
  });

  describe('applyDuplicates', () => {
    let db;
    let library;
    let config;
    let beetCalls;
    const singles = 'Rated/G/Singles';
    const kept = `${singles}/A - Song.mp3`;
    const copy = `${singles}/A - Song.1.mp3`;
    const abs = file => path.join(library, file);
    const custom = (file, description) =>
      _.get(_.find([].concat(NodeId3.read(abs(file)).raw.TXXX || []), { description }), 'value');
    const beet = async args => {
      beetCalls.push(args);
      return args[0] === 'ls' ? `${args[2].slice(5)}\n` : '';
    };
    const setTags = (file, change, mtime) => {
      rewriteTags(abs(file), raw => change(raw));
      fs.utimesSync(abs(file), mtime, mtime);
    };

    beforeEach(async () => {
      library = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-dups-'));
      const source = path.join(process.cwd(), 'test/data/source/dir1');
      fs.mkdirSync(path.join(library, singles), { recursive: true });
      fs.copyFileSync(path.join(source, 'testFile01.mp3'), abs(kept));
      fs.copyFileSync(path.join(source, 'testFile01.mp3'), abs(copy));
      config = {
        mpd: { baseDirectory: library },
        db: { backupDirectory: path.join(library, '.musicman') },
        rating: { tag: 'POPM', max: 5 },
        library: {
          tags: [
            { id: 'TIT2', name: 'title' },
            { id: 'TXXX.Context', name: 'context', multi: true }
          ]
        },
        tags: []
      };
      const txxx = (raw, values) => ({
        ...raw,
        TXXX: [
          ..._.reject([].concat(raw.TXXX || []), ({ description }) => _.has(values, description)),
          ..._.map(values, (value, description) => ({ description, value }))
        ]
      });
      setTags(
        kept,
        raw => ({
          ...txxx(raw, { Context: 'Run', sp_track_id: 'track1' }),
          POPM: { email: 'x', rating: 128, counter: 0 }
        }),
        1000
      );
      setTags(
        copy,
        raw => ({
          ...txxx(raw, { Context: 'Study', sp_track_id: 'track1' }),
          POPM: { email: 'x', rating: 255, counter: 0 }
        }),
        2000
      );
      db = openDatabase(':memory:');
      syncTagDefinitions(db, config);
      await updateDatabase(db, { config, target: library });
      beetCalls = [];
    });

    afterEach(() => {
      endJournal();
      db.close();
      fs.rmSync(library, { recursive: true, force: true });
    });

    const plan = () => planDuplicates(duplicateGroups(db, [{ files: [kept, copy] }]));

    it('should merge into the kept copy, take it out of beets, and move the other to the trash', async () => {
      const groups = plan();
      expect(groups.map(({ keep, remove }) => [keep, remove])).to.deep.equal([[kept, [copy]]]);
      const result = await applyDuplicates({ db, config, groups, runId: 'r1', beet });
      expect(result.failed).to.be.empty;
      expect(result.merged).to.deep.equal([
        { file: kept, changes: ['Context +Study', 'rating of the newer copy'] }
      ]);
      expect(custom(kept, 'Context')).to.equal('Run,Study');
      expect(NodeId3.read(abs(kept)).raw.POPM.rating).to.equal(255);
      const to = trashPath(config, 'r1', copy);
      expect(fs.existsSync(abs(copy))).to.be.false;
      expect(fs.existsSync(to)).to.be.true;
      expect(beetCalls).to.deep.equal([
        ['ls', '-p', `path:${abs(copy)}`],
        ['remove', '-f', `path:${abs(copy)}`]
      ]);
      expect(
        db
          .prepare('SELECT path FROM songs')
          .all()
          .map(row => row.path)
      ).to.deep.equal([kept]);
    });

    it('should not remove a copy when the merge into the kept copy fails', async () => {
      const result = await applyDuplicates({
        db,
        config,
        groups: plan(),
        runId: 'r1',
        beet,
        write: () => new Error('read-only')
      });
      expect(result.failed).to.deep.equal([{ file: kept, error: 'read-only' }]);
      expect(fs.existsSync(abs(copy))).to.be.true;
      expect(beetCalls).to.be.empty;
    });

    it('should clear the match of a live copy and reject its track for it', async () => {
      const live = 'Rated/G/Artists/A/live/2005 - Live/01 - Song.mp3';
      fs.mkdirSync(path.dirname(abs(live)), { recursive: true });
      fs.renameSync(abs(copy), abs(live));
      await updateDatabase(db, { config, target: library });
      const groups = planDuplicates(duplicateGroups(db, [{ files: [kept, live] }]));
      expect(groups[0].clear).to.deep.equal([live]);
      const result = await applyDuplicates({ db, config, groups, runId: 'r1', beet });
      expect(result.cleared).to.deep.equal([live]);
      expect(custom(live, 'sp_track_id')).to.be.undefined;
      const songId = db.prepare('SELECT id FROM songs WHERE path = ?').get(live).id;
      expect(
        JSON.parse(
          db.prepare('SELECT rejected FROM spotify_matches WHERE song_id = ?').get(songId).rejected
        )
      ).to.deep.equal(['track1']);
      expect(fs.existsSync(abs(live))).to.be.true;
    });

    it('should be undone: the copy moved back and imported into beets as is', async () => {
      beginJournal({
        run: { id: 'r1', command: 'check', args: ['check'], startedAt: new Date() },
        config,
        db
      });
      await applyDuplicates({ db, config, groups: plan(), runId: 'r1', beet });
      endJournal();
      const run = findHistoryRun(listHistory(db), 'r1');
      expect(run).to.include({ moves: 1 });
      const undo = planUndo(db, run);
      expect(undo.moves.map(({ file, status }) => [file, status])).to.deep.equal([
        [abs(copy), 'restore']
      ]);
      beetCalls = [];
      beginJournal({
        run: { id: 'r2', command: 'undo', args: ['undo'], startedAt: new Date(Date.now() + 1000) },
        config,
        db
      });
      const result = await applyUndo({ db, config, plan: undo, beet });
      endJournal();
      expect(result.moves.failed).to.be.empty;
      expect(fs.existsSync(abs(copy))).to.be.true;
      expect(beetCalls).to.deep.equal([
        ['-p', 'types', 'import', '-q', '-s', '-A', '-C', '-M', '-I', abs(copy)]
      ]);
      expect(custom(kept, 'Context')).to.equal('Run');
      expect(
        db
          .prepare('SELECT path FROM songs ORDER BY path')
          .all()
          .map(row => row.path)
      ).to.deep.equal([copy, kept]);
      // the undo is recorded too, undoing it moves the copy to the trash again
      const redo = planUndo(db, findHistoryRun(listHistory(db), 'r2'));
      expect(redo.moves.map(({ action, status }) => [action, status])).to.deep.equal([
        ['restore', 'restore']
      ]);
    });

    it('should leave a move alone when a file is back at its old path', async () => {
      beginJournal({
        run: { id: 'r1', command: 'check', args: ['check'], startedAt: new Date() },
        config,
        db
      });
      await applyDuplicates({ db, config, groups: plan(), runId: 'r1', beet });
      endJournal();
      fs.copyFileSync(abs(kept), abs(copy));
      const undo = planUndo(db, findHistoryRun(listHistory(db), 'r1'));
      expect(_.map(undo.moves, 'status')).to.deep.equal(['changed']);
    });
  });
});
