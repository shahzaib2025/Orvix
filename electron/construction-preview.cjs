const fs=require('node:fs/promises');
const path=require('node:path');

// Metadata only. The native helper rechecks paths and captures original access
// immediately before activation; this preview never changes permissions.
async function inspectSelection(input,limit=2000) {
    let totalEntries=0;
    const targets=[];
    for(const target of input.targets){
        let entries=0,kind='unknown';
        try{
            const queue=[target];
            while(queue.length){
                const candidate=queue.pop();
                if(++totalEntries>limit)throw Error('Choose a smaller selection (at most 2,000 entries).');
                entries++;
                const stat=await fs.lstat(candidate);
                if(stat.isSymbolicLink() || (await fs.realpath(candidate)).toLowerCase()!==path.win32.resolve(candidate).toLowerCase())throw Error('Links and junctions cannot be protected. Choose the direct work path.');
                if(!stat.isDirectory()&&!stat.isFile())throw Error('Choose an ordinary file or folder.');
                if(stat.isFile()&&stat.nlink>1)throw Error('Hard-linked files cannot be protected because an unselected alias would be affected.');
                if(candidate===target)kind=stat.isDirectory()?'folder':'file';
                if(stat.isDirectory()){
                    for await(const child of await fs.opendir(candidate)){
                        if(queue.length+totalEntries>=limit)throw Error('Choose a smaller selection (at most 2,000 entries).');
                        queue.push(path.join(candidate,child.name));
                    }
                }
            }
            targets.push({path:target,kind,entries,status:'ready'});
        }catch(error){
            const message=error.code==='ENOENT'?'This path no longer exists.':error.code==='EACCES'||error.code==='EPERM'?'Access is unavailable. Unlock this path or choose another one.':error.message;
            targets.push({path:target,kind,entries,status:'unavailable',message});
        }
    }
    return {...input,targets,totalEntries,checkedAt:Date.now(),ready:targets.every(target=>target.status==='ready')};
}
module.exports={inspectSelection};
