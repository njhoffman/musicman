const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('MPD Client', () => {
  let mockMpdClient;
  let mpdModule;

  beforeEach(() => {
    mockMpdClient = {
      on: sinon.stub(),
      sendCommandAsync: sinon.stub()
    };

    mpdModule = proxyquire('./mpd.cjs', {
      '../../../common/mpd/MpdClient': {
        MpdClient: {
          connect: sinon.stub().returns(mockMpdClient)
        }
      }
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('connectMpd', () => {
    it('should resolve when MPD connection is ready', async () => {
      const connectPromise = mpdModule.connectMpd({ port: 6600, host: 'localhost' });

      // Simulate ready event
      const readyCallback = mockMpdClient.on.withArgs('ready').firstCall.args[1];
      readyCallback();

      const client = await connectPromise;
      expect(client).to.equal(mockMpdClient);
    });

    it('should reject when MPD connection fails', async () => {
      const connectPromise = mpdModule.connectMpd({ port: 6600, host: 'localhost' });

      // Simulate error event
      const errorCallback = mockMpdClient.on.withArgs('error').firstCall.args[1];
      const testError = new Error('Connection failed');
      errorCallback(testError);

      try {
        await connectPromise;
        expect.fail('Should have rejected');
      } catch (err) {
        expect(err.message).to.equal('Connection failed');
      }
    });
  });

  describe('getCurrentSong', () => {
    it('should return current song when playing', async () => {
      const mockSong = { file: 'test.mp3', artist: 'Test Artist' };
      const mockStatus = { state: 'play' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.deep.equal(mockSong);
    });

    it('should return false when not playing', async () => {
      const mockSong = { file: 'test.mp3' };
      const mockStatus = { state: 'pause' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.be.false;
    });

    it('should return false when stopped', async () => {
      const mockSong = {};
      const mockStatus = { state: 'stop' };

      mockMpdClient.sendCommandAsync
        .withArgs('currentsong')
        .resolves(mockSong)
        .withArgs('status')
        .resolves(mockStatus);

      const result = await mpdModule.getCurrentSong(mockMpdClient);
      expect(result).to.be.false;
    });
  });
});
