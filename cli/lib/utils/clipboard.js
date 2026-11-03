const { spawn } = require('child_process');

// the clipboard program: wl-copy under Wayland, else xclip
const clipboardCommand = (env = process.env) =>
  env.WAYLAND_DISPLAY ? ['wl-copy', []] : ['xclip', ['-selection', 'clipboard']];

/**
 * Puts text on the clipboard. Both programs fork to keep owning the selection after the parent exits,
 * so this waits for the parent's exit, not for its output to close (the fork would hold it open).
 */
const copyText = (text, { spawnProcess = spawn, env = process.env } = {}) => {
  const [bin, args] = clipboardCommand(env);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(bin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', err =>
      reject(err.code === 'ENOENT' ? new Error(`${bin} is not installed, cannot copy`) : err)
    );
    child.on('exit', code =>
      code === 0 ? resolve() : reject(new Error(`${bin} exited with code ${code}`))
    );
    child.stdin.end(String(text));
  });
};

module.exports = { clipboardCommand, copyText };
