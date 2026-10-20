const { expect } = require('chai');
const logger = require('./logger.js');

describe('Logger', () => {
  describe('availableWidth', () => {
    let originalColumns;

    beforeEach(() => {
      originalColumns = process.stdout.columns;
    });

    afterEach(() => {
      process.stdout.columns = originalColumns;
      logger.configure({ padding: 1 });
    });

    it('should subtract the configured left padding from terminal columns', () => {
      process.stdout.columns = 80;
      logger.configure({ padding: 3 });
      expect(logger.availableWidth()).to.equal(77);
    });

    it('should be unlimited when output is not a terminal', () => {
      process.stdout.columns = undefined;
      expect(logger.availableWidth()).to.equal(Infinity);
    });
  });
});
