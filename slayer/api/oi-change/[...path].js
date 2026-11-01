import { proxyOiChange } from '../../server/oiChangeApi.mjs';

export default function handler(req, res) {
  return proxyOiChange(req, res);
}
