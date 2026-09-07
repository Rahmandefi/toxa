import { startProof } from '../worker/api.js';
import { cors, readJson } from './_util.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = await readJson(req);
    if (!body.txHash || !String(body.txHash).startsWith('0x')) {
      res.status(400).json({ error: 'txHash required' });
      return;
    }
    res.status(200).json({ id: startProof(body.txHash) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'invalid body' });
  }
}
