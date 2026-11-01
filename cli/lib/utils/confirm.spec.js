const { expect } = require('chai');
const sinon = require('sinon');
const { confirm } = require('./confirm.js');

describe('confirm', () => {
  it('should ask with the message and default to no', async () => {
    const prompt = sinon.stub().resolves(true);
    expect(await confirm('Proceed?', { prompt })).to.equal(true);
    expect(prompt).to.have.been.calledOnceWith({ message: 'Proceed?', default: false });
  });

  it('should return the answer no', async () => {
    const prompt = sinon.stub().resolves(false);
    expect(await confirm('Proceed?', { prompt })).to.equal(false);
  });

  it('should answer no when the prompt is cancelled', async () => {
    const cancelled = Object.assign(new Error('User force closed the prompt'), {
      name: 'ExitPromptError'
    });
    const prompt = sinon.stub().rejects(cancelled);
    expect(await confirm('Proceed?', { prompt })).to.equal(false);
  });

  it('should rethrow other errors', async () => {
    const prompt = sinon.stub().rejects(new Error('broken terminal'));
    let error;
    try {
      await confirm('Proceed?', { prompt });
    } catch (err) {
      error = err;
    }
    expect(error.message).to.equal('broken terminal');
  });
});
