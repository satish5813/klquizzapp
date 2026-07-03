// Cluster bootstrap — runs one Node worker per CPU core so all vCPUs are used.
// Node is single-threaded; without this the API would peg ONE core while the others
// sit idle. On the 4-vCPU / 16 GB VPS this lets the API handle thousands of
// concurrent students. Each worker runs the full app (server/index.js) and they
// share the same listening port (the OS load-balances connections across them).
//
// Tuning:
//   WEB_CONCURRENCY  number of workers (default: CPU cores - 1, min 2).
//                    Leave 1 core for MySQL when the DB is on the same VPS.
//   Set WEB_CONCURRENCY=1 to disable clustering (e.g. for local dev / debugging).
import cluster from 'node:cluster';
import os from 'node:os';

const CORES = os.cpus().length || 4;
const WORKERS = Math.max(1, Number(process.env.WEB_CONCURRENCY) || Math.max(2, CORES - 1));

if (WORKERS <= 1) {
  // Single process — just run the app directly (no cluster overhead).
  await import('./index.js');
} else if (cluster.isPrimary) {
  console.log(`[cluster] primary ${process.pid} starting ${WORKERS} workers (of ${CORES} cores)`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  // Auto-restart a worker if it dies, so one crash never takes the exam down.
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} died (${signal || code}); restarting`);
    cluster.fork();
  });
} else {
  await import('./index.js');
}
