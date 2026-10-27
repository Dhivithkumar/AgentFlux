const net = require('net');
const { spawn, execSync } = require('child_process');

function ensurePostgresRunning() {
  try {
    execSync('wsl -d Ubuntu -u root service postgresql status', { stdio: 'ignore' });
  } catch (_) {
    console.log('[PG-Bridge] Starting WSL PostgreSQL service...');
    try {
      execSync('wsl -d Ubuntu -u root service postgresql start', { stdio: 'inherit' });
    } catch (e) {
      console.warn('[PG-Bridge] Failed to start PostgreSQL service:', e.message);
    }
  }
}

ensurePostgresRunning();

const server = net.createServer((client) => {
  client.setKeepAlive(true, 5000);

  const wslProc = spawn('wsl', ['-d', 'Ubuntu', 'nc', '127.0.0.1', '5434'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  client.pipe(wslProc.stdin);
  wslProc.stdout.pipe(client);

  client.on('error', () => {
    try { wslProc.kill(); } catch (_) {}
  });

  wslProc.on('error', () => {
    try { client.destroy(); } catch (_) {}
  });

  client.on('close', () => {
    try { wslProc.kill(); } catch (_) {}
  });

  wslProc.on('close', () => {
    try { client.destroy(); } catch (_) {}
  });
});

server.listen(5432, '127.0.0.1', () => {
  console.log('[PG-Bridge] Ready: 127.0.0.1:5432 is actively bridging to WSL PostgreSQL (5434)');
});

