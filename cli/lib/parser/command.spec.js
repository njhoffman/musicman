const parser = require('./index.js');

describe('Command assignment', () => {
  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    library: { tags: [] }
  };
  const currentSong = { file: 'testDir/testSong.mp3' };

  it('Should default to view command if no arguments are provided', () => {
    expect(parser({ args: [], config }).command).to.include({ name: 'view' });
    expect(parser({ args: ['artist:Doors'], config }).command).to.include({ name: 'view' });
  });

  it('Should reject a first word that is not a command or a path, suggesting commands with that switch', () => {
    expect(() => parser({ args: ['push'], config })).to.throw(
      "Unknown command 'push', did you mean musicman sync --push? (musicman --help)"
    );
    expect(() => parser({ args: ['backup'], config })).to.throw(
      'did you mean musicman db --backup or musicman sync --backup?'
    );
    expect(() => parser({ args: ['no', 'matching', 'command'], config })).to.throw(
      "Unknown command 'no', commands are view, edit"
    );
  });

  it('Should reject words that commands taking only switches do not use', () => {
    expect(() => parser({ args: ['sync', 'push'], config })).to.throw(
      "musicman sync does not take 'push', did you mean --push?"
    );
    expect(() => parser({ args: ['sync', '-push'], config })).to.throw('did you mean --push?');
    expect(() => parser({ args: ['sort', 'now'], config })).to.throw(
      "musicman sort does not take 'now', it takes only switches: --dry-run"
    );
    expect(parser({ args: ['sync', '--push', '-n'], config }).options.switches).to.deep.equal({
      push: true,
      dryRun: true
    });
  });

  it('Should still take an existing path or an explicit view as the first argument', () => {
    expect(parser({ args: ['lib'], config }).command).to.include({ name: 'view' });
    expect(parser({ args: ['view', 'artist:Doors'], config }).command).to.include({ name: 'view' });
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
    const test1 = parser({ args: ['view', 'any', 'other', 'field:value', 'args'], config });
    expect(test1.command).to.include({ name: 'view' });
  });
});
