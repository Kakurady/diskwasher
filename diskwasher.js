"use strict";
const recursive_readdir = require("recursive-readdir");
const hasha = require("hasha");

async function doDirectory(path){
    // list files
    // TODO: want a sum of fiile size here. 
    // TODO: I want a progress indicator
    let files = await recursive_readdir(path);

    let hashes = [];
    for (const kv of files.entries()){
        let i = kv[0];
        let x = kv[1];
        hashes.push({
            'filename': x,
            'sha512': await hasha.fromFile(x, {algorithm:"sha512"})
         });
    }

    return hashes;
}

function* join(left, ...right){
    let key = "sha512";
    function* dictGenerator (left){
        for (const x of left){
            yield [x[key], x];
        }
    }

    let dict = new Map(dictGenerator(left));
    
    //FIXME consolidate more than one right
    for (const list of right){
        for (const y of list){
            let x = dict.get(y[key]);
            if (x) {
             yield x;
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
    let hashes = [];
    for (const x of directories){
        let hash = await doDirectory(x);
        console.log(hash);
        hashes.push(hash);
    }

    let joined = [... join(...hashes)];
    console.log(joined);    
}
main();
