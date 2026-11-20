// Adapted from school-shop: strict XML, signed V2 responses and mTLS refunds.
import { createHash, createHmac, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { networkInterfaces } from 'node:os';
import { GatewayError } from './wechat-transport.mjs';
function invalid(code = 'WECHAT_V2_RESPONSE_INVALID') { throw new GatewayError(code); }
export const isV2 = (config) => config.apiVersion === 'V2';
export const isXmlNotice = (raw) => /^\s*</.test(raw.toString('utf8'));
export const v2Acknowledgement = (success) => '<xml><return_code>' + (success ? 'SUCCESS' : 'FAIL') + '</return_code><return_msg>' + (success ? 'OK' : 'NOT_ACCEPTED') + '</return_msg></xml>';
// V2 uses a flat XML map. Reject DTDs, attributes, nesting, duplicate keys and unknown entities.
export function parseV2Xml(raw) {
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw))
        invalid('WECHAT_V2_XML_INVALID');
    const xml = raw.trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i, '');
    const root = /^<xml>\s*([\s\S]*?)\s*<\/xml>$/.exec(xml) || /^<root>\s*([\s\S]*?)\s*<\/root>$/.exec(xml);
    if (!root)
        invalid('WECHAT_V2_XML_INVALID');
    const result = Object.create(null), pattern = /\s*<([A-Za-z_][A-Za-z0-9_]*)>(<!\[CDATA\[[\s\S]*?\]\]>|[^<]*)<\/\1>\s*/gy;
    let offset = 0, count = 0;
    while (offset < root[1].length) {
        pattern.lastIndex = offset;
        const match = pattern.exec(root[1]);
        if (!match || ++count > 512 || Object.hasOwn(result, match[1]) || ['__proto__', 'constructor', 'prototype'].includes(match[1]))
            invalid('WECHAT_V2_XML_INVALID');
        const text = match[2];
        const value = text.startsWith('<![CDATA[') ? text.slice(9, -3) : text.replace(/&([^;]*);|&/g, (_all, entity) => {
            const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
            if (Object.hasOwn(known, entity))
                return known[entity];
            if (!/^#(?:\d+|x[0-9a-fA-F]+)$/.test(entity || ''))
                return invalid('WECHAT_V2_XML_INVALID');
            const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
            if (!Number.isInteger(code) || code < 32 && ![9, 10, 13].includes(code) || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff)
                return invalid('WECHAT_V2_XML_INVALID');
            return String.fromCodePoint(code);
        });
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
            invalid('WECHAT_V2_XML_INVALID');
        result[match[1]] = value;
        offset = pattern.lastIndex;
    }
    return result;
}
export function v2Xml(fields) {
    const escape = (value) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
    return '<xml>' + Object.entries(fields).map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
            invalid('WECHAT_V2_REQUEST_INVALID');
        return '<' + key + '>' + escape(value) + '</' + key + '>';
    }).join('') + '</xml>';
}
export function signV2(fields, key, algorithm = fields.sign_type || 'MD5') {
    if (!['MD5', 'HMAC-SHA256'].includes(algorithm) || Buffer.byteLength(key) !== 32)
        invalid('WECHAT_V2_SIGNATURE_INVALID');
    const text = Object.keys(fields).filter(name => name !== 'sign' && fields[name] !== '').sort().map(name => name + '=' + fields[name]).join('&') + '&key=' + key;
    return (algorithm === 'MD5' ? createHash('md5').update(text) : createHmac('sha256', key).update(text)).digest('hex').toUpperCase();
}
export function verifyV2(fields, key, algorithm = fields.sign_type || 'MD5') {
    const expected = signV2(fields, key, algorithm), received = fields.sign || '';
    if (!/^[A-Fa-f0-9]+$/.test(received) || received.length !== expected.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(received.toUpperCase())))
        invalid('WECHAT_V2_SIGNATURE_INVALID');
}
const cents = (value) => { if (!/^(0|[1-9]\d*)$/.test(value || '') || !Number.isSafeInteger(Number(value)))
    return invalid(); return Number(value); };
