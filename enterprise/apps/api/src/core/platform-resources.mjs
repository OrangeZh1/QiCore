import {PrismaClient} from '@prisma/client';
import {mkdir} from 'node:fs/promises';
import {PlatformStorage} from '../storage/service.mjs';

// The host owns shared resources; business services only borrow them.
export class PlatformResources {
  constructor({db=new PrismaClient(),storage}={}) {
    this.db=db;
    this.storage=storage??new PlatformStorage(db);
  }
  async init() {
    try {
      await mkdir(this.storage.root,{recursive:true});
      await this.db.$connect();
      await this.storage.init();
    } catch(error) {
      await this.db.$disconnect().catch(()=>{});
      throw error;
    }
  }
  async close() { await this.db.$disconnect(); }
}
