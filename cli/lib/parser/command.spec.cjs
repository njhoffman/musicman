const parser = require('./index.cjs');

describe('Command assignment', () => {
  const config = {
    mpd: { baseDirectory: 'testBaseDir' }
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

  it('Should return edit command if any args contain assignment (=) operator', () => {
    const test1 = parser({ args: ['any', 'other', 'field=value', 'filter:value', 'args'], config });
    expect(test1.command).to.include({ name: 'edit' });
  });

  it('Should return view command if any args contain filter (:) and none with (=) operators', () => {
    const test1 = parser({ args: ['any', 'other', 'field:value', 'args'], config });
    expect(test1.command).to.include({ name: 'view' });
  });
});
