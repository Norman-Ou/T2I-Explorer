import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
const execute=promisify(execFile),roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const cli=(args:string[])=>execute(process.execPath,['node_modules/tsx/dist/cli.mjs','src/server/cli.ts',...args]);
it('validates and publishes through the real CLI, rejects duplicate imports and supports explicit replacement',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'t2i-cli-'));roots.push(root);
 expect(JSON.parse((await cli(['validate','fixtures/datasets/sft-e6.0-r30'])).stdout)).toMatchObject({id:'sft-e6.0-r30',experiments:4});
 const args=['import-collection','--from','fixtures/datasets/sft-e6.0-r30','--root',root];expect(JSON.parse((await cli(args)).stdout).target).toBe(path.join(root,'sft-e6.0-r30'));
 await expect(cli(args)).rejects.toMatchObject({code:1});expect(JSON.parse((await cli([...args,'--replace'])).stdout).backup).toBeTruthy();
 await expect(cli(['import-exp','--from','fixtures/datasets/sft-e6.0-r30/tasks/refseg/datasets/sior-t/exps/candidate','--root',root,'--collection','sft-e6.0-r30','--task','refseg','--dataset','missing'])).rejects.toMatchObject({code:1});
});
