const { expect } = require('chai');
const {
  filterProblems,
  filterTerms,
  validateConfig,
  validateLibrary
} = require('musicman-common/config/validator');

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

describe('configured filters', () => {
  const library = {
    tags: [
      { name: 'context', id: 'TXXX.Context' },
      { name: 'grouping', id: 'TIT1' }
    ]
  };

  it('should split a filter before each field and find unknown fields and stray words', () => {
    expect(filterTerms('grouping:Rock Singles ~context:Study')).to.deep.equal([
      'grouping:Rock Singles',
      '~context:Study'
    ]);
    const names = new Set(['context', 'grouping']);
    expect(
      filterProblems(['rating:4.0-4.0', '4.5', 'context:Study', '~grouping:'], names)
    ).to.deep.equal([]);
    expect(filterProblems(['contxt:Study', 'Study'], names)).to.deep.equal([
      "unknown field 'contxt' in 'contxt:Study'",
      "'Study' is not field:value"
    ]);
  });

  it('should reject unknown fields in stats.filters, sync.playlists and menu.buttons', () => {
    const errors = validateLibrary({
      library,
      stats: { filters: [{ name: 'Rated', filter: 'rating:4.0 grouping:Rock' }] },
      sync: {
        playlists: [
          { filter: 'context:Study', playlist: 'p1' },
          { filter: 'contxt:Study', playlist: 'p2' }
        ]
      },
      menu: { buttons: [{ label: 'Hot', filter: 'picks:Hot' }] }
    });
    expect(errors).to.deep.equal([
      "sync.playlists[1].filter: unknown field 'contxt' in 'contxt:Study'",
      "menu.buttons[0].filter: unknown field 'picks' in 'picks:Hot'"
    ]);
  });
});
