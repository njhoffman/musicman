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

  it('should require a name and a filter for each stats.filters entry', () => {
    const { errors } = validateConfig({
      stats: {
        filters: [{ name: 'Rated 4.0+', filter: 'rating:4.0' }, { name: 'No filter' }, 'rating:5']
      }
    });
    expect(errors).to.deep.equal([
      'stats.filters[1] must have a name and a filter',
      'stats.filters[2] must have a name and a filter'
    ]);
  });

  it('should still report options moved into views', () => {
    const { errors } = validateConfig({ output: { table: {} } });
    expect(errors).to.deep.equal(['output.table is no longer supported (moved to views.table)']);
  });
});
