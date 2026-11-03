const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { applyMirror, kdeConnect, mirrorToPhone, planMirror } = require('./phone.js');

describe('Phone mirror', () => {
  let directory;
  let source;
  let storage;
  const write = (name, content, mtime = new Date(2026, 0, 1)) => {
    const file = path.join(source, name);
    fs.writeFileSync(file, content);
    fs.utimesSync(file, mtime, mtime);
    return { file, name };
  };
  const stampOf = file => {
    const stat = fs.statSync(file);
    return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-phone-'));
    source = path.join(directory, 'files');
    storage = path.join(directory, 'phone', 'storage', 'emulated', '0');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(storage, { recursive: true });
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  describe('planMirror', () => {
    it('should copy new, changed, and missing songs, and remove only songs it copied before', () => {
      const same = write('same.mp3', 'same');
      const changed = write('changed.mp3', 'new tags');
      const missing = write('missing.mp3', 'missing');
      const fresh = write('new.mp3', 'new');
      const sent = {
        'same.mp3': stampOf(same.file),
        'changed.mp3': { size: 3, mtimeMs: 1 },
        'missing.mp3': stampOf(missing.file),
        'gone.mp3': { size: 1, mtimeMs: 1 }
      };
      const existing = new Set(['same.mp3', 'changed.mp3', 'gone.mp3', 'mine.mp3']);
      const plan = planMirror([same, changed, missing, fresh], { sent, existing });
      expect(plan.copy.map(song => song.name)).to.deep.equal([
        'changed.mp3',
        'missing.mp3',
        'new.mp3'
      ]);
      expect(plan.remove).to.deep.equal(['gone.mp3']);
    });
  });

  describe('applyMirror', () => {
    it('should copy with the library times and record what it copied', () => {
      const song = write('A - Song.mp3', 'audio');
      const target = path.join(storage, 'Music', 'musicman');
      const result = applyMirror({ copy: [song], remove: [] }, { directory: target });
      expect(result).to.include({ copied: 1, removed: 0, error: null });
      expect(fs.readFileSync(path.join(target, 'A - Song.mp3'), 'utf8')).to.equal('audio');
      expect(stampOf(path.join(target, 'A - Song.mp3'))).to.deep.equal(stampOf(song.file));
      expect(result.sent).to.deep.equal({ 'A - Song.mp3': stampOf(song.file) });
    });

    it('should stop at a failed copy, leave no partial file, and keep the state of the songs copied', () => {
      const one = write('one.mp3', 'one');
      const target = path.join(storage, 'Music', 'musicman');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'old.mp3'), 'old');
      const result = applyMirror(
        {
          copy: [one, { file: path.join(source, 'vanished.mp3'), name: 'vanished.mp3' }],
          remove: ['old.mp3']
        },
        { directory: target, sent: { 'old.mp3': { size: 3, mtimeMs: 1 } } }
      );
      expect(result.copied).to.equal(1);
      expect(result.removed).to.equal(1);
      expect(result.error).to.match(/^vanished\.mp3: /);
      expect(fs.readdirSync(target)).to.deep.equal(['one.mp3']);
      expect(Object.keys(result.sent)).to.deep.equal(['one.mp3']);
    });
  });

  describe('mirrorToPhone', () => {
    const fakeConnect = ({ mounted = false, mountable = true, device = 'id1' } = {}) => {
      const calls = [];
      return {
        calls,
        findDevice: async name => (name === 'Fold' ? device : null),
        isMounted: async () => mounted,
        mount: async id => {
          calls.push(`mount ${id}`);
          return mountable;
        },
        unmount: async id => {
          calls.push(`unmount ${id}`);
        },
        storage: async () => storage
      };
    };

    it('should mount, mirror into the directory, and unmount what it mounted', async () => {
      const song = write('A - Song.mp3', 'audio');
      const connect = fakeConnect();
      const result = await mirrorToPhone({
        songs: [song],
        phone: { device: 'Fold', directory: 'Music/musicman' },
        connect
      });
      expect(result).to.include({ status: 'mirrored', copied: 1, error: null });
      expect(fs.existsSync(path.join(storage, 'Music', 'musicman', 'A - Song.mp3'))).to.be.true;
      expect(connect.calls).to.deep.equal(['mount id1', 'unmount id1']);
    });

    it('should leave a storage mounted before as it was', async () => {
      const connect = fakeConnect({ mounted: true });
      const result = await mirrorToPhone({ songs: [], phone: { device: 'Fold' }, connect });
      expect(result.status).to.equal('mirrored');
      expect(result.directory).to.equal(path.join(storage, 'Music', 'musicman'));
      expect(connect.calls).to.be.empty;
    });

    it('should report a phone that is not reachable or cannot be mounted', async () => {
      expect(
        (await mirrorToPhone({ songs: [], phone: { device: 'Other' }, connect: fakeConnect() }))
          .status
      ).to.equal('unreachable');
      expect(
        (
          await mirrorToPhone({
            songs: [],
            phone: { device: 'Fold' },
            connect: fakeConnect({ mountable: false })
          })
        ).status
      ).to.equal('unmounted');
    });

    it('should plan from the last copy alone in a dry run, without the phone', async () => {
      const song = write('A - Song.mp3', 'audio');
      const result = await mirrorToPhone({
        songs: [song],
        phone: { device: 'Fold' },
        sent: { 'gone.mp3': { size: 1, mtimeMs: 1 } },
        dryRun: true,
        connect: null
      });
      expect(result.status).to.equal('dry');
      expect(result.plan.copy.map(s => s.name)).to.deep.equal(['A - Song.mp3']);
      expect(result.plan.remove).to.deep.equal(['gone.mp3']);
    });
  });

  describe('kdeConnect', () => {
    it('should find a device by name or id and read the D-Bus replies', async () => {
      const calls = [];
      const exec = async (command, args) => {
        calls.push([command, args[args.length - 1]]);
        if (command === 'kdeconnect-cli') {
          return 'abc123 Galaxy Z Fold7\n';
        }
        return {
          isMounted: '{"type":"b","data":[true]}',
          getDirectories:
            '{"type":"a{sv}","data":[{"/run/user/1000/abc123/storage/emulated/0":{"type":"s","data":"Internal storage"}}]}',
          unmount: ''
        }[args[args.length - 1]];
      };
      const connect = kdeConnect(exec);
      expect(await connect.findDevice('Galaxy Z Fold7')).to.equal('abc123');
      expect(await connect.findDevice('abc123')).to.equal('abc123');
      expect(await connect.findDevice('Pixel')).to.be.null;
      expect(await connect.isMounted('abc123')).to.be.true;
      expect(await connect.storage('abc123')).to.equal('/run/user/1000/abc123/storage/emulated/0');
      expect(await connect.unmount('abc123')).to.be.null;
    });
  });
});
