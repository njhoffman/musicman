const path = require('path');
const parser = require('./index.cjs');

describe('Target assignment', () => {
  const testFile = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile01.mp3');

  const config = {
    mpd: { baseDirectory: 'testBaseDir' }
  };
  const currentSong = { file: 'testDir/testSong.mp3' };

  it('Should assign target if argument is a file or directory that exists', async () => {
    const test1 = parser({ args: [testFile], config, currentSong });
    const test2 = parser({ args: ['additional', testFile, 'args'], config });
    expect(test1).to.include({ target: testFile });
    expect(test2).to.include({ target: testFile });
  });

  it('Should assign target to currently playing song if target not provided or does not exists', () => {
    const test1 = parser({ args: [], currentSong, config });
    expect(test1).to.include({ target: `${config.mpd.baseDirectory}/${currentSong.file}` });
  });

  it('Should assign target to current directory if no song playing and last argument is not a valid target', () => {
    const test1 = parser({ args: ['some', 'args', 'notvalidtarget'], config });
    expect(test1).to.include({ target: process.cwd() });
  });

  it('Should resolve relative target path to absolute path ', () => {
    const test1 = parser({ args: ['./'], config });
    expect(test1).to.include({ target: process.cwd() });
  });
});
