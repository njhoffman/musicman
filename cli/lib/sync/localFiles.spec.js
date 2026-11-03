const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const {
  applyExport,
  assignNames,
  exportName,
  isLocalTrackOf,
  localTracks,
  planExport,
  readExportState
} = require('./localFiles.js');

describe('Local files export', () => {
  const tags = (artist, title, duration = 200) => ({ artist, title, album: 'Album', duration });
  const local = (artists, name, seconds = 200) => ({
    track_id: null,
    is_local: 1,
    artists,
    name,
    duration_ms: seconds * 1000
  });

  describe('isLocalTrackOf', () => {
    it('should match artist and title in any case and spacing, lengths within 2 seconds', () => {
      expect(isLocalTrackOf(tags('3.MF Doom', 'Licorice'), local('3.mf  doom', 'licorice', 201)))
        .to.be.true;
      expect(isLocalTrackOf(tags('Nas', 'Song', 216.7), local('Nas', 'Song', 216))).to.be.true;
      expect(isLocalTrackOf(tags('Nas', 'Song', 216), local('Nas', 'Song', 222))).to.be.false;
      expect(isLocalTrackOf(tags('Nas', 'Song'), local('Nas', 'Other'))).to.be.false;
    });
  });

  describe('localTracks', () => {
    it('should split the songs into added and pending, and list local tracks that are none of them', () => {
      const a = { file: '/m/a.mp3', tags: tags('A', 'One') };
      const b = { file: '/m/b.mp3', tags: tags('B', 'Two') };
      const remote = [
        local('A', 'One'),
        local('C', 'Renamed'),
        { track_id: 't1', is_local: 0, artists: 'B', name: 'Two' }
      ];
      const result = localTracks([a, b], remote);
      expect(result.added).to.deep.equal([a]);
      expect(result.pending).to.deep.equal([b]);
      expect(result.stray.map(track => track.name)).to.deep.equal(['Renamed']);
    });

    it('should count one local track for one song only', () => {
      const songs = [
        { file: '/m/a.mp3', tags: tags('A', 'One') },
        { file: '/m/a2.mp3', tags: tags('A', 'One') }
      ];
      const result = localTracks(songs, [local('A', 'One')]);
      expect(result.added.map(song => song.file)).to.deep.equal(['/m/a.mp3']);
      expect(result.pending.map(song => song.file)).to.deep.equal(['/m/a2.mp3']);
    });
  });

  describe('names', () => {
    it('should name a file after artist and title, without characters phones refuse', () => {
      expect(exportName({ file: '/m/x.MP3', tags: { artist: 'AC/DC', title: 'Why? "Now"' } })).to.equal(
        'AC_DC - Why_ _Now_.mp3'
      );
      expect(exportName({ file: '/m/01 - Song.mp3', tags: {} })).to.equal('01 - Song.mp3');
    });

    it('should keep the names given before and number new names that are taken in any case', () => {
      const song = (songPath, artist) => ({
        path: songPath,
        file: `/m/${songPath}`,
        tags: { artist, title: 'Song' }
      });
      const names = assignNames(
        [song('new.mp3', 'a'), song('old.mp3', 'A'), song('third.mp3', 'A')],
        { 'old.mp3': 'A - Song.mp3' }
      );
      expect(names).to.deep.equal({
        'old.mp3': 'A - Song.mp3',
        'new.mp3': 'a - Song (2).mp3',
        'third.mp3': 'A - Song (3).mp3'
      });
    });
  });

  describe('planExport', () => {
    const song = (file, match, title) => ({ file, match, tags: tags('A', title) });
    const target = (id, name, noId, added = []) => {
      const exportSongs = noId.filter(s => ['missing', 'rejected'].includes(s.match));
      return {
        id,
        name,
        noId,
        localFiles: {
          added: exportSongs.filter(s => added.includes(s.file)),
          pending: exportSongs.filter(s => !added.includes(s.file)),
          stray: []
        }
      };
    };

    it('should export each missing or rejected song once and stage the first playlist with pending songs', () => {
      const one = song('/m/one.mp3', 'missing', 'One');
      const two = song('/m/two.mp3', 'rejected', 'Two');
      const review = song('/m/review.mp3', 'review', 'Review');
      const plan = [
        target('liked', 'Liked Songs', [one]),
        target('p1', 'Done', [one], ['/m/one.mp3']),
        target('p2', 'Next', [one, two, review])
      ];
      const exported = planExport(plan, { baseDirectory: '/m' });
      expect(exported.songs.map(s => s.name)).to.have.members(['A - One.mp3', 'A - Two.mp3']);
      expect(exported.targets.map(t => t.name)).to.deep.equal(['Done', 'Next', 'Liked Songs']);
      expect(exported.staged).to.include({ id: 'p2', total: 2 });
      expect(exported.staged.pending).to.deep.equal(['A - One.mp3', 'A - Two.mp3']);
    });

    it('should stage nothing when every song is in its playlists', () => {
      const one = song('/m/one.mp3', 'missing', 'One');
      const exported = planExport([target('p1', 'Done', [one], ['/m/one.mp3'])], {
        baseDirectory: '/m'
      });
      expect(exported.staged).to.be.null;
    });
  });

  describe('applyExport', () => {
    let directory;
    let library;
    let upload;
    const write = (name, content) => {
      const file = path.join(library, name);
      fs.writeFileSync(file, content);
      return file;
    };
    const exportOf = (songs, staged = null) => ({
      songs,
      targets: staged ? [staged] : [],
      staged
    });
    const ino = file => fs.statSync(file).ino;

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-export-'));
      library = path.join(directory, 'library');
      upload = path.join(directory, 'upload');
      fs.mkdirSync(library);
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('should link the songs into files/, stage a playlist, and write the checklist and state', () => {
      const one = write('one.mp3', 'one');
      const two = write('two.mp3', 'two');
      const songs = [
        { file: one, path: 'one.mp3', name: 'A - One.mp3' },
        { file: two, path: 'two.mp3', name: 'A - Two.mp3' }
      ];
      const staged = {
        id: 'p1',
        name: 'Playlist',
        total: 2,
        added: ['A - One.mp3'],
        pending: ['A - Two.mp3'],
        stray: []
      };
      // 23:30 local time is the same local day, whatever the UTC date
      const now = new Date(2026, 10, 2, 23, 30);
      const counts = applyExport(exportOf(songs, staged), { uploadDirectory: upload, now });
      expect(counts).to.include({ linked: 2, relinked: 0, removed: 0, staged: 1 });
      expect(ino(path.join(upload, 'files', 'A - One.mp3'))).to.equal(ino(one));
      expect(fs.readdirSync(path.join(upload, 'stage'))).to.deep.equal(['A - Two.mp3']);
      expect(ino(path.join(upload, 'stage', 'A - Two.mp3'))).to.equal(ino(two));
      const readme = fs.readFileSync(path.join(upload, 'README.md'), 'utf8');
      expect(readme).to.include('on 2026-11-02.');
      expect(readme).to.include('## Playlist (1 of 2 added)');
      expect(readme).to.include('- [ ] A - Two.mp3');
      expect(readme).to.include('- [x] A - One.mp3');
      expect(readExportState(upload)).to.deep.equal({
        names: { 'one.mp3': 'A - One.mp3', 'two.mp3': 'A - Two.mp3' },
        stage: ['A - Two.mp3'],
        staged: 'p1'
      });
    });

    it('should link a replaced library file again, remove songs no longer exported, and empty stage/', () => {
      const one = write('one.mp3', 'one');
      const two = write('two.mp3', 'two');
      const first = [
        { file: one, path: 'one.mp3', name: 'A - One.mp3' },
        { file: two, path: 'two.mp3', name: 'A - Two.mp3' }
      ];
      const staged = { id: 'p1', name: 'P', total: 1, added: [], pending: ['A - One.mp3'], stray: [] };
      applyExport(exportOf(first, staged), { uploadDirectory: upload });
      fs.writeFileSync(path.join(upload, 'files', 'mine.txt'), 'not ours');
      // a write through a temporary file replaces the library file, the link keeps the old one
      fs.unlinkSync(one);
      write('one.mp3', 'one, new tags');
      // the phone mirror's state is kept when the export rewrites the state file
      const previous = { ...readExportState(upload), phone: { 'A - One.mp3': { size: 3, mtimeMs: 1 } } };
      const counts = applyExport(exportOf([first[0]]), { uploadDirectory: upload, previous });
      expect(readExportState(upload).phone).to.deep.equal(previous.phone);
      expect(counts).to.include({ linked: 0, relinked: 1, removed: 1, staged: 0 });
      expect(ino(path.join(upload, 'files', 'A - One.mp3'))).to.equal(ino(one));
      expect(fs.readdirSync(path.join(upload, 'files'))).to.have.members(['A - One.mp3', 'mine.txt']);
      expect(fs.readdirSync(path.join(upload, 'stage'))).to.be.empty;
      expect(fs.readFileSync(path.join(upload, 'README.md'), 'utf8')).to.include(
        'Every song is in its playlists'
      );
    });
  });
});
