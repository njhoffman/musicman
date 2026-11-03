const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const NodeId3 = require('node-id3');
const { expect } = require('chai');

const { rewriteTags, updateTags } = require('../metadata/write.js');

// sleeve's timed lyrics, as it writes them: LRC text in the one USLT frame (docs/09-contract.md)
const lrc = '[00:01.00]first line\n[00:05.50]second line';
const pluginPath = path.join(__dirname, '..', '..', 'share', 'beets');

describe('Timed lyrics are kept', () => {
  let root;
  let file;
  const lyrics = () => NodeId3.read(file);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-lyrics-'));
    file = path.join(root, 'song.mp3');
    fs.copyFileSync(path.join(process.cwd(), 'test/data/source/dir1/testFile01.mp3'), file);
    NodeId3.update(
      {
        unsynchronisedLyrics: { language: 'eng', text: lrc },
        synchronisedLyrics: [
          {
            language: 'eng',
            timeStampFormat: 2,
            contentType: 1,
            shortText: '',
            synchronisedText: [
              { text: 'first', timeStamp: 1000 },
              { text: 'second', timeStamp: 5500 }
            ]
          }
        ]
      },
      file
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should keep USLT and SYLT through musicman updates and rewrites of the tag', () => {
    updateTags(
      { title: 'New Title', userDefinedText: [{ description: 'rb_energy', value: '0.5' }] },
      file
    );
    rewriteTags(file, raw => ({ ...raw, TPE1: 'New Artist' }));
    const tags = lyrics();
    expect(tags).to.include({ title: 'New Title', artist: 'New Artist' });
    expect(tags.unsynchronisedLyrics.text).to.equal(lrc);
    expect(tags.synchronisedLyrics).to.have.length(1);
    expect(tags.synchronisedLyrics[0].synchronisedText).to.have.length(2);
  });

  describe('beets with the keeplrc plugin', function beetsSuite() {
    this.timeout(60000);
    const beetFound = spawnSync('beet', ['version'], { encoding: 'utf8' }).status === 0;
    let beet;

    beforeEach(function setup() {
      if (!beetFound) {
        this.skip();
      }
      const config = path.join(root, 'config.yaml');
      fs.writeFileSync(
        config,
        [
          `directory: ${path.join(root, 'lib')}`,
          `library: ${path.join(root, 'lib.db')}`,
          `pluginpath: [${pluginPath}]`,
          'plugins: keeplrc',
          'id3v23: yes',
          'import:',
          '  write: yes',
          '  copy: no',
          '  move: no',
          ''
        ].join('\n')
      );
      beet = (...args) => {
        const result = spawnSync('beet', ['-c', config, ...args], { encoding: 'utf8' });
        if (result.status !== 0) {
          throw new Error(`beet ${args.join(' ')}: ${result.stderr}`);
        }
        return result.stdout;
      };
      beet('import', '-A', '-q', '-s', file);
    });

    it('should keep the timed lyrics when beets writes other lyrics, and write everything else', () => {
      beet('modify', '-y', 'lyrics=plain stale lyrics', `path:${file}`);
      expect(lyrics().unsynchronisedLyrics.text).to.equal(lrc);
      beet('modify', '-y', 'title=Beets Title', `path:${file}`);
      const tags = lyrics();
      expect(tags.title).to.equal('Beets Title');
      expect(tags.unsynchronisedLyrics.text).to.equal(lrc);
      expect(tags.synchronisedLyrics).to.have.length(1);
      // beets' own copy follows the file
      expect(beet('ls', '-f', '$lyrics', `path:${file}`)).to.include('[00:01.00]first line');
    });
  });
});
