const filterFunc = require('./filter').filterFiles;
const filesMetadata = require('./filter.spec.data.json');

describe('Metadata Files Filter', async () => {
  describe('Field Filters', () => {
    it('Should only include files that match provided field filter string', async () => {
      const filters = { include: { album: 'Albums!!' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(4);
    });

    it('Should include files that partially match field filter ', async () => {
      const filters = { include: { album: 'Album' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(10);
    });

    it('Should only include files that intersect field matches for multiple filters', async () => {
      const filters = { include: { album: 'Album', title: 'seconds' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(3);
    });

    it('Should include all files that do not match provided negation field filter', async () => {
      const filters = { exclude: { album: 'Albums!' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(11);
    });

    it('Should include all files that intersect non-matches for multiple negation filters', async () => {
      const filters = { exclude: { album: 'Albums!', title: 'silence' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(4);
    });

    it('Should include files that match empty field values', async () => {
      const filters = { include: { album: '' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(4);
    });

    it('Should include files that match multiple empty field values', async () => {
      const filters = { include: { album: '', title: '' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(2);
    });

    it('Should exclude files that match empty negated field values', async () => {
      const filters = { exclude: { title: '' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(14);
    });

    it('Should exclude files that match multiple empty negated field values', async () => {
      const filters = { exclude: { album: '', title: '' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(12);
    });
  });

  describe('Rating Filters', () => {
    it('should only include files with higher rating if provided with a single number', async () => {
      const filters = { rating: { min: '3.5' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(8);

      const filters2 = { rating: { min: '4.5' } };
      const filtered2 = filesMetadata.filter(filterFunc(filters2));
      expect(filtered2).to.have.length(4);
    });

    it('should only include files that exist within range of provided rating', async () => {
      const filters = { rating: { min: '3.5', max: '4' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(2);
    });

    it('Should exclude files that match negation rating single number', async () => {
      const filters = { rating: { min: '3.0', exclude: true } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(6);
    });

    it('Should exclude files that match negation rating range ', async () => {
      const filters = { rating: { min: '3.0', max: '4.5', exclude: true } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(8);
    });

    it('Should include all files that have no rating if filter value is empty', () => {
      const filters = { rating: { min: '' } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(3);
    });

    it('Should exclude all files that have no rating if negated filter value is empty', () => {
      const filters = { rating: { min: '', exclude: true } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(13);
    });
  });

  describe('Array Filters', () => {
    it('Should include files that contain array element match', async () => {
      const filters = { include: { mood: ['Sad', 'Gloomy'] } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(2);
    });

    it('Should only include files that do not contain negated array match elements', async () => {
      const filters = { exclude: { mood: ['Sad', 'Gloomy'] } };
      const filtered = filesMetadata.filter(filterFunc(filters));
      expect(filtered).to.have.length(12);
    });
  });
});
