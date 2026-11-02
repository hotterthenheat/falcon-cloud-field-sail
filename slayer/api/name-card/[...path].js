import { proxyNameCard } from '../../server/nameCard.mjs';

export default function handler(req, res) {
  return proxyNameCard(req, res);
}
