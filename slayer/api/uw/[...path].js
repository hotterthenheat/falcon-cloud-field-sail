import { proxyUw } from '../../../server/uwProxy.mjs';

export default function handler(req, res) {
  return proxyUw(req, res);
}
