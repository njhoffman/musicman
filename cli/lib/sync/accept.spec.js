const sinon = require('sinon');
const { expect } = require('chai');

const { autoAcceptItems, confirmAutoAccept } = require('./accept.js');

describe('Auto-accept', () => {
  const item = (file, percent) => ({ file, path: file, similarity: { percent } });
  const items = [item('a', 100), item('b', 94), item('c', 95), item('d', 97), item('e', 95)];
  const files = list => list.map(({ file }) => file);

  describe('autoAcceptItems', () => {
    it('should keep items at least threshold similar, least similar first', () => {
      expect(files(autoAcceptItems(items, 95))).to.deep.equal(['c', 'e', 'd', 'a']);
    });

    it('should keep none without a threshold', () => {
      expect(autoAcceptItems(items, undefined)).to.be.empty;
      expect(autoAcceptItems(items, null)).to.be.empty;
    });
  });

  describe('confirmAutoAccept', () => {
    const candidates = autoAcceptItems(items, 95);
    const ask = answers => {
      const confirm = sinon.stub();
      answers.forEach((answer, i) => confirm.onCall(i).resolves(answer));
      return confirm;
    };

    it('should accept every item on yes, without picking', async () => {
      const confirm = ask([true]);
      const pickOut = sinon.stub();
      const result = await confirmAutoAccept({
        items: candidates,
        threshold: 95,
        confirm,
        pickOut
      });
      expect(files(result.accept)).to.deep.equal(['c', 'e', 'd', 'a']);
      expect(result.leftOut).to.be.empty;
      expect(confirm.firstCall.args[0]).to.equal('Accept 4 matches at 95% or more?');
      expect(pickOut.called).to.be.false;
    });

    it('should accept the items not picked to leave out', async () => {
      const confirm = ask([false, true, true]);
      const pickOut = sinon.stub().resolves(['e', 'a']);
      const result = await confirmAutoAccept({
        items: candidates,
        threshold: 95,
        confirm,
        pickOut
      });
      expect(files(result.accept)).to.deep.equal(['c', 'd']);
      expect(files(result.leftOut)).to.deep.equal(['e', 'a']);
      expect(confirm.thirdCall.args[0]).to.equal('Accept 2 matches, leaving 2 in review?');
    });

    it('should accept none when both questions are declined', async () => {
      const result = await confirmAutoAccept({
        items: candidates,
        threshold: 95,
        confirm: ask([false, false]),
        pickOut: sinon.stub()
      });
      expect(result.accept).to.be.empty;
      expect(result.leftOut).to.have.length(4);
    });

    it('should accept none when the last question is declined or everything is left out', async () => {
      const declined = await confirmAutoAccept({
        items: candidates,
        threshold: 95,
        confirm: ask([false, true, false]),
        pickOut: sinon.stub().resolves([])
      });
      expect(declined.accept).to.be.empty;
      const confirm = ask([false, true]);
      const allOut = await confirmAutoAccept({
        items: candidates,
        threshold: 95,
        confirm,
        pickOut: sinon.stub().resolves(['a', 'c', 'd', 'e'])
      });
      expect(allOut.accept).to.be.empty;
      expect(confirm.callCount).to.equal(2);
    });
  });
});