const chinaTime = (value) => {
    const text = /^\d{14}$/.test(value || '') ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12)}+08:00`
        : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value || '') ? value.replace(' ', 'T') + '+08:00' : '';
    if (!text || !Number.isFinite(Date.parse(text)))
        return invalid();
    return text;
};
export function v2Transaction(data, notification = false) {
    const state = notification ? 'SUCCESS' : data.trade_state;
    if (!['SUCCESS', 'REFUND', 'NOTPAY', 'CLOSED', 'REVOKED', 'USERPAYING', 'PAYERROR'].includes(state))
        invalid();
    return { mchid: data.mch_id, appid: data.appid, out_trade_no: data.out_trade_no, trade_state: state,
        ...(state === 'SUCCESS' ? { transaction_id: data.transaction_id, trade_type: data.trade_type, success_time: chinaTime(data.time_end), payer: { openid: data.openid },
            amount: { total: cents(data.total_fee), payer_total: cents(data.cash_fee), currency: data.fee_type || 'CNY', payer_currency: data.cash_fee_type || 'CNY' } } : {}) };
}
const refundStates = { SUCCESS: 'SUCCESS', REFUNDCLOSE: 'CLOSED', PROCESSING: 'PROCESSING', CHANGE: 'ABNORMAL' };
export function v2Refund(data, refundNo) {
    const count = cents(data.refund_count);
    if (!count || count > 50)
        invalid();
    const indices = Array.from({ length: count }, (_, i) => i).filter(i => data['out_refund_no_' + i] === refundNo);
    if (indices.length !== 1)
        invalid('WECHAT_REFUND_IDENTITY_MISMATCH');
    const n = indices[0], state = refundStates[data['refund_status_' + n]];
    if (!state)
        invalid();
    return { mchid: data.mch_id, appid: data.appid, out_trade_no: data.out_trade_no, transaction_id: data.transaction_id, out_refund_no: refundNo,
        refund_id: data['refund_id_' + n], status: state, refund_status: state,
        ...(state === 'SUCCESS' ? { success_time: chinaTime(data['refund_success_time_' + n]) } : {}),
        amount: { total: cents(data.total_fee), refund: cents(data['refund_fee_' + n]), payer_total: cents(data.cash_fee), payer_refund: cents(data['cash_refund_fee_' + n]), currency: data.fee_type || 'CNY' } };
}
export class WechatV2Transport {
    clock;
    constructor(clock) {
        this.clock = clock;
    }
    clientParameters(config, prepayId) {
        const value = { appId: config.appId, timeStamp: String(Math.floor(this.clock.now().getTime() / 1000)), nonceStr: randomBytes(16).toString('hex'), package: 'prepay_id=' + prepayId, signType: 'HMAC-SHA256' };
        return { ...value, paySign: signV2(value, config.apiV2Key, value.signType) };
    }
    // HTTPS is also used for V2 so refund requests can attach the merchant certificate and private key.
    exchange(config, path, body, certificate = false, maxBytes = 2 * 1024 * 1024) {
        return new Promise((resolve, reject) => {
            const req = httpsRequest({ hostname: 'api.mch.weixin.qq.com', port: 443, path, method: 'POST', minVersion: 'TLSv1.2', rejectUnauthorized: true,
                ...(certificate ? { cert: config.merchantCertificate, key: config.privateKey } : {}),
                headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
            }, response => {
                const chunks = [];
                let size = 0;
                response.on('data', chunk => { size += chunk.length; if (size > maxBytes)
                    req.destroy(new GatewayError('WECHAT_RESPONSE_TOO_LARGE'));
                else
                    chunks.push(Buffer.from(chunk)); });
                response.on('error', reject);
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        reject(new GatewayError('WECHAT_UPSTREAM_ERROR', response.statusCode));
                        return;
                    }
                    const id = response.headers['request-id'];
                    resolve({ bytes: Buffer.concat(chunks), requestId: typeof id === 'string' ? id.slice(0, 128) : null });
                });
            });
            const timer = setTimeout(() => req.destroy(new GatewayError('WECHAT_NETWORK_UNCONFIRMED')), 8000);
            req.on('close', () => clearTimeout(timer));
            req.on('error', error => reject(error instanceof GatewayError ? error : new GatewayError('WECHAT_NETWORK_UNCONFIRMED')));
            req.end(body);
        });
    }
    signed(config, payload) {
        const data = { ...payload, appid: config.appId, mch_id: config.mchId, nonce_str: randomBytes(16).toString('hex'), sign_type: 'HMAC-SHA256' };
        return v2Xml({ ...data, sign: signV2(data, config.apiV2Key) });
    }
    decode(config, bytes) {
        const data = parseV2Xml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (data.return_code !== 'SUCCESS')
            invalid('WECHAT_V2_COMMUNICATION_FAILED');
        verifyV2(data, config.apiV2Key, data.sign_type || 'HMAC-SHA256');
        if (data.mch_id !== config.mchId || data.appid !== config.appId)
            invalid('WECHAT_RESPONSE_IDENTITY_MISMATCH');
        if (data.result_code !== 'SUCCESS') {
            const codes = { ORDERNOTEXIST: 'ORDER_NOT_EXIST', REFUNDNOTEXIST: 'RESOURCE_NOT_EXISTS', ORDERCLOSED: 'ORDER_CLOSED' };
            throw Object.assign(new GatewayError(codes[data.err_code] || (/^[A-Z0-9_]{1,64}$/.test(data.err_code || '') ? data.err_code : 'WECHAT_UPSTREAM_ERROR')), {authenticated:true});
        }
        return data;
    }
    async request(config, path, payload, certificate = false) {
        const response = await this.exchange(config, path, this.signed(config, payload), certificate);
        return { data: this.decode(config, response.bytes), requestId: response.requestId };
    }
    async prepay(config, value) {
        let body = '';
        for (const char of String(value.description)) {
            if (Buffer.byteLength(body + char) > 128)
                break;
            body += char;
        }
        const ip = Object.values(networkInterfaces()).flat().find(item => item && !item.internal && item.family === 'IPv4')?.address;
        if (!ip || !Number.isSafeInteger(value.amount?.total) || value.amount.total <= 0 || value.amount.currency !== 'CNY')
            invalid('WECHAT_V2_REQUEST_INVALID');
        const expiry = new Date(value.time_expire);
        if (!Number.isFinite(expiry.getTime()))
            invalid('WECHAT_V2_REQUEST_INVALID');
        const response = await this.request(config, '/pay/unifiedorder', { body, out_trade_no: value.out_trade_no, total_fee: String(value.amount.total), fee_type: 'CNY',
            spbill_create_ip: ip, time_expire: new Date(expiry.getTime() + 28800000).toISOString().slice(0, 19).replace(/[-:T]/g, ''), notify_url: value.notify_url, trade_type: 'JSAPI', openid: value.payer.openid });
        if (response.data.trade_type !== 'JSAPI')
            invalid();
        return response;
    }
    async query(config, orderNo) {
        const response = await this.request(config, '/pay/orderquery', { out_trade_no: orderNo });
        if (response.data.out_trade_no !== orderNo)
            invalid('WECHAT_RESPONSE_IDENTITY_MISMATCH');
        return { ...response, data: v2Transaction(response.data) };
    }
    async close(config, orderNo) {
        try {
            return await this.request(config, '/pay/closeorder', { out_trade_no: orderNo });
        }
        catch (error) {
            if (error instanceof GatewayError && error.code === 'ORDER_CLOSED')
                return { data: {}, requestId: error.requestId };
            throw error;
        }
    }
    async refund(config, value) {
        if (!config.merchantCertificate || !config.privateKey || !Number.isSafeInteger(value.amount?.refund) || value.amount.refund <= 0 || !Number.isSafeInteger(value.amount.total) || value.amount.refund > value.amount.total)
            invalid('WECHAT_V2_REQUEST_INVALID');
        const response = await this.request(config, '/secapi/pay/refund', { ...(value.transaction_id ? { transaction_id: value.transaction_id } : { out_trade_no: value.out_trade_no }),
            out_refund_no: value.out_refund_no, total_fee: String(value.amount.total), refund_fee: String(value.amount.refund), refund_fee_type: 'CNY', refund_desc: value.reason || '', notify_url: value.notify_url }, true);
        if (response.data.out_refund_no !== value.out_refund_no)
            invalid('WECHAT_REFUND_IDENTITY_MISMATCH');
        // Acceptance is not success. A signed query supplies the actual cash amounts and current state.
        return this.queryRefund(config, value.out_refund_no);
    }
    async queryRefund(config, refundNo) {
        const response = await this.request(config, '/pay/refundquery', { out_refund_no: refundNo });
        return { ...response, data: v2Refund(response.data, refundNo) };
    }
    async notice(kind, raw, configs) {
        const fields = parseV2Xml(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (fields.return_code !== 'SUCCESS')
            invalid('WECHAT_V2_NOTICE_INVALID');
        const keys = configs.filter(key => isV2(key) && key.mchId === fields.mch_id && key.appId === fields.appid);
        let data;
        if (kind === 'PAYMENT') {
            if (fields.result_code !== 'SUCCESS' || !keys.some(key => { try {
                verifyV2(fields, key.apiV2Key);
                return true;
            }
            catch {
                return false;
            } }))
                invalid('WECHAT_V2_SIGNATURE_INVALID');
            data = v2Transaction(fields, true);
        }
        else {
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fields.req_info || ''))
                invalid('WECHAT_V2_NOTICE_INVALID');
            let decoded;
            for (const key of keys) {
                try {
                    const cipher = createDecipheriv('aes-256-ecb', Buffer.from(createHash('md5').update(key.apiV2Key).digest('hex')), null);
                    decoded = parseV2Xml(Buffer.concat([cipher.update(Buffer.from(fields.req_info, 'base64')), cipher.final()]).toString('utf8'));
                    break;
                }
                catch { /* Key rotation: try the retained version. */ }
            }
            if (!decoded || !/^[A-Za-z0-9_|*@-]{1,64}$/.test(decoded.out_refund_no || ''))
                invalid('WECHAT_V2_NOTICE_INVALID');
            // V2 ECB has no authentication tag. Do not settle from decrypted XML alone.
            for (const key of keys) {
                try {
                    const response = await this.queryRefund(key, decoded.out_refund_no);
                    data = response.data;
                    break;
                }
                catch (error) {
                    if (!(error instanceof GatewayError) || !['SIGNERROR', 'WECHAT_V2_SIGNATURE_INVALID', 'WECHAT_V2_COMMUNICATION_FAILED'].includes(error.code))
                        throw error;
                }
            }
            if (!data || data.out_trade_no !== decoded.out_trade_no || data.transaction_id !== decoded.transaction_id || data.refund_id !== decoded.refund_id)
                invalid('WECHAT_V2_NOTICE_INVALID');
        }
        const event_type = kind === 'PAYMENT' ? 'TRANSACTION.SUCCESS' : 'REFUND.' + data.refund_status;
        const id = createHash('sha256').update('V2:' + kind + ':' + fields.mch_id + ':' + (kind === 'PAYMENT' ? data.transaction_id : data.refund_id + ':' + data.refund_status)).digest('hex');
        return { notice: { id, event_type }, data };
    }
}
