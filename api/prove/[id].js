import { proofStatus } from '../../worker/api.js';
import { cors } from '../_util.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  try {
    const job = await proofStatus(req.query.id);
    if (!job) {
      res.status(404).json({ error: 'unknown job' });
      return;
    }
    res.status(200).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message || 'proof failed' });
  }
}
