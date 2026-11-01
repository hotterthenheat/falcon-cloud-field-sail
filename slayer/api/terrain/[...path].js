import { proxyTerrain } from '../../server/terrainApi.mjs';

export default function handler(req, res) {
  return proxyTerrain(req, res);
}
