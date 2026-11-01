const { EventEmitter } = require('events');
const { expect } = require('chai');

const { buttonMarkup, buttonText, keyLabel, panelView, rasiMarkup, runRofi } = require('./rofi.js');

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

  // a rofi that stays open until killed, then closes like a process ended by a signal
  const openRofi = () => {
    const killed = [];
    const spawnProcess = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = { end: () => {} };
      child.kill = () => {
        killed.push(true);
        setImmediate(() => child.emit('close', null));
      };
      return child;
    };
    return { killed, spawnProcess };
  };

  describe('runRofi', () => {
    it('should close rofi and resolve to redraw when the signal aborts', async () => {
      const rofi = openRofi();
      const controller = new AbortController();
      const shown = runRofi([], 'a', {
        spawnProcess: rofi.spawnProcess,
        signal: controller.signal
      });
      controller.abort();
      expect(await shown).to.deep.equal({ redraw: true });
      expect(rofi.killed).to.deep.equal([true]);

      const late = openRofi();
      const aborted = new AbortController();
      aborted.abort();
      expect(
        await runRofi([], 'a', { spawnProcess: late.spawnProcess, signal: aborted.signal })
      ).to.deep.equal({ redraw: true });
    });

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
      expect(args).to.include('listview { columns: 2; lines: 2; scrollbar: false; }');
      expect(args).to.include('-markup-rows');
      expect(args).to.not.include('-selected-row');
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

    it('should draw a plain menu as text with a filter box, faded entries urgent, rows capped', async () => {
      const fake = fakeSpawn(0, '0');
      const view = panelView({ theme: '/t.rasi', spawnProcess: fake.spawnProcess });
      const entries = Array.from({ length: 10 }, (_, i) => ({
        icon: 'I',
        label: `tag${i}`,
        active: i === 1,
        disabled: i === 2
      }));
      await view({
        title: 't',
        entries,
        keys: [],
        plain: true,
        columns: 2,
        maxLines: 3,
        align: 'left'
      });
      const { args, input } = fake.calls[0];
      expect(args).to.not.include('-markup-rows');
      expect(args).to.include('listview { columns: 2; lines: 3; scrollbar: true; }');
      expect(args).to.include('inputbar { children: [ "prompt", "textbox-sep", "entry" ]; }');
      expect(args).to.include('element-text { horizontal-align: 0; }');
      expect(args.slice(args.indexOf('-u'), args.indexOf('-u') + 2)).to.deep.equal(['-u', '2']);
      expect(args.slice(args.indexOf('-eh'), args.indexOf('-eh') + 2)).to.deep.equal(['-eh', '2']);
      expect(input.split('|').slice(0, 2)).to.deep.equal(['I\ntag0', 'I ✓\ntag1']);
    });

    it('should select the given entry when the menu opens', async () => {
      const fake = fakeSpawn(0, '0');
      await panelView({ spawnProcess: fake.spawnProcess })({
        title: 't',
        entries: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
        selected: 2
      });
      const { args } = fake.calls[0];
      expect(
        args.slice(args.indexOf('-selected-row'), args.indexOf('-selected-row') + 2)
      ).to.deep.equal(['-selected-row', '2']);
    });
  });

  it('should show Alt keys as M-, color icons by tone, and put plain keys after the caption', () => {
    expect(keyLabel('Alt+a')).to.equal('M-a');
    expect(keyLabel('Alt+minus')).to.equal('M--');
    expect(buttonMarkup({ icon: 'V', label: 'next', tone: '#123456' })).to.include(
      '<span font_size="x-large" foreground="#123456">V</span>'
    );
    expect(buttonMarkup({ icon: 'V', label: 'x', tone: '#123456', disabled: true })).to.not.include(
      'foreground'
    );
    expect(buttonText({ icon: 'I', label: 'Study', key: 'Alt+a', active: true })).to.equal(
      'I ✓\nStudy   M-a'
    );
    expect(buttonText({ label: 'path  /a|b' })).to.equal('path  /a¦b');
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
