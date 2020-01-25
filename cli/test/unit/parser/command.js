const parser = require('../../../lib/parser');

describe('Command assignment', () => {
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

  it('Should default to view command if no matching arguments provided', () => {
    const test1 = parser({ args: [], config });
    const test2 = parser({ args: ['no', 'matching', 'command'], config });
    expect(test1.command).to.include({ name: 'view' });
    expect(test2.command).to.include({ name: 'view' });
  });

  it('Should edit command if first argument is a rating number current song playing', () => {
    const test1 = parser({ args: ['4', 'other', 'args'], config, currentSong });
    const test2 = parser({ args: ['4.5'], config, currentSong });
    expect(test1.command).to.include({ name: 'edit' });
    expect(test2.command).to.include({ name: 'edit' });
  });

  it('Should return view command if first argument is a rating and no song playing', () => {
    const test1 = parser({ args: ['4', 'other', 'args'], config });
    const test2 = parser({ args: ['4.5'], config });
    expect(test1.command).to.include({ name: 'view' });
    expect(test2.command).to.include({ name: 'view' });
  });

  // it('Should return edit command if any args contain assignment (=) operator', () => {});
  // it('Should return view command if any args contain filter (:) and none with (=) operators', () => {});
});
