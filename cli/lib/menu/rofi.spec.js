const { EventEmitter } = require('events');
const { expect } = require('chai');

const { buttonMarkup, panelView, rasiMarkup, runRofi } = require('./rofi.js');

describe('Menu rofi', () => {
  // a spawn that records rofi's arguments and input, then exits with code and output
  const fakeSpawn = (code, output = '') => {
    const calls = [];
    const spawnProcess = (bin, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = {
        end: input => {
          calls.push({ bin, args, input });
          setImmediate(() => {
            if (output) {
              child.stdout.emit('data', output);
            }
            child.emit('close', code);
          });
        }
      };
      return child;
    };
    return { calls, spawnProcess };
  };

  describe('runRofi', () => {
    it('should resolve to the picked index, a bound key, or null when dismissed', async () => {
      expect(await runRofi([], 'a', { spawnProcess: fakeSpawn(0, '2\n').spawnProcess })).to.equal(
        2
      );
      expect(await runRofi([], 'a', { spawnProcess: fakeSpawn(1).spawnProcess })).to.equal(null);
      const keys = ['p', 'Tab'];
      expect(
        await runRofi([], 'a', { spawnProcess: fakeSpawn(11).spawnProcess, keys })
      ).to.deep.equal({
        key: 'Tab'
      });
    });

    it('should bind keys to custom keybindings and unbind Tab from moving between entries', async () => {
      const fake = fakeSpawn(1);
      await runRofi(['-p', 'x'], 'a', { spawnProcess: fake.spawnProcess, keys: ['p', 'Tab'] });
      expect(fake.calls[0].args).to.deep.equal([
        '-dmenu',
        '-i',
        '-no-custom',
        '-format',
        'i',
        '-kb-element-next',
        '',
        '-kb-custom-1',
        'p',
        '-kb-custom-2',
        'Tab',
        '-p',
        'x'
      ]);
    });

    it('should reject other exit codes', async () => {
      await runRofi([], 'a', { spawnProcess: fakeSpawn(2).spawnProcess }).then(
        () => expect.fail('should reject'),
        err => expect(err.message).to.equal('rofi exited with code 2')
      );
    });
  });

  describe('panelView', () => {
    it('should draw buttons separated by |, with the cover, accent, status and active entries', async () => {
      const fake = fakeSpawn(0, '0');
      const view = panelView({ theme: '/t.rasi', spawnProcess: fake.spawnProcess });
      await view({
        title: 'Spotify · Song',
        message: 'details',
        status: ['<b>Spotify</b>', 'playing'],
        cover: '/c/cover.jpg',
        accent: '#1db954',
        columns: 2,
        entries: [
          { icon: 'A', label: 'one', key: 'a' },
          { icon: 'B', label: 'two', key: 'b', active: true },
          { icon: 'C', label: 'three' }
        ],
        keys: ['q']
      });
      const { args, input } = fake.calls[0];
      expect(input.split('|')).to.have.length(3);
      expect(args).to.include.members([
        '-theme',
        '/t.rasi',
        '-p',
        'Spotify · Song',
        '-mesg',
        'details'
      ]);
      expect(args).to.include('listview { columns: 2; lines: 2; }');
      expect(args).to.include('* { accent: #1db954; }');
      expect(args).to.include('icon-cover { filename: "/c/cover.jpg"; }');
      expect(args).to.include('textbox-status { content: "<b>Spotify</b>\\nplaying"; }');
      expect(args.slice(args.indexOf('-a'), args.indexOf('-a') + 2)).to.deep.equal(['-a', '1']);
      expect(args).to.include.members([
        '-kb-custom-1',
        'a',
        '-kb-custom-2',
        'b',
        '-kb-custom-3',
        'q'
      ]);
    });
  });

  it('should show keysym names as the character they type, and fade disabled buttons', () => {
    expect(buttonMarkup({ icon: 'V', label: 'vol -', key: 'minus' })).to.include('>-</span>');
    expect(buttonMarkup({ icon: 'V', label: 'a|b', disabled: true })).to.match(
      /^<span alpha="35%">.*a¦b/s
    );
    expect(buttonMarkup({ icon: 'V', label: 'on', active: true })).to.include('<b>on</b>');
  });

  it('should write markup as a rasi string without quotes or line breaks', () => {
    expect(rasiMarkup('a "b"\nc\'s')).to.equal('"a &quot;b&quot;\\nc&apos;s"');
  });
});
