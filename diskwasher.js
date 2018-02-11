"use strict";
const recursive_readdir = require("recursive-readdir");
const hasha = require("hasha");

async function doDirectory(path){
    // list files
    let files = await recursive_readdir(path);

    let hashes = [];
    for (const x of files){
        hashes.push({
            'filename': x,
            'sha512': await hasha.fromFile(x, {algorithm:"sha512"})
         });
    }

//    // make hashes
//    // this will issue three hundred files
//    let promises = files.map(function(x){

//    });
//    await Promise.all(promises);

//    for (const x of promises){
//        hashes.push(await x);
//    }
    return hashes;
}

function main(){
    let p = doDirectory(process.argv[2]);
    p.then(x => console.log(x));
}
main();
