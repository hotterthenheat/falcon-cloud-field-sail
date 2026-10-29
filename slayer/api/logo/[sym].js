import { proxyLogo } from '../../server/logoProxy.mjs';

export default function handler(req, res) {
  return proxyLogo(req, res);
}
