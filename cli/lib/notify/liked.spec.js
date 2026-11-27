const { expect } = require('chai');

const { isHearted, sharedAnswers } = require('./liked.js');

describe('Liked Songs lookup', () => {
  describe('sharedAnswers', () => {
    // a liked(trackId) counting its requests, answering what the test sets
    const counted = (answer = true) => {
      const calls = [];
      const liked = async id => {
        calls.push(id);
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      };
      return { calls, liked };
    };

    it('should ask once for askers of one track, also while the question is on its way', async () => {
      const { calls, liked } = counted(true);
      const ask = sharedAnswers(liked);
      const [first, second] = await Promise.all([ask('a'), ask('a')]);
      expect([first, second, await ask('a')]).to.deep.equal([true, true, true]);
      expect(calls).to.deep.equal(['a']);
    });

    it('should ask again once the answer is older than ttl, or for another track', async () => {
      const clock = { now: 0 };
      const { calls, liked } = counted(false);
      const ask = sharedAnswers(liked, { ttl: 100, now: () => clock.now });
      await ask('a');
      clock.now = 99;
      await ask('a');
      clock.now = 100;
      await ask('a');
      await ask('b');
      await ask('a');
      expect(calls).to.deep.equal(['a', 'a', 'b', 'a']);
    });

    it('should not keep a failure or an answer that is not a yes or no', async () => {
      const failing = counted(new Error('offline'));
      const ask = sharedAnswers(failing.liked);
      await ask('a').catch(() => null);
      let error = null;
      await ask('a').catch(err => (error = err));
      expect(error.message).to.equal('offline');
      expect(failing.calls).to.deep.equal(['a', 'a']);
      const unusable = counted(null);
      const askNull = sharedAnswers(unusable.liked);
      expect(await askNull('a')).to.equal(null);
      await askNull('a');
      expect(unusable.calls).to.deep.equal(['a', 'a']);
    });
  });

  describe('isHearted', () => {
    const tags = { artist: 'A', title: 'T', duration: 1 };

    it('should follow the catalog answer for a track with its own id', () => {
      expect(isHearted({ catalogLiked: true, tags: null })).to.equal(true);
      expect(isHearted({ catalogLiked: false, tags: null, confirmed: true })).to.equal(false);
    });

    it('should use the local likes for a track without an id, else its confirmation', () => {
      const likes = known => ({ has: () => known });
      expect(isHearted({ catalogLiked: false, tags }, likes(true))).to.equal(true);
      expect(isHearted({ catalogLiked: false, tags, confirmed: true }, likes(false))).to.equal(
        false
      );
      expect(isHearted({ catalogLiked: false, tags, confirmed: true }, likes(null))).to.equal(true);
      expect(isHearted({ catalogLiked: false, tags, confirmed: true })).to.equal(true);
      expect(isHearted({ catalogLiked: false, tags, confirmed: false })).to.equal(false);
    });
  });
});
