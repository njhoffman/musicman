const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Table Output', () => {
  let columnifyStub;
  let tableModule;

  const config = {
    rating: { tag: 'POPM', max: 5 },
    library: {
      tags: [
        { id: 'TPE1', name: 'artist', maxWidth: 20 },
        { id: 'TIT2', name: 'title', maxWidth: 30 },
        { id: 'TALB', name: 'album' }
      ]
    },
    views: {
      table: {
        tags: [{ name: 'title' }, { name: 'rating' }, { name: 'artist', maxWidth: 10 }]
      }
    }
  };

  const metadata = [
    { rating: '4.5', artist: 'Artist 1', title: 'Title 1', album: 'Album 1' },
    { rating: '5.0', artist: 'Artist 2', title: 'Title 2', album: '' }
  ];

  beforeEach(() => {
    columnifyStub = sinon.stub().returns('table');
    tableModule = proxyquire('./table.cjs', { columnify: columnifyStub });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should order columns by views.table.tags', () => {
    tableModule.outputTable(metadata, config);
    const [, { columns }] = columnifyStub.firstCall.args;
    expect(columns).to.deep.equal(['title', 'rating', 'artist']);
  });

  it('should only include tags listed in views.table.tags', () => {
    tableModule.outputTable(metadata, config);
    const [, { columns, config: columnsConfig }] = columnifyStub.firstCall.args;
    expect(columns).to.not.include('album');
    expect(columnsConfig).to.not.have.property('album');
  });

  it('should apply tag definition attributes with view entry overrides', () => {
    tableModule.outputTable(metadata, config);
    const [, { config: columnsConfig }] = columnifyStub.firstCall.args;
    expect(columnsConfig.title.maxWidth).to.equal(30);
    expect(columnsConfig.artist.maxWidth).to.equal(10);
    expect(columnsConfig.rating.align).to.equal('center');
  });

  it('should omit columns that are empty for all files', () => {
    const viewConfig = {
      ...config,
      views: { table: { tags: [{ name: 'album' }, { name: 'title' }] } }
    };
    tableModule.outputTable([{ title: 'Title 1', album: '' }], viewConfig);
    const [, { columns }] = columnifyStub.firstCall.args;
    expect(columns).to.deep.equal(['title']);
  });

  it('should output no columns when views.table is not configured', () => {
    tableModule.outputTable(metadata, { rating: config.rating });
    const [, { columns }] = columnifyStub.firstCall.args;
    expect(columns).to.deep.equal([]);
  });
});
