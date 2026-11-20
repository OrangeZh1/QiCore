// Adapted from school-shop payment transport; tenant credentials supplied by payment service.
import { createDecipheriv, createPrivateKey, constants, randomBytes, sign, verify } from 'node:crypto';
import { WechatV2Transport, isV2 } from './wechat-v2.mjs';
export class GatewayError extends Error {
    code;
    status;
    requestId;
    constructor(code, status = 0, requestId = null) {
        super(code);
        this.code = code;
        this.status = status;
        this.requestId = requestId;
    }
}
const encode = (value) => encodeURIComponent(value);
export class WechatTransport {
    clock;
    v2;
    constructor(clock = { now: () => new Date() }) {
        this.clock = clock;
        this.v2 = new WechatV2Transport(clock);
    }
    signMessage(privateKey, message) {
        return sign('RSA-SHA256', Buffer.from(message, 'utf8'), { key: createPrivateKey(privateKey), padding: constants.RSA_PKCS1_PADDING }).toString('base64');
    }
    verifyMessage(raw, headers, keys) {
        const timestamp = headers.get('wechatpay-timestamp') || '', nonce = headers.get('wechatpay-nonce') || '', signature = headers.get('wechatpay-signature') || '';
        const serial = headers.get('wechatpay-serial');
        if (!/^\d{10}$/.test(timestamp) || Math.abs(this.clock.now().getTime() / 1000 - Number(timestamp)) > 300 || !nonce || nonce.length > 64 || /[\r\n]/.test(nonce))
            throw new GatewayError('WECHAT_SIGNATURE_INVALID');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 1024)
            throw new GatewayError('WECHAT_SIGNATURE_INVALID');
        const message = Buffer.from(timestamp + '\n' + nonce + '\n' + raw + '\n', 'utf8');
        if (!keys.some(key => {
            if (isV2(key))
                return false;
            if (key.publicKeyId !== serial)
                return false;
            try {
                return verify('RSA-SHA256', message, { key: key.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signature, 'base64'));
            }
            catch {
                return false;
            }
        }))
            throw new GatewayError('WECHAT_SIGNATURE_INVALID');
    }
    decrypt(resource, config) {
        if (resource.algorithm !== 'AEAD_AES_256_GCM' || typeof resource.nonce !== 'string' || Buffer.byteLength(resource.nonce) !== 12
            || typeof resource.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(resource.ciphertext)
            || resource.associated_data !== undefined && typeof resource.associated_data !== 'string')
            throw new GatewayError('WECHAT_RESOURCE_INVALID');
        const bytes = Buffer.from(resource.ciphertext, 'base64');
        if (bytes.length <= 16)
            throw new GatewayError('WECHAT_RESOURCE_INVALID');
        const cipher = createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key), Buffer.from(resource.nonce));
        cipher.setAuthTag(bytes.subarray(-16));
        cipher.setAAD(Buffer.from(resource.associated_data ?? ''));
        const body = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new GatewayError('WECHAT_RESOURCE_INVALID');
        return body;
    }
    clientParameters(config, prepayId) {
        if (isV2(config))
            return this.v2.clientParameters(config, prepayId);
        const timeStamp = String(Math.floor(this.clock.now().getTime() / 1000)), nonceStr = randomBytes(16).toString('hex'), pkg = 'prepay_id=' + prepayId;
        return { appId: config.appId, timeStamp, nonceStr, package: pkg, signType: 'RSA',
            paySign: this.signMessage(config.privateKey, config.appId + '\n' + timeStamp + '\n' + nonceStr + '\n' + pkg + '\n') };
    }
    async request(config, method, path, payload) {
        const body = payload ? JSON.stringify(payload) : '', timestamp = String(Math.floor(this.clock.now().getTime() / 1000)), nonce = randomBytes(16).toString('hex');
        const signature = this.signMessage(config.privateKey, [method, path, timestamp, nonce, body, ''].join('\n'));
        const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.serialNo}"`;
        let response;
        try {
            response = await fetch('https://api.mch.weixin.qq.com' + path, { method, redirect: 'error', signal: AbortSignal.timeout(8000),
                headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json', 'Wechatpay-Serial': config.publicKeyId }, ...(payload ? { body } : {}) });
        }
        catch {
            throw new GatewayError('WECHAT_NETWORK_UNCONFIRMED');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body || []) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024)
                throw new GatewayError('WECHAT_RESPONSE_TOO_LARGE');
            chunks.push(Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString('utf8'), requestId = response.headers.get('request-id')?.slice(0, 128) || null;
        if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
            throw new GatewayError('WECHAT_RESPONSE_TOO_LARGE', response.status, requestId);
        // Official Java examples verify every 2xx response, including the empty body of HTTP 204.
        const authenticated = response.ok || !!response.headers.get('wechatpay-signature');
        if (authenticated) this.verifyMessage(raw, response.headers, [config, ...(config.trusted || [])]);
        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        }
        catch {
            throw new GatewayError('WECHAT_RESPONSE_INVALID', response.status, requestId);
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new GatewayError('WECHAT_RESPONSE_INVALID', response.status, requestId);
        if (!response.ok)
            throw Object.assign(new GatewayError(typeof data.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(data.code) ? data.code : 'WECHAT_UPSTREAM_ERROR', response.status, requestId), {authenticated});
        return { data, requestId };
    }
    prepay(config, payload) { return isV2(config) ? this.v2.prepay(config, payload) : this.request(config, 'POST', '/v3/pay/transactions/jsapi', payload); }
    prepayH5(config, payload) { if(isV2(config))throw new GatewayError('WECHAT_H5_REQUIRES_V3');return this.request(config,'POST','/v3/pay/transactions/h5',payload); }
    query(config, orderNo) { return isV2(config) ? this.v2.query(config, orderNo) : this.request(config, 'GET', '/v3/pay/transactions/out-trade-no/' + encode(orderNo) + '?mchid=' + encode(config.mchId)); }
    close(config, orderNo) { return isV2(config) ? this.v2.close(config, orderNo) : this.request(config, 'POST', '/v3/pay/transactions/out-trade-no/' + encode(orderNo) + '/close', { mchid: config.mchId }); }
    refund(config, payload) { return isV2(config) ? this.v2.refund(config, payload) : this.request(config, 'POST', '/v3/refund/domestic/refunds', payload); }
    queryRefund(config, refundNo) { return isV2(config) ? this.v2.queryRefund(config, refundNo) : this.request(config, 'GET', '/v3/refund/domestic/refunds/' + encode(refundNo)); }
    noticeV2(kind, raw, configs) { return this.v2.notice(kind, raw, configs); }
}
