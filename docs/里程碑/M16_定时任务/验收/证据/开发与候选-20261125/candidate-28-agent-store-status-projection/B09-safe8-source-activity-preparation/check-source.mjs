import {verifySourceBoundary} from './sources.mjs';import {specs} from '../guards.mjs';console.log(JSON.stringify(await verifySourceBoundary(specs),null,2));
