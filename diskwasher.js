"use strict";
const recursive_readdir = require("recursive-readdir");
const hasha = require("hasha");
const path = require("path");
require ("intl-pluralrules");

async function doDirectory(dirpath){
    // list files
    // TODO: want a sum of fiile size here. 
    // TODO: I want a progress indicator
    let files = await recursive_readdir(dirpath);

    let hashes = [];
    for (const kv of files.entries()){
        let i = kv[0];
        let x = kv[1];
        hashes.push({
            'relpath': path.relative(dirpath, x),
            'sha512': await hasha.fromFile(x, {algorithm:"sha512"})
         });
    }

    let dict = new Map();
    let duplicates = new Set();
    
    for (const x of hashes){
        let names = dict.get(x.sha512) || [];
        if (names.length>0) {
            duplicates.add(x.sha512);
        }
        names.push(x.relpath);
        dict.set(x.sha512, names);
    }

    return { hashes, dict, duplicates };
}

function* join(left, ...right){

    
    //FIXME consolidate more than one right
    for (const dir of right){
        for (const kv of dir.dict.entries()){
            let key = kv[0];
            let right_relpaths = kv[1];
            
            let left_relpaths = left.dict.get(key);
            if (left_relpaths){
                yield {key, left: left_relpaths, right: right_relpaths}
            }
        }
    }
}

function* filter(iter, fn){
    for (const x of iter){
        if (fn(x)){
            yield x;
        }
    }
}

async function main(){
    let directories = process.argv.slice(2);
    
    let dirinfo = [];
    for (const directory of directories){
        const dir = await doDirectory(directory);
        dirinfo.push( dir );
        
        if (dir.duplicates.size > 0){
            console.log(`${dir.duplicates.size} duplicates in ${directory}:`);
            for (const dup of dir.duplicates){
                let fnames = dir.dict.get(dup);
                console.log(dup);
                for (const name of fnames){
                    console.log("\t",name);
                }
            }
            console.log("");
        } else {
            console.log(`no duplicates in ${directory}.`)
        }
    }
    let joined = join(...dirinfo);
    let filtered = filter(joined, x=> x.left[0]!=x.right[0]);
    
    let result = [... filtered];
//    let joined = [... filter(join(...hashes), x=>x[0].relpath != x[1].relpath)];
    console.log(`${result.length} files with different paths:`, result);    
    
    // now filter joined with where two files are there
}
main();
