const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkName,
  findPreset,
  joinTerms,
  readPresets,
  smartFile,
  splitTerms,
  writePresets
} = require('./presets.js');

describe('Smart playlist presets', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicman-smart-'));
    file = path.join(dir, 'musicman', 'smart.yml');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('should live in the config directory', () => {
    expect(smartFile({ XDG_CONFIG_HOME: '/cfg' })).to.equal('/cfg/musicman/smart.yml');
    expect(smartFile({})).to.equal(path.join(os.homedir(), '.config', 'musicman', 'smart.yml'));
  });

  it('should split terms like a shell, keeping quoted values together', () => {
    expect(splitTerms('context:Study  artist:"Mazzy Star" ~mood:Sad')).to.deep.equal([
      'context:Study',
      'artist:Mazzy Star',
      '~mood:Sad'
    ]);
    expect(splitTerms(`title:'It "Hurts"' ""`)).to.deep.equal(['title:It "Hurts"', '']);
    expect(splitTerms('')).to.deep.equal([]);
    expect(() => splitTerms('artist:"Mazzy')).to.throw('Unclosed " in');
  });

  it('should join terms so splitting reads them back', () => {
    const terms = ['context:Study', 'artist:Mazzy Star', 'title:It "Hurts"', 'two words'];
    const text = joinTerms(terms);
    expect(text).to.equal(`context:Study artist:"Mazzy Star" title:'It "Hurts"' "two words"`);
    expect(splitTerms(text)).to.deep.equal(terms);
  });

  it('should read names to terms in file order, from strings or lists', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      'zeta: rating:5\nstudy: context:Study artist:"Mazzy Star"\nlisted: [mood:Upbeat, rating:4.5]\n'
    );
    expect(readPresets(file)).to.deep.equal([
      { name: 'zeta', terms: ['rating:5'] },
      { name: 'study', terms: ['context:Study', 'artist:Mazzy Star'] },
      { name: 'listed', terms: ['mood:Upbeat', 'rating:4.5'] }
    ]);
  });

  it('should read no presets from a missing or empty file, and refuse a bad one', () => {
    expect(readPresets(file)).to.deep.equal([]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    expect(readPresets(file)).to.deep.equal([]);
    fs.writeFileSync(file, '- a\n- b\n');
    expect(() => readPresets(file)).to.throw('should map smart playlist names');
    fs.writeFileSync(file, 'empty:\n');
    expect(() => readPresets(file)).to.throw("Smart playlist 'empty'");
  });

  it('should write presets back so they read the same', () => {
    const presets = [
      { name: 'study', terms: ['context:Study', 'artist:Mazzy Star'] },
      { name: 'loud', terms: ['rating:4.5'] }
    ];
    writePresets(file, presets);
    expect(fs.readFileSync(file, 'utf8')).to.equal(
      `study: context:Study artist:"Mazzy Star"\nloud: rating:4.5\n`
    );
    expect(readPresets(file)).to.deep.equal(presets);
    writePresets(file, []);
    expect(readPresets(file)).to.deep.equal([]);
  });

  it('should take names without spaces that are not actions', () => {
    expect(() => checkName('night-drive_2.0')).to.not.throw();
    expect(() => checkName('night drive')).to.throw('letters, digits');
    expect(() => checkName('-x')).to.throw('letters, digits');
    expect(() => checkName()).to.throw('letters, digits');
    expect(() => checkName('show')).to.throw("'show' is a smart action");
  });

  it('should find a preset by name, or list the names there are', () => {
    const presets = [{ name: 'a', terms: ['x'] }];
    expect(findPreset(presets, 'a')).to.equal(presets[0]);
    expect(() => findPreset(presets, 'b')).to.throw("No smart playlist 'b', there are: a");
    expect(() => findPreset([], 'b')).to.throw('save one with musicman smart save');
  });
});
