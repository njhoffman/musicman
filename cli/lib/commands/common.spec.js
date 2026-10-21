const { expect } = require('chai');
const { libraryScanOptions } = require('./common.js');

describe('Command Scan Options', () => {
  it('should scan recursively when no target argument was given', () => {
    expect(libraryScanOptions({ targetGiven: false, switches: {} }).switches).to.deep.equal({
      recursive: true
    });
  });

  it('should keep --norecursive and --recursive as given', () => {
    expect(
      libraryScanOptions({ targetGiven: false, switches: { recursive: false } }).switches.recursive
    ).to.be.false;
    expect(
      libraryScanOptions({ targetGiven: true, switches: { recursive: true } }).switches.recursive
    ).to.be.true;
  });

  it('should leave a given target to the configured default', () => {
    expect(libraryScanOptions({ targetGiven: true, switches: {} }).switches.recursive).to.be
      .undefined;
    expect(libraryScanOptions({ switches: {} }).switches.recursive).to.be.undefined;
  });
});
