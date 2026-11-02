const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { driftFindings, fileChecks, inspectFile, multiProblems } = require('./files.js');

// an ID3v2.4 tag holding text frames, sizes syncsafe
const v24Tag = frames => {
  const syncsafe = size =>
    Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
      return Buffer.concat([
        Buffer.from(id, 'latin1'),
        syncsafe(data.length),
        Buffer.alloc(2),
        data
      ]);
    })
  );
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncsafe(body.length), body]);
};

describe('File checks', () => {
  const multi = { Mood: 'mood', Context: 'context' };
  const access = () => {};
  let directory;
  let file;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-check-'));
    file = path.join(directory, 'song.mp3');
    fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should report multi value fields with empty, padded, or repeated items', () => {
    expect(multiProblems('Lounge,Study')).to.deep.equal([]);
    expect(multiProblems('Lounge,Study,')).to.deep.equal(['empty item']);
    expect(multiProblems('Lounge, Study')).to.deep.equal(['spaces around an item']);
    expect(multiProblems('Study,study')).to.deep.equal(['repeated item']);
    // the test file's mood is written 'Sad,Gloomy,'
    expect(inspectFile(file, { multi, access }).multi).to.deep.equal([
      "mood 'Sad,Gloomy,': empty item"
    ]);
  });

  it('should report files without a tag, unwritable, or unreadable', () => {
    const plain = path.join(directory, 'plain.mp3');
    fs.writeFileSync(plain, Buffer.alloc(64));
    expect(inspectFile(plain, { multi, access }).unreadable).to.deep.equal(['no ID3v2 tag']);
    const denied = () => {
      throw new Error('EACCES');
    };
    expect(inspectFile(file, { multi, access: denied }).unreadable).to.deep.equal(['not writable']);
    const failing = () => {
      throw new Error('EIO: i/o error');
    };
    expect(inspectFile(file, { multi, access, readTag: failing }).unreadable).to.deep.equal([
      'cannot be read: EIO: i/o error'
    ]);
    // an ID3v2.2 tag (three character frame ids) cannot be walked
    const v22 = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([2, 0, 0, 0, 0, 0, 10]),
      Buffer.from('TT2\0\0\u0003\0abc')
    ]);
    expect(inspectFile(file, { multi, access, readTag: () => v22 }).unreadable[0]).to.match(
      /^ID3v2\.2 tag cannot be walked/
    );
  });

  it('should report frames node-id3 does not know only where a rewrite cannot keep them', () => {
    const tag = v24Tag([
      ['TIT2', 'A'],
      ['TCMP', '1']
    ]);
    expect(inspectFile(file, { multi, access, readTag: () => tag }).frames).to.deep.equal([
      'TCMP in an ID3v2.4 tag would be lost on a rewrite'
    ]);
    // the test file is ID3v2.3, whose unknown frames musicman copies back
    expect(inspectFile(file, { multi, access }).frames).to.deep.equal([]);
  });

  it('should report a repeated frame node-id3 holds once only where a rewrite cannot keep it', () => {
    const tag = v24Tag([
      ['TIT2', 'A'],
      ['COMM', 'one'],
      ['COMM', 'two']
    ]);
    expect(inspectFile(file, { multi, access, readTag: () => tag }).frames).to.deep.equal([
      'all but one COMM frame in an ID3v2.4 tag would be lost on a rewrite'
    ]);
  });

  it('should report changed, missing, and unknown files against the database', () => {
    const base = '/music';
    const stat = target => ({
      mtimeMs: target.endsWith('changed.mp3') ? 5000.7 : 1000.2,
      size: 10
    });
    const findings = driftFindings({
      songs: [
        { path: 'same.mp3', mtime: 1000, size: 10 },
        { path: 'changed.mp3', mtime: 1000, size: 10 },
        { path: 'gone.mp3', mtime: 1000, size: 10 }
      ],
      files: ['/music/same.mp3', '/music/changed.mp3', '/music/new.mp3'],
      baseDirectory: base,
      stat
    });
    expect(findings).to.deep.equal([
      { file: 'changed.mp3', detail: 'changed since the last db --update' },
      { file: 'gone.mp3', detail: 'in the database, but the file is gone' },
      { file: 'new.mp3', detail: 'not in the database' }
    ]);
  });

  it('should run only the wanted file checks with paths relative to the base directory', async () => {
    const progress = [];
    const results = await fileChecks({
      songs: [],
      files: [file],
      baseDirectory: directory,
      config: { library: { tags: [{ name: 'mood', id: 'TXXX.Mood', multi: true }] } },
      wanted: ['multi', 'frames'],
      onProgress: (done, total) => progress.push([done, total])
    });
    expect(Object.keys(results).sort()).to.deep.equal(['frames', 'multi']);
    expect(results.multi).to.deep.equal([
      { file: 'song.mp3', detail: "mood 'Sad,Gloomy,': empty item" }
    ]);
    expect(progress).to.deep.equal([[1, 1]]);
  });
});
