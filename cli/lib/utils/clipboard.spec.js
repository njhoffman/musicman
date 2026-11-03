const { EventEmitter } = require('events');
const { expect } = require('chai');

const { clipboardCommand, copyText } = require('./clipboard.js');

// a child process that takes stdin and exits with code (or fails to start with error)
const fakeSpawn = ({ code = 0, error = null } = {}) => {
  const calls = [];
  const spawnProcess = (bin, args) => {
    const child = new EventEmitter();
    const call = { bin, args, input: '' };
    calls.push(call);
    child.stdin = {
      end: text => {
        call.input = text;
        setImmediate(() => (error ? child.emit('error', error) : child.emit('exit', code)));
      }
    };
    return child;
  };
  return { calls, spawnProcess };
};

describe('clipboard', () => {
  it('should use wl-copy under Wayland and xclip otherwise', () => {
    expect(clipboardCommand({ WAYLAND_DISPLAY: 'wayland-0' })).to.deep.equal(['wl-copy', []]);
    expect(clipboardCommand({ DISPLAY: ':0' })).to.deep.equal([
      'xclip',
      ['-selection', 'clipboard']
    ]);
  });

  it('should write the text to the clipboard program', async () => {
    const fake = fakeSpawn();
    await copyText('/m/a.mp3', { spawnProcess: fake.spawnProcess, env: {} });
    expect(fake.calls).to.deep.equal([
      { bin: 'xclip', args: ['-selection', 'clipboard'], input: '/m/a.mp3' }
    ]);
  });

  it('should reject when the program fails or is missing', async () => {
    const failed = fakeSpawn({ code: 1 });
    await copyText('a', { spawnProcess: failed.spawnProcess, env: {} }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.equal('xclip exited with code 1')
    );
    const missing = fakeSpawn({ error: Object.assign(new Error('spawn'), { code: 'ENOENT' }) });
    await copyText('a', { spawnProcess: missing.spawnProcess, env: { WAYLAND_DISPLAY: 'w' } }).then(
      () => expect.fail('should reject'),
      err => expect(err.message).to.equal('wl-copy is not installed, cannot copy')
    );
  });
});
