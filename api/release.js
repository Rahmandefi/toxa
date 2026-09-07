import { signRelease } from '../worker/api.js';
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
    res.status(200).json(await signRelease(body));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'release failed' });
  }
}
