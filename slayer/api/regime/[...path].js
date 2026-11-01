import { proxyRegime } from '../../server/regimeApi.mjs';

export default function handler(req, res) {
  return proxyRegime(req, res);
}
