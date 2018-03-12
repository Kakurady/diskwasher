"use strict";
const recursive_readdir = require("recursive-readdir");
const hasha = require("hasha");
const path = require("path");
require ("intl-pluralrules");
const ConsoleUI = require ("./console-ui");

/** @typedef {string} HashType */

class DWFile{
    constructor(obj){
        /** @type {string} */
        this.relpath = obj.relpath;
        /** @type {number} */
        this.size = obj.size;
        /** @type {any} */
        this.mtime = obj.mtime;
        /**
         * @type {HashType}
         */
        this.sha512 = obj.sha512;
    }
}

class DWDirInfo{
    constructor(obj){
        /** @type {string} */
        this.root = obj.root;
        /** @type {DWFile[]} */
        this.files = obj.files;
        /** @type {Map<HashType, string[]>} */
        this.digestIndex = obj.digestIndex;
        /** @type {Set<HashType>} */
        this.dupsByDigest = obj.dupsByDigest;
    }
}
/**
 * // list files, digest files, build map of hash and list of duplicates
 * @param {string} dirpath 
 * @param {*} onProgress 
 */
async function doDirectory(dirpath, onProgress){
    // step 1: list files under the directory.
    // TODO: I want a progress indicator while reading
    // TODO: want file size for each file, so I can display a progress for large files. 
    let filenames = await recursive_readdir(dirpath);


    let files = filenames.map(function (filename) {
        return new DWFile({
            'relpath': path.relative(dirpath, filename),
            'size': null,
            'mtime': null,
            'sha512': null
        });
        /*  TODO: rewrite object literal with class/instance,
            so when adding type annotations to functions for VS Code
            to pick up, I don't have to repeat myself. */
    });

    // build a dictionary of sha512 -> array of files with that digest.
    // we can build a list of files with the same digest at the same time.
    let digestIndex = new Map();
    let dupsByDigest = new Set();


    return new DWDirInfo({ root: dirpath, files, digestIndex, dupsByDigest });
}

/**
 * 
 * @param {DWDirInfo} dirInfo 
 * @param {*} onProgress 
 */
async function digestDirectory(dirInfo, onProgress){
    let files = dirInfo.files;
    let dirpath = dirInfo.root;

    // step 2: read each file and compute a sha512 digest.
    for (const kv of files.entries()){
        let i = kv[0];
        let file = kv[1];
        // TODO: if displaying megabytes, display the current file name so small files don't look it's stuck.
        onProgress({current:i, currentMax: files.length, total: i, totalMax: files.length});

        const fullpath = path.join(dirpath, file.relpath);
        file.sha512 = await hasha.fromFile(fullpath, {algorithm:"sha512"});
    }
}

/**
 * 
 * @param {DWDirInfo} dirInfo 
 */
function buildDigestIndex(dirInfo){
    let files = dirInfo.files;
    let digestIndex = dirInfo.digestIndex;
    let dupsByDigest = dirInfo.dupsByDigest;

    for (const kv of files.entries()){
        let i = kv[0];
        let x = kv[1];

        let names = digestIndex.get(x.sha512) || [];
        if (names.length>0) {
            dupsByDigest.add(x.sha512);
        }
        names.push(x.relpath);
        digestIndex.set(x.sha512, names);
    }
}

/**
 * 
 * @param {DWDirInfo} dirInfo 
 */
function printDuplicates(dirInfo){
    // printing duplicates.
    if (dirInfo.dupsByDigest.size > 0){
        console.log(`${dirInfo.dupsByDigest.size} duplicates in ${dirInfo.root}:`);
        for (const dup of dirInfo.dupsByDigest){
            let fnames = dirInfo.digestIndex.get(dup);
            console.log(dup);
            for (const name of fnames){
                console.log("\t",name);
            }
        }
        console.log("");
    } else {
        console.log(`no duplicates in ${dirInfo.root}.`)
    }
}

/**
 * 
 * @param {DWDirInfo} left 
 * @param {DWDirInfo[]} right 
 */
function* join(left, ...right){

    
    //FIXME consolidate more than one right
    for (const dir of right){
        for (const kv of dir.digestIndex.entries()){
            let key = kv[0];
            let right_relpaths = kv[1];
            
            let left_relpaths = left.digestIndex.get(key);
            if (left_relpaths){
                yield {key, left: left_relpaths, right: right_relpaths}
            }
        }
    }
}

/**
 * 
 * @template T
 * @param {IterableIterator<T>} iter 
 * @param {*} fn 
 */
function* filter(iter, fn){
    for (const x of iter){
        if (fn(x)){
            yield x;
        }
    }
}

/**
 * 
 * @param {DWDirInfo} dirInfos 
 */
function findMisplacedFiles(dirInfos){
    // find files in different folders, that have the same hash, but different file paths.
    // (what was I thinking when I wrote this... )
    let joined = join(...dirInfos);
    let filtered = filter(joined, x=> x.left[0]!=x.right[0]);
    
    return [... filtered];
}

async function main(){
    let cui = new ConsoleUI();

    function onProgress(obj){
        cui.onChange(obj);
    }
    
    let directoryPaths = process.argv.slice(2);
    
    let dirInfos = [];
    for (const directoryPath of directoryPaths){
        const dirInfo = await doDirectory(directoryPath, onProgress);
        dirInfos.push( dirInfo );
        
    }

    let totalFileCount = 0;
    totalFileCount = dirInfos.reduce((acc, x) => acc + x.files.length, 0);
    let prevDirFileCount = 0;

    for (const dirInfo of dirInfos){
        function onDigestProgress(obj){
            cui.onChange({
                current: obj.current, 
                currentMax: obj.currentMax, 
                total:prevDirFileCount + obj.current,
                totalMax: totalFileCount
             });
        }
        await digestDirectory(dirInfo, onDigestProgress);
        prevDirFileCount += dirInfo.files.length;
    }

    cui.destroy();

    for (const dirInfo of dirInfos){
        buildDigestIndex(dirInfo);
    }

    for (const dirInfo of dirInfos){
        printDuplicates(dirInfo);
    }
    let misplacedFiles = findMisplacedFiles(dirInfos);
//    let joined = [... filter(join(...hashes), x=>x[0].relpath != x[1].relpath)];
    console.log(`${misplacedFiles.length} files with different paths:`, misplacedFiles);    
    
}
main().catch(err => {throw err});
