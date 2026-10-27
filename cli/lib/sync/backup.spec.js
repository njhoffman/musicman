const fs = require('fs');
const os = require('os');
const path = require('path');
const NodeId3 = require('node-id3');
const sinon = require('sinon');
const { expect } = require('chai');

const { appendFrames } = require('../check/frames.js');
const { applyBackup, backupPlan, removedFolder } = require('./backup.js');

describe('Library Backup', () => {
  let root;
  let source;
  let directory;
  const mp3 = path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3');
  const write = (base, relative, content, mtime = new Date('2026-10-01T00:00:00Z')) => {
    const file = path.join(base, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (Buffer.isBuffer(content) || typeof content === 'string') {
      fs.writeFileSync(file, content);
    } else {
      fs.copyFileSync(mp3, file);
    }
    fs.utimesSync(file, mtime, mtime);
    return file;
  };
  const paths = entries => entries.map(entry => entry.path).sort();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-backup-'));
    source = path.join(root, 'Sorted');
    directory = path.join(root, 'backup');
    fs.mkdirSync(directory);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should plan copies, updates, unchanged files, and files only in the backup', () => {
    write(source, 'Rated/new.txt', 'new');
    write(source, 'Rated/same.txt', 'same');
    write(directory, 'Rated/same.txt', 'same');
    write(source, 'Rated/changed.txt', 'changed', new Date('2026-10-20T00:00:00Z'));
    write(directory, 'Rated/changed.txt', 'old');
    write(directory, 'Rated/gone.txt', 'gone');
    const plan = backupPlan({ source, directory });
    expect(paths(plan.copy)).to.deep.equal(['Rated/new.txt']);
    expect(paths(plan.update)).to.deep.equal(['Rated/changed.txt']);
    expect(paths(plan.remove)).to.deep.equal(['Rated/gone.txt']);
    expect(plan.unchanged).to.equal(1);
    expect(plan.layoutHint).to.be.null;
  });

  it('should leave out excluded paths on both sides and the removed folder', () => {
    write(source, 'musicman.sqlite', 'db');
    write(source, 'musicman.sqlite-wal', 'wal');
    write(source, '.musicman/download/a.mp3', 'dl');
    write(source, '.musicman/musicman-20261020.sqlite', 'backup');
    write(directory, `${removedFolder}/20261001/Rated/old.txt`, 'old');
    const plan = backupPlan({
      source,
      directory,
      exclude: ['musicman.sqlite*', '.musicman/download/**']
    });
    expect(paths(plan.copy)).to.deep.equal(['.musicman/musicman-20261020.sqlite']);
    expect(plan.remove).to.be.empty;
  });

  it('should hold back an mp3 whose backup copy has frames the library copy lacks', () => {
    const library = write(source, 'Rated/song.mp3', null, new Date('2026-10-20T00:00:00Z'));
    NodeId3.update({ TIT1: 'changed' }, library);
    const backup = write(directory, 'Rated/song.mp3', null);
    const tcmp = Buffer.concat([
      Buffer.from('TCMP'),
      Buffer.from([0, 0, 0, 2, 0, 0, 0]),
      Buffer.from('1')
    ]);
    appendFrames(backup, [tcmp]);
    const plan = backupPlan({ source, directory });
    expect(plan.update).to.be.empty;
    expect(plan.held).to.deep.equal([
      { path: 'Rated/song.mp3', size: fs.statSync(library).size, frames: ['TCMP'] }
    ]);
  });

  it('should not hold back an mp3 for frames without data in the backup copy', () => {
    const library = write(source, 'Rated/song.mp3', null, new Date('2026-10-20T00:00:00Z'));
    NodeId3.update({ TIT1: 'changed' }, library);
    const backup = write(directory, 'Rated/song.mp3', null);
    NodeId3.update({ TCOP: ' ' }, backup);
    const plan = backupPlan({ source, directory });
    expect(plan.held).to.be.empty;
    expect(paths(plan.update)).to.deep.equal(['Rated/song.mp3']);
  });

  it('should recognize a backup of one library folder', () => {
    write(source, 'Rated/Rock/a.txt', 'a');
    write(source, 'Unrated/b.txt', 'b');
    write(directory, 'Rock/a.txt', 'a');
    expect(backupPlan({ source, directory }).layoutHint).to.deep.equal({
      folder: 'Rated',
      names: ['Rock']
    });
  });

  it('should copy with the source time and move files only in the backup aside', () => {
    const mtime = new Date('2026-10-20T00:00:00Z');
    write(source, 'Rated/new.txt', 'new', mtime);
    write(source, 'Rated/changed.txt', 'changed', mtime);
    write(directory, 'Rated/changed.txt', 'old');
    write(directory, 'Rated/gone.txt', 'gone');
    const events = [];
    const result = applyBackup(backupPlan({ source, directory }), {
      now: new Date('2026-10-21T12:00:00Z'),
      onFile: action => events.push(action)
    });
    expect(result).to.include({ copied: 1, updated: 1, moved: 1 });
    expect(fs.readFileSync(path.join(directory, 'Rated/changed.txt'), 'utf8')).to.equal('changed');
    expect(fs.statSync(path.join(directory, 'Rated/new.txt')).mtime.getTime()).to.equal(
      mtime.getTime()
    );
    expect(fs.existsSync(path.join(directory, 'Rated/gone.txt'))).to.be.false;
    expect(
      fs.readFileSync(path.join(directory, removedFolder, '20261021', 'Rated/gone.txt'), 'utf8')
    ).to.equal('gone');
    expect(events.sort()).to.deep.equal(['copy', 'move', 'update']);
    // the next plan has nothing to do
    const again = backupPlan({ source, directory });
    expect(again.copy.length + again.update.length + again.remove.length).to.equal(0);
  });

  it('should set the time of a copy after renaming it into place', () => {
    write(source, 'Rated/new.txt', 'new');
    const rename = sinon.spy(fs, 'renameSync');
    const utimes = sinon.spy(fs, 'utimesSync');
    try {
      applyBackup(backupPlan({ source, directory }));
      const target = path.join(directory, 'Rated/new.txt');
      expect(utimes.calledWith(target)).to.be.true;
      expect(utimes.calledWith(`${target}.musicman-partial`)).to.be.false;
      expect(utimes.calledAfter(rename)).to.be.true;
    } finally {
      rename.restore();
      utimes.restore();
    }
  });

  it('should list copies whose time the file system did not keep', () => {
    write(source, 'Rated/new.txt', 'new');
    write(source, 'Rated/changed.txt', 'changed');
    write(directory, 'Rated/changed.txt', 'old');
    write(source, 'Rated/same.txt', 'same');
    write(directory, 'Rated/same.txt', 'same');
    const utimes = sinon.stub(fs, 'utimesSync');
    try {
      const result = applyBackup(backupPlan({ source, directory }));
      expect(result.timesLost.sort()).to.deep.equal(['Rated/changed.txt', 'Rated/new.txt']);
    } finally {
      utimes.restore();
    }
    expect(applyBackup(backupPlan({ source, directory })).timesLost).to.deep.equal([]);
  });
});
