const { expect } = require('chai');
const { validateConfig } = require('musicman-common/config/validator');

describe('validateConfig', () => {
  it('should accept views.table.separators', () => {
    const { errors, warnings } = validateConfig({
      views: { table: { separators: { vertical: true, horizontal: false } } }
    });
    expect(errors).to.deep.equal([]);
    expect(warnings).to.deep.equal([]);
  });

  it('should reject the misspelled views.table.seperators and name its new key', () => {
    const { errors } = validateConfig({
      views: { table: { seperators: { vertical: true } } }
    });
    expect(errors).to.deep.equal([
      'views.table.seperators is no longer supported (renamed to views.table.separators)'
    ]);
  });

  it('should still report options moved into views', () => {
    const { errors } = validateConfig({ output: { table: {} } });
    expect(errors).to.deep.equal(['output.table is no longer supported (moved to views.table)']);
  });
});
