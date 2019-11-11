const { EventEmitter } = require('events');
const util = require('util');
const assert = require('assert');
const net = require('net');

const MPD_SENTINEL = /^(OK|ACK|list_OK)(.*)$/m;
const OK_MPD = /^OK MPD /;

function MpdClient() {
  EventEmitter.call(this);

  this.buffer = '';
  this.msgHandlerQueue = [];
  this.idling = false;
}
util.inherits(MpdClient, EventEmitter);

const defaultConnectOpts = {
  host: 'localhost',
  port: 6600
};

MpdClient.connect = function(options) {
  options = options || defaultConnectOpts;

  const client = new MpdClient();
  client.socket = net.connect(options, function() {
    client.emit('connect');
  });
  client.socket.setEncoding('utf8');
  client.socket.on('data', function(data) {
    client.receive(data);
  });
  client.socket.on('close', function() {
    client.emit('end');
  });
  client.socket.on('error', function(err) {
    client.emit('error', err);
  });
  return client;
};

MpdClient.prototype.receive = function(data) {
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
};

MpdClient.prototype.handleMessage = function(err, msg) {
  const handler = this.msgHandlerQueue.shift();
  handler(err, msg);
};

MpdClient.prototype.setupIdling = function() {
  const self = this;
  self.sendWithCallback('idle', function(err, msg) {
    self.handleIdleResultsLoop(err, msg);
  });
  self.idling = true;
  self.emit('ready');
};

MpdClient.prototype.sendCommand = function(command, callback) {
  const self = this;
  callback = callback || noop.bind(this);
  assert.ok(self.idling);
  self.send('noidle\n');
  self.sendWithCallback(command, callback);
  self.sendWithCallback('idle', function(err, msg) {
    self.handleIdleResultsLoop(err, msg);
  });
};

MpdClient.prototype.sendCommands = function(commandList, callback) {
  const fullCmd = `command_list_begin\n${commandList.join('\n')}\ncommand_list_end`;
  this.sendCommand(fullCmd, callback || noop.bind(this));
};

MpdClient.prototype.handleIdleResultsLoop = function(err, msg) {
  const self = this;
  if (err) {
    self.emit('error', err);
    return;
  }
  self.handleIdleResults(msg);
  if (self.msgHandlerQueue.length === 0) {
    self.sendWithCallback('idle', function(err, msg) {
      self.handleIdleResultsLoop(err, msg);
    });
  }
};

MpdClient.prototype.handleIdleResults = function(msg) {
  const self = this;
  msg.split('\n').forEach(function(system) {
    if (system.length > 0) {
      const name = system.substring(9);
      self.emit(`system-${name}`);
      self.emit('system', name);
    }
  });
};

MpdClient.prototype.sendWithCallback = function(cmd, cb) {
  cb = cb || noop.bind(this);
  this.msgHandlerQueue.push(cb);
  this.send(`${cmd}\n`);
};

MpdClient.prototype.send = function(data) {
  this.socket.write(data);
};

function Command(name, args) {
  this.name = name;
  this.args = [].concat(args);
}

Command.prototype.toString = function() {
  return `${this.name} ${this.args.map(argEscape).join(' ')}`;
};

function argEscape(arg) {
  // replace all " with \"
  return `"${arg.toString().replace(/"/g, '\\"')}"`;
}

function noop(err) {
  if (err) this.emit('error', err);
}

// convenience
function cmd(name, args) {
  return new Command(name, args);
}

function parseKeyValueMessage(msg) {
  const result = {};

  msg.split('\n').forEach(function(p) {
    if (p.length === 0) {
      return;
    }
    const keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error(`Could not parse entry "${p}"`);
    }
    result[keyValue[1]] = keyValue[2];
  });
  return result;
}

function parseArrayMessage(msg) {
  const results = [];
  let obj = {};

  msg.split('\n').forEach(function(p) {
    if (p.length === 0) {
      return;
    }
    const keyValue = p.match(/([^ ]+): (.*)/);
    if (keyValue == null) {
      throw new Error(`Could not parse entry "${p}"`);
    }

    if (obj[keyValue[1]] !== undefined) {
      results.push(obj);
      obj = {};
      obj[keyValue[1]] = keyValue[2];
    } else {
      obj[keyValue[1]] = keyValue[2];
    }
  });
  results.push(obj);
  return results;
}

MpdClient.Command = Command;
MpdClient.cmd = cmd;
MpdClient.parseKeyValueMessage = parseKeyValueMessage;
MpdClient.parseArrayMessage = parseArrayMessage;

module.exports = MpdClient;

