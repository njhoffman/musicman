const { expect } = require('chai');
const { pickWithFzf, previewCommand } = require('./fzf.js');

describe('fzf Picker', () => {
  const spawned = [];
  const fakeSpawn = result => (command, args, options) => {
    spawned.push({ command, args, options });
    return result;
  };

  beforeEach(() => {
    spawned.length = 0;
  });

  it('should show the text after the tab and return the keys of picked lines', () => {
    const keys = pickWithFzf(['/m/a.mp3\tA', '/m/b.mp3\tB'], {
      preview: 'view {1}',
      prompt: 'search',
      spawn: fakeSpawn({ status: 0, stdout: '/m/a.mp3\tA\n/m/b.mp3\tB\n' })
    });
    expect(keys).to.deep.equal(['/m/a.mp3', '/m/b.mp3']);
    const [{ command, args, options }] = spawned;
    expect(command).to.equal('fzf');
    expect(args).to.include.members([
      '--ansi',
      '--delimiter=\t',
      '--with-nth=2..',
      '--multi',
      '--preview=view {1}',
      '--prompt=search> '
    ]);
    expect(options.input).to.equal('/m/a.mp3\tA\n/m/b.mp3\tB');
  });

  it('should pick nothing when cancelled or nothing matches', () => {
    expect(pickWithFzf(['a\tA'], { spawn: fakeSpawn({ status: 130, stdout: '' }) })).to.deep.equal(
      []
    );
    expect(pickWithFzf(['a\tA'], { spawn: fakeSpawn({ status: 1, stdout: '' }) })).to.deep.equal(
      []
    );
  });

  it('should explain a missing fzf and fail on other exit codes', () => {
    const missing = Object.assign(new Error('spawn fzf ENOENT'), { code: 'ENOENT' });
    expect(() => pickWithFzf([], { spawn: fakeSpawn({ error: missing }) })).to.throw(
      'fzf is not installed or not on PATH'
    );
    expect(() => pickWithFzf([], { spawn: fakeSpawn({ status: 2 }) })).to.throw(
      'fzf exited with status 2'
    );
  });

  it('should preview with musicman itself in color', () => {
    expect(previewCommand('view')).to.match(
      /^FORCE_COLOR=1 ".*node[^"]*" ".*lib\/cli\.js" view \{1\}$/
    );
  });
});
