const { expect } = require('chai');
const { mapLimit } = require('./promise.js');

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('mapLimit', () => {
  it('should keep the order of the items when calls finish out of order', async () => {
    const results = await mapLimit(
      [30, 10, 20],
      async (ms, index) => {
        await tick(ms);
        return `${index}:${ms}`;
      },
      3
    );
    expect(results).to.deep.equal(['0:30', '1:10', '2:20']);
  });

  it('should run at most concurrency calls at a time', async () => {
    let running = 0;
    let most = 0;
    await mapLimit(
      [1, 2, 3, 4, 5, 6, 7],
      async () => {
        running += 1;
        most = Math.max(most, running);
        await tick(5);
        running -= 1;
      },
      3
    );
    expect(most).to.equal(3);
  });

  it('should run every call at once without a concurrency', async () => {
    let running = 0;
    let most = 0;
    await mapLimit([1, 2, 3, 4], async () => {
      running += 1;
      most = Math.max(most, running);
      await tick(5);
      running -= 1;
    });
    expect(most).to.equal(4);
  });

  it('should return an empty array for no items', async () => {
    expect(await mapLimit([], async () => 1, 2)).to.deep.equal([]);
  });

  it('should reject with the first error and start no further calls', async () => {
    const started = [];
    let error;
    try {
      await mapLimit(
        [1, 2, 3, 4],
        async item => {
          started.push(item);
          if (item === 2) {
            throw new Error('item 2 failed');
          }
          await tick(5);
        },
        1
      );
    } catch (err) {
      error = err;
    }
    expect(error.message).to.equal('item 2 failed');
    expect(started).to.deep.equal([1, 2]);
  });
});
