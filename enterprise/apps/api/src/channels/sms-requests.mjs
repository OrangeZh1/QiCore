// Adapted read-only from school-shop SMS request signing.
// Reused from QiSSO server/utils/sms.ts: Aliyun RPC and Tencent TC3 request signing.
import { createHash, createHmac, randomUUID } from 'node:crypto';
function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function hmacBuffer(algorithm, key, value) {
    return createHmac(algorithm, key).update(value, 'utf8').digest();
}
function hmacString(algorithm, key, value, encoding) {
    return createHmac(algorithm, key).update(value, 'utf8').digest(encoding);
}
function tencentPhoneNumber(phoneNumber) {
    return phoneNumber.startsWith('+') ? phoneNumber : `+86${phoneNumber}`;
}
function aliyunPhoneNumber(phoneNumber) {
    return phoneNumber.startsWith('+86') ? phoneNumber.slice(3) : phoneNumber;
}
export function buildTencentSmsRequest(settings, phoneNumber, code, now = new Date()) {
    const service = 'sms';
    const host = 'sms.tencentcloudapi.com';
    const action = 'SendSms';
    const version = '2021-01-11';
    const timestamp = Math.floor(now.getTime() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const body = JSON.stringify({
        PhoneNumberSet: [tencentPhoneNumber(phoneNumber)],
        SmsSdkAppId: settings.appId,
        SignName: settings.signature,
        TemplateId: settings.templateId,
        TemplateParamSet: [code],
    });
    const canonicalHeaders = [
        'content-type:application/json; charset=utf-8',
        `host:${host}`,
        `x-tc-action:${action.toLowerCase()}`,
        '',
    ].join('\n');
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n');
    const secretDate = hmacBuffer('sha256', `TC3${settings.secret}`, date);
    const secretService = hmacBuffer('sha256', secretDate, service);
    const secretSigning = hmacBuffer('sha256', secretService, 'tc3_request');
    const signature = hmacString('sha256', secretSigning, stringToSign, 'hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return {
        url: `https://${host}/`,
        body,
        headers: {
            Authorization: authorization,
            'Content-Type': 'application/json; charset=utf-8',
            Host: host,
            'X-TC-Action': action,
            'X-TC-Region': settings.region,
            'X-TC-Timestamp': String(timestamp),
            'X-TC-Version': version,
        },
    };
}
function aliyunPercentEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function buildAliyunSmsRequest(settings, phoneNumber, code, now = new Date(), nonce = randomUUID()) {
    const parameters = {
        AccessKeyId: settings.accessKeyId,
        Action: 'SendSms',
        Format: 'JSON',
        PhoneNumbers: aliyunPhoneNumber(phoneNumber),
        SignName: settings.signature,
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: nonce,
        SignatureVersion: '1.0',
        TemplateCode: settings.templateId,
        TemplateParam: JSON.stringify({ code }),
        Timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Version: '2017-05-25',
    };
    const canonicalQuery = Object.keys(parameters)
        .sort()
        .map(key => `${aliyunPercentEncode(key)}=${aliyunPercentEncode(parameters[key])}`)
        .join('&');
    const stringToSign = `POST&%2F&${aliyunPercentEncode(canonicalQuery)}`;
    const signature = hmacString('sha1', `${settings.secret}&`, stringToSign, 'base64');
    const body = new URLSearchParams({ ...parameters, Signature: signature }).toString();
    return {
        url: 'https://dysmsapi.aliyuncs.com/',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    };
}
