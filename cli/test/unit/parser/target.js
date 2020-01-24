const path = require('path');
const parser = require('../../../lib/parser');

describe('Target assignment', () => {
  const testFile = path.join(process.cwd(), 'test/data/sandbox/dir1/testFile01.mp3');

  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    tags: [
      {
        name: 'artist',
        id: 'TPE1'
      },
      {
        name: 'title',
        id: 'TIT2'
      },
      {
        name: 'album',
        id: 'TALB'
      },
      {
        name: 'CustomField1',
        id: 'TXXX.Custom1',
        multi: true
      },
      {
        name: 'CustomField2',
        id: 'TXXX.Custom2',
        multi: true
      },
      {
        name: 'CustomField3',
        id: 'TXXX.Custom3'
      }
    ]
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

  // it('Should resolve relative directories to absolute paths', () => {});
});
