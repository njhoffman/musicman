#!/usr/bin/env node
// Installs the musicman-notify systemd user service. It runs the installed build
// ($MUSICMAN_HOME/current, ~/.local/share/musicman/current by default, which every commit publishes),
// never the repo being worked on, since the daemon opens the library database. The Spotify app
// credentials of the shell running this (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
// SPOTIFY_REDIRECT_URI) are written to ~/.config/musicman/spotify.env, readable by you only, for the
// Web API calls of the daemon (continuing a shuffle past the tracks it started); run it again after
// changing them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const serviceName = 'musicman-notify.service';
const credentialNames = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'];

// where the pieces go, under home (and MUSICMAN_HOME for the builds)
const paths = ({ home = os.homedir(), env = process.env } = {}) => {
  const musicmanHome = env.MUSICMAN_HOME || path.join(home, '.local', 'share', 'musicman');
  return {
    unitPath: path.join(home, '.config', 'systemd', 'user', serviceName),
    envFile: path.join(home, '.config', 'musicman', 'spotify.env'),
    daemonPath: path.join(musicmanHome, 'current', 'cli', 'lib', 'notify-daemon.js')
  };
};

// the unit: the node binary running this (systemd user services do not inherit the shell's PATH), the
// daemon of the installed build, and the credentials file when there is one (- : optional)
const unitText = ({ nodePath, daemonPath, envFile }) => `[Unit]
Description=musicman song change notifications
After=mpd.service

[Service]
ExecStart=${nodePath} ${daemonPath}
EnvironmentFile=-${envFile}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

// the credentials file, or null when the environment lacks one of them
const envFileText = env =>
  credentialNames.every(name => env[name])
    ? `${credentialNames.map(name => `${name}=${env[name]}`).join('\n')}\n`
    : null;

const install = ({
  home = os.homedir(),
  env = process.env,
  nodePath = process.execPath,
  run = execFileSync,
  log = console.log
} = {}) => {
  const { unitPath, envFile, daemonPath } = paths({ home, env });
  if (!fs.existsSync(daemonPath)) {
    throw new Error(
      `No installed build at ${daemonPath}: commit (the post-commit hook publishes one) or run scripts/publish-local.sh`
    );
  }
  const credentials = envFileText(env);
  if (credentials) {
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, credentials, { mode: 0o600 });
    // the mode of writeFileSync applies only to a new file
    fs.chmodSync(envFile, 0o600);
    log(`Wrote the Spotify credentials to ${envFile} (readable by you only)`);
  } else {
    log(
      `${credentialNames.join(', ')} are not all set: no ${envFile}, so the daemon cannot use the Spotify Web API`
    );
  }
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(unitPath, unitText({ nodePath, daemonPath, envFile }));
  run('systemctl', ['--user', 'daemon-reload']);
  log(`Installed ${unitPath}, running ${daemonPath}`);
  log(`Start with: systemctl --user enable --now ${serviceName} (or restart it)`);
};

if (require.main === module) {
  try {
    install();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { envFileText, install, paths, unitText };
