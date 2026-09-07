import 'dotenv/config';
import { createServer } from 'node:http';
import { handleApiRequest } from './api.js';

/**
 * Standalone Toxa prover + release service.
 *
 * `npm run dev` serves these same routes through Vite middleware, which is fine
 * on a laptop but means a built `dist/` has no prover. Run this next to a static
 * deploy and point the app at it with VITE_PROVER_URL.
 *
 *   npm run prover            # PORT=8787 by default
 *   VITE_PROVER_URL=https://prover.example.com npm run build
 */

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = process.env.CORS_ORIGIN || '*';

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', ORIGIN);
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');

  try {
    if (await handleApiRequest(req, res)) return;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err.message || 'server error' }));
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`Toxa prover listening on :${PORT}`);
  console.log('  POST /api/prove        { txHash }');
  console.log('  GET  /api/prove/:id');
  console.log('  POST /api/release      { address, amount }');
  console.log('  GET  /api/health');
});
