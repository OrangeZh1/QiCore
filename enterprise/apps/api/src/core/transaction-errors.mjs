import {randomInt} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function isRetryableTransactionError(error){
 return ['P2034','P2002'].includes(error?.code)
  || error?.code==='P2010'&&String(error.meta?.code)==='1213';
}

// Let the surviving transaction release its locks before another bounded attempt.
export const waitForTransactionRetry=attempt=>delay(25*2**attempt+randomInt(25));
