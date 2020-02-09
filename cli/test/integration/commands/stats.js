const _ = require('lodash');
const path = require('path');

const statsFunc = require('../../../lib/commands/stats').func;
const { resetSandbox } = require('../../utils');

describe('Stats Command', () => {
  const dirTarget = path.join(process.cwd(), 'test/data/sandbox');

  const config = {
    rating: { tag: 'POPM', max: 5, email: 'fake@email.com' },
    mpd: {
      baseDirectory: dirTarget
    },
    stats: {
      multiFields: ['context', 'mood'],
      filters: [
        { name: 'All Songs > 4.0', filter: 'rating:4.0' },
        { name: 'All Songs > 5.0', filter: 'rating:5.0' },
        { name: 'Upbeat > 4.5', filter: 'rating:4.5 mood:upbeat' },
        { name: 'Total', filter: 'rating:5.0' }
      ]
    },
    tags: [
      {
        id: 'TPE1',
        name: 'artist',
        viewIndex: 1
      },
      {
        id: 'TIT2',
        name: 'title',
        viewIndex: 2
      },
      {
        id: 'TXXX.CustomField',
        name: 'customfield',
        viewIndex: 3
      },
      {
        id: 'TXXX.Mood',
        name: 'mood',
        viewIndex: 4,
        multi: true
      }
    ]
  };

  const options = { switches: {}, filters: {}, assignments: {} };

  beforeEach(function() {
    resetSandbox();
  });

  // it.only('Should run the command', async () => {
  //   const results = await statsFunc({ target: dirTarget, options, config });
  //   // expect(results.split('\n'))
  //   //   .be.an('array')
  //   //   .of.length(6);
  // });
  // it('Should calculate multifield value occurences correctly', () => { });
  // it('Should calculate total from assigned single filter correctly', () => { });
  // it('Should calculate total from assigned multiple filters correctly', () => { });
  // it('Should calculate total with no filters correctly ', () => { });
});
