import { proxyTheta } from '../../../server/thetaProxy.mjs';

export default function handler(req, res) {
  return proxyTheta(req, res);
}
