const { expect } = require('chai');
const { outputList } = require('./list.cjs');

describe('List Output', () => {
  const config = {
    library: {
      tags: [
        { id: 'TPE1', name: 'artist' },
        { id: 'TIT2', name: 'title' },
        { id: 'TALB', name: 'album' }
      ]
    },
    views: {
      list: { tags: [{ name: 'title' }, { name: 'rating' }, { name: 'artist' }] }
    }
  };

  const metadata = { rating: '4.5', artist: 'Artist 1', title: 'Title 1', album: 'Album 1' };

  it('should only include tags listed in views.list.tags, in view order', () => {
    const output = outputList([metadata], config);
    expect(Object.keys(output)).to.deep.equal(['title', 'rating', 'artist']);
  });

  it('should return a list for each file when multiple files provided', () => {
    const output = outputList([metadata, { ...metadata, title: 'Title 2' }], config);
    expect(output).to.be.an('array').of.length(2);
    expect(output[1]).to.deep.equal({ title: 'Title 2', rating: '4.5', artist: 'Artist 1' });
  });

  it('should skip view tags missing from file metadata', () => {
    const output = outputList([{ title: 'Title 1' }], config);
    expect(output).to.deep.equal({ title: 'Title 1' });
  });
});
