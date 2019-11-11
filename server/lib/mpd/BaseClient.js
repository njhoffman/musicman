const { EventEmitter } = require('events');
const assert = require('assert');

const MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)$/m;
const OK_MPD = /^OK MPD /;

class BaseClient extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.msgHandlerQueue = [];
    this.idling = false;
  }

  noop(err) {
    if (err) {
      this.emit('error', err);
    }
  }

  sendCommand(command, callback) {
    const self = this;
    assert.ok(self.idling);
    self.send('noidle\n');
    self.sendWithCallback(command, callback || this.noop);
    self.sendWithCallback('idle', (err, msg) => {
      self.handleIdleResultsLoop(err, msg);
    });
  }

  sendWithCallback(cmd, cb) {
    this.msgHandlerQueue.push(cb || this.noop);
    this.send(`${cmd}\n`);
  }

  send(data) {
    this.socket.write(data);
  }

  handleIdleResultsLoop(err, msg) {
    const self = this;
    if (err) {
      self.emit('error', err);
      return;
    }
    self.handleIdleResults(msg);
    if (self.msgHandlerQueue.length === 0) {
      self.sendWithCallback('idle', (cbErr, cbMsg) => {
        self.handleIdleResultsLoop(cbErr, cbMsg);
      });
    }
  }

  handleIdleResults(msg) {
    const self = this;
    msg.split('\n').forEach(function(system) {
      if (system.length > 0) {
        const name = system.substring(9);
        self.emit(`system-${name}`);
        self.emit('system', name);
      }
    });
  }

  receive(data) {
    let m;
    this.buffer += data;
    while ((m = this.buffer.match(MPD_SENTINEL))) {
      const msg = this.buffer.substring(0, m.index);
      const line = m[0];
      const code = m[1];
      const str = m[2];
      if (code === 'ACK') {
        const err = new Error(str);
        this.handleMessage(err);
      } else if (OK_MPD.test(line)) {
        this.setupIdling();
      } else {
        this.handleMessage(null, msg);
      }

      this.buffer = this.buffer.substring(msg.length + line.length + 1);
    }
  }

  handleMessage(err, msg) {
    const handler = this.msgHandlerQueue.shift();
    handler(err, msg);
  }

  setupIdling() {
    const self = this;
    self.sendWithCallback('idle', function(err, msg) {
      self.handleIdleResultsLoop(err, msg);
    });
    self.idling = true;
    self.emit('ready');
  }
}

module.exports = BaseClient;
