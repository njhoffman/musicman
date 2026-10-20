const net = require('net');

/**
 * Minimal MPD server for tests: greets, answers idle/noidle and commands with OK, answers command
 * lists once at command_list_end, and records every command it receives (except idle/noidle).
 */
const startFakeMpd = async () => {
  const commands = [];
  const server = net.createServer(socket => {
    let buffer = '';
    let inList = false;
    socket.write('OK MPD 0.23.5\n');
    socket.on('data', data => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(line => {
        if (line === 'idle') {
          return;
        }
        if (line === 'noidle') {
          socket.write('OK\n');
          return;
        }
        if (line === 'command_list_begin') {
          inList = true;
          return;
        }
        if (line === 'command_list_end') {
          inList = false;
          socket.write('OK\n');
          return;
        }
        commands.push(line);
        if (!inList) {
          socket.write('OK\n');
        }
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    commands,
    config: { host: '127.0.0.1', port: server.address().port },
    close: () => new Promise(resolve => server.close(resolve))
  };
};

module.exports = { startFakeMpd };
