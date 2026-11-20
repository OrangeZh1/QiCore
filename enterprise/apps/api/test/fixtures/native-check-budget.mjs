export function nativeCheckTimeout(env=process.env){
 const value=env.QICORE_NATIVE_CHECK_TIMEOUT_MS===undefined?600000:Number(env.QICORE_NATIVE_CHECK_TIMEOUT_MS);
 if(!Number.isSafeInteger(value)||value<600000||value>1800000)throw Error('QICORE_NATIVE_CHECK_TIMEOUT_MS must be an integer from 600000 to 1800000');
 return value;
}
