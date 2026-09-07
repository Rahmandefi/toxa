import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only mount of the prover API. The handler itself lives in worker/api.js so
 * `npm run prover` serves byte-identical routes to a deployed frontend.
 */
function provePlugin(env) {
  return {
    name: 'toxascore-prove-api',
    configureServer(server) {
      Object.assign(process.env, env);
      if (!process.env.SEPOLIA_RPC_URL && env.VITE_SEPOLIA_RPC) {
        process.env.SEPOLIA_RPC_URL = env.VITE_SEPOLIA_RPC;
      }
      server.middlewares.use(async (req, res, next) => {
        try {
          const { handleApiRequest } = await import('./worker/api.js');
          if (await handleApiRequest(req, res)) return;
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: err.message || 'api error' }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [react(), provePlugin(env)],
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
  };
});
