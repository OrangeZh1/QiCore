import * as applications from './service.mjs';
import * as registry from './registry.mjs';
import * as profiles from './consumer-profiles.mjs';
import * as errors from '../core/errors.mjs';
import * as finance from '../core/financial-records.mjs';
import * as decoration from '../core/decoration-contract.mjs';
import * as wallet from '../core/wallet.mjs';
import * as images from '../core/account-image.mjs';
import * as growth from '../core/member-purchase-growth.mjs';
import * as consumers from '../core/consumer-lifecycle.mjs';
import * as members from '../core/member-management.mjs';
import * as benefits from '../core/member-benefits.mjs';
import * as transactions from '../core/transaction-errors.mjs';
import * as providers from '../storage/providers.mjs';
import {validateDecoration} from '../core/tenant-decoration.mjs';
import {currentDecorationState} from '../core/decoration-state.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const api=Object.freeze({...applications,...registry,...profiles,...errors,...finance,...decoration,...wallet,...images,...growth,...consumers,...members,...benefits,...transactions,...providers,validateDecoration,currentDecorationState});

// Borrow the exact host modules: licensing WeakMaps, transaction helpers and
// payment/asset rules must never be copied into an independently loaded app.
export const serverSdk=Object.freeze({version:1,apiVersion:'1.0',api,modules:Object.freeze({
 'applications/service.mjs':applications,'applications/registry.mjs':registry,
 'applications/consumer-profiles.mjs':profiles,'core/errors.mjs':errors,
 'core/financial-records.mjs':finance,'core/decoration-contract.mjs':decoration,
 'core/wallet.mjs':wallet,'core/account-image.mjs':images,
 'core/member-purchase-growth.mjs':growth,'core/consumer-lifecycle.mjs':consumers,
 'core/member-management.mjs':members,'core/member-benefits.mjs':benefits,
 'core/transaction-errors.mjs':transactions,'storage/providers.mjs':providers,
 '@prisma/client':require('@prisma/client'),zod:require('zod'),sharp:require('sharp')
})});
