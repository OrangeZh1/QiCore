// The parent starts this fixture under actual flock, then SIGKILLs its process group.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [modulePath,inputFile,phase]=process.argv.slice(2),input=JSON.parse(await readFile(inputFile,'utf8'));
const {transitionBootstrap}=await import(pathToFileURL(modulePath).href);
const checkpoint=async()=>{process.stdout.write('TRANSITION_CRASH_CHECKPOINT\n');await new Promise(()=>{setInterval(()=>{},1000)})};
if(!['staging','renamed'].includes(phase))throw Error('INVALID_TEST_PHASE');
await transitionBootstrap('apply',input,phase==='staging'?{beforeCopy:async path=>{
 await mkdir(path);await writeFile(join(path,'start.mjs'),(await readFile(join(input.candidateRoot,'start.mjs'))).subarray(0,16));await checkpoint();
}}:{afterOldMoved:checkpoint});
