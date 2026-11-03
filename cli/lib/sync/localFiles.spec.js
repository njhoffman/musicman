const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const {
  applyExport,
  assignNames,
  confirmStaged,
  exportName,
  isLocalTrackOf,
  localTracks,
  mpegLayer,
  planExport,
  readExportState,
  spotifyReadable
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

    it('should count confirmed Liked Songs as added, and stage only the songs liked since', () => {
      const one = song('/m/one.mp3', 'missing', 'One');
      const two = song('/m/two.mp3', 'missing', 'Two');
      const exported = planExport([target('liked', 'Liked Songs', [one, two])], {
        baseDirectory: '/m',
        previous: { confirmed: { liked: ['one.mp3'] } }
      });
      expect(exported.targets[0]).to.deep.include({
        total: 2,
        added: ['A - One.mp3'],
        pending: ['A - Two.mp3'],
        confirmed: 1
      });
      expect(exported.staged).to.include({ id: 'liked' });
    });

    it('should stage nothing when every song is in its playlists', () => {
      const one = song('/m/one.mp3', 'missing', 'One');
      const exported = planExport([target('p1', 'Done', [one], ['/m/one.mp3'])], {
        baseDirectory: '/m'
      });
      expect(exported.staged).to.be.null;
    });
  });

  describe('confirmStaged', () => {
    const previous = {
      names: {
        'a/one.mp3': 'A - One.mp3',
        'a/two.mp3': 'A - Two.mp3',
        'a/three.mp3': 'A - Three.mp3'
      },
      stage: ['A - Two.mp3', 'A - One.mp3'],
      staged: 'liked',
      phone: { 'A - One.mp3': 1 }
    };

    it('should record the staged songs as added to Liked Songs and keep the rest of the state', () => {
      const { state, count } = confirmStaged({
        ...previous,
        confirmed: { liked: ['a/three.mp3'] }
      });
      expect(count).to.equal(2);
      expect(state.confirmed).to.deep.equal({ liked: ['a/one.mp3', 'a/three.mp3', 'a/two.mp3'] });
      expect(state).to.deep.include({ staged: 'liked', phone: { 'A - One.mp3': 1 } });
      expect(confirmStaged(state).state.confirmed.liked).to.have.length(3);
    });

    it('should refuse a staged playlist and an empty stage', () => {
      expect(() => confirmStaged({ ...previous, staged: 'p1' })).to.throw(
        /only Liked Songs is confirmed/
      );
      expect(() => confirmStaged({})).to.throw(/nothing is staged to confirm/);
    });
  });

  describe('mpegLayer', () => {
    let directory;
    // MPEG-1 frames at 128 kbps, 44.1 kHz, 417 bytes long: layer III header ff fb 90 00, layer II
    // ff fd 80 00 (bitrate index 9 and 8), after an ID3v2.3 tag of 20 bytes and, in one file, junk bytes
    // that look like a frame header
    const frames = (second, count = 3) =>
      Buffer.concat(
        Array.from({ length: count }, () =>
          Buffer.concat([
            Buffer.from([0xff, second, second === 0xfd ? 0x80 : 0x90, 0x00]),
            Buffer.alloc(413)
          ])
        )
      );
    const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 20]), Buffer.alloc(20)]);
    const write = (name, ...parts) => {
      const file = path.join(directory, name);
      fs.writeFileSync(file, Buffer.concat(parts));
      return file;
    };

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-layer-'));
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it('should read the layer of the first frame the next one follows, past the ID3 tag and junk', () => {
      expect(mpegLayer(write('mp3.mp3', id3, frames(0xfb)))).to.equal(3);
      expect(mpegLayer(write('mp2.mp3', id3, frames(0xfd)))).to.equal(2);
      expect(mpegLayer(write('junk.mp3', id3, Buffer.from([0xff, 0xfd, 0x90, 0x00, 0x12]), frames(0xfb)))).to.equal(3);
      expect(mpegLayer(write('none.mp3', id3, Buffer.alloc(100)))).to.be.null;
    });

    it('should call MP2 audio in a .mp3 file unreadable for Spotify, and leave other files alone', () => {
      expect(spotifyReadable(write('mp2.mp3', id3, frames(0xfd)))).to.be.false;
      expect(spotifyReadable(write('mp3.mp3', id3, frames(0xfb)))).to.be.true;
      expect(spotifyReadable(write('song.m4a', Buffer.alloc(10)))).to.be.true;
    });

    it('should leave unreadable songs out of the export, its playlists, and the stage', () => {
      const good = { file: '/m/good.mp3', match: 'missing', tags: tags('A', 'Good') };
      const bad = { file: '/m/bad.mp3', match: 'missing', tags: tags('A', 'Bad') };
      const exported = planExport(
        [{ id: 'p1', name: 'P', noId: [good, bad], localFiles: { added: [good], pending: [bad], stray: [] } }],
        { baseDirectory: '/m', readable: file => file !== '/m/bad.mp3' }
      );
      expect(exported.songs.map(song => song.path)).to.deep.equal(['good.mp3']);
      expect(exported.unreadable).to.deep.equal(['bad.mp3']);
      expect(exported.targets[0]).to.include({ total: 1 });
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
