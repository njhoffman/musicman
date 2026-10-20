const _ = require('lodash');
const net = require('net');

const BaseClient = require('./BaseClient');
const { argEscape } = require('./utils');

const defaultConnectOpts = {
  host: 'localhost',
  port: 6600
};

function Command(name, args) {
  this.name = name;
  this.args = [].concat(args);
}

Command.prototype.toString = function toString() {
  return [this.name, ...this.args.map(argEscape)].join(' ');
};

// convenience
const cmd = (name, args) => new Command(name, args);

const parseMpdData = msg =>
  _.fromPairs(
    msg
      .split('\n')
      .map(line => line.split(':').map(val => val.trim()))
      .filter(Boolean)
  );

class MpdClient extends BaseClient {
  static connect(options = defaultConnectOpts) {
    const client = new MpdClient();
    client.socket = net.connect(options, () => {
      client.emit('connect');
    });
    client.socket.setEncoding('utf8');
    client.socket.on('data', data => {
      client.receive(data);
    });
    client.socket.on('close', () => {
      client.emit('end');
    });
    client.socket.on('error', err => {
      client.emit('error', err);
    });
    return client;
  }

  constructor() {
    super();
    this.currentState = { song: {}, stats: {}, status: {} };
  }

  // send commands as one command list, resolves when MPD has run all of them
  async sendCommandListAsync(commands) {
    const list = ['command_list_begin', ...commands.map(String), 'command_list_end'].join('\n');
    return new Promise((resolve, reject) => {
      this.sendCommand(list, err => (err ? reject(err) : resolve()));
    });
  }

  async sendCommandAsync(commandName) {
    return new Promise((resolve, reject) => {
      this.sendCommand(cmd(commandName, []), (err, msg) => {
        if (err) {
          return reject(err);
        }
        return resolve(parseMpdData(msg));
      });
    });
  }
}

module.exports = { MpdClient, cmd };
