const parser = require('../../../lib/parser');
const initUtils = require('../../../lib/utils/');

describe('Command assignment', () => {
  const config = {
    mpd: { baseDirectory: 'testBaseDir' },
    tags: [
      {
        name: 'artist',
        id: 'TPE1'
      },
      {
        name: 'title',
        id: 'TIT2'
      },
      {
        name: 'album',
        id: 'TALB'
      },
      {
        name: 'CustomField1',
        id: 'TXXX.Custom1',
        multi: true
      },
      {
        name: 'CustomField2',
        id: 'TXXX.Custom2',
        multi: true
      },
      {
        name: 'CustomField3',
        id: 'TXXX.Custom3'
      }
    ]
  };

  const utils = initUtils(config);

  it('Should default to view command if no matching arguments provided', () => {
    const test1 = parser({ args: [], config, utils });
    const test2 = parser({ args: ['no', 'matching', 'command'], config, utils });
    expect(test1.command).to.include({ name: 'view' });
    expect(test2.command).to.include({ name: 'view' });
  });

  it('Should default to edit if first argument is a rating number', () => {
    const test1 = parser({ args: ['4', 'other', 'args'], config, utils });
    const test2 = parser({ args: ['4.5'], config, utils });
    expect(test1.command).to.include({ name: 'edit' });
    expect(test2.command).to.include({ name: 'edit' });
  });
});
