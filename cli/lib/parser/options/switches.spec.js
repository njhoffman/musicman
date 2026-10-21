const { expect } = require('chai');
const parseSwitches = require('./switches.js');

describe('Switch Parsing', () => {
  it('should read a value from --name=value, --name value, and the alias', () => {
    expect(parseSwitches(['--format=csv']).switches).to.deep.equal({ format: 'csv' });
    expect(parseSwitches(['--format', 'json']).switches).to.deep.equal({ format: 'json' });
    expect(parseSwitches(['-o', 'html']).switches).to.deep.equal({ format: 'html' });
  });

  it('should leave the value out of the remaining arguments', () => {
    const { remaining, switches } = parseSwitches([
      'rating:4',
      '--format=oneline',
      '--fzf',
      'Doors'
    ]);
    expect(switches).to.deep.equal({ format: 'oneline', fzf: true });
    expect(remaining).to.deep.equal(['rating:4', 'Doors']);
  });

  it('should not split = in switches without a value or in other arguments', () => {
    const { remaining, switches } = parseSwitches(['--fzf=1', 'mood=Upbeat']);
    expect(switches).to.deep.equal({});
    expect(remaining).to.deep.equal(['--fzf=1', 'mood=Upbeat']);
  });
});
