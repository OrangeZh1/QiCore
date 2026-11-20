import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {normalizeDomain} from '../license/client.js';
import {noLinks} from './native-files.js';

export type BaoTaDeployment={domains:string[];adminPort:number;webRoot:string};

// Read only project metadata. Never read panel accounts, API keys or plugin credentials.
export async function discoverBaoTaDeployment(bootstrapRoot:string,panelRoot='/www/server/panel'):Promise<BaoTaDeployment|null>{
 const root=resolve(bootstrapRoot),bundle=dirname(root);
 const databases=[join(panelRoot,'data/db/site.db'),join(panelRoot,'data/default.db')].filter(existsSync);
 if(!databases.length)return null;
 const {DatabaseSync}=await import('node:sqlite');
 for(const path of databases){
  noLinks(path);
  const db=new DatabaseSync(path,{readOnly:true});
  try{
   if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'").get())continue;
   const columns=db.prepare('PRAGMA table_info(sites)').all().map(row=>row.name);
   if(!['path','project_config','project_type'].every(name=>columns.includes(name)))continue;
   const invalid=db.prepare("SELECT path FROM sites WHERE lower(project_type) IN ('node','nodejs','general','pm2') AND NOT json_valid(project_config)").all();
   if(invalid.some(row=>typeof row.path==='string'&&[root,bundle].includes(resolve(row.path))))throw Error('BAOTA_PROJECT_CONFIG_INVALID');
   const projects=db.prepare(`SELECT path,
    json_extract(project_config,'$.project_cwd') AS cwd,
    json_extract(project_config,'$.project_file') AS entry,
    json_extract(project_config,'$.port') AS port,
    json_extract(project_config,'$.domains') AS domains
    FROM sites WHERE lower(project_type) IN ('node','nodejs','general','pm2') AND json_valid(project_config)`)
    .all().filter(row=>{
     const cwd=typeof row.cwd==='string'?row.cwd:String(row.path);
     if(![root,bundle].includes(resolve(cwd)))return false;
     return !row.entry||typeof row.entry==='string'&&resolve(cwd,row.entry)===join(root,'start.mjs');
    });
   // A supported split database is authoritative; do not resurrect a stale legacy project.
   if(!projects.length)return null;
   if(projects.length!==1)throw Error('BAOTA_PROJECT_AMBIGUOUS');
   const row=projects[0],adminPort=Number(row.port);
   if(!Number.isInteger(adminPort)||adminPort<1024||adminPort>65535)throw Error('BAOTA_PROJECT_PORT_REQUIRED');
   const values=JSON.parse(typeof row.domains==='string'?row.domains:'[]');
   if(!Array.isArray(values))throw Error('BAOTA_PROJECT_DOMAIN_REQUIRED');
   const domains=[...new Set(values.map(value=>{
    if(typeof value!=='string'||!/^([^:/]+)(?::\d+)?$/.test(value))throw Error('BAOTA_PROJECT_DOMAIN_REQUIRED');
    return normalizeDomain(value.split(':')[0]);
   }))];
   if(!domains.length)throw Error('BAOTA_PROJECT_DOMAIN_REQUIRED');
   return {domains,adminPort,webRoot:resolve(String(row.path))};
  }finally{db.close()}
 }
 return null;
}
