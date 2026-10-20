import { readFileSync } from 'node:fs';
import { fromGraphQL } from '../src/github.js';
export const raw = () => fromGraphQL(JSON.parse(readFileSync(new URL('../fixtures/map.json', import.meta.url), 'utf8')));
