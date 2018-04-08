"use strict";
const crypto = require("crypto");
const fs = require("fs");
const util = require("util");
const nodeConsole = require("console");
const path = require("path");

const hasha = require("hasha");
// FIXME use stream-buffers instead, less dependency
const memoryStreams = require("memory-streams");
const walker = require("walker");
const yargs = require("yargs");
require ("intl-pluralrules");

const ConsoleUI = require ("./console-ui");

/** @typedef {string} HashType 
 *  @typedef {string} PathType
*/

class DWFile{
    constructor(obj){
        /** @type {PathType} */
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
        /** @type {Map<HashType, PathType[]>} */
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
    let count = 0;
    function countSeps(str){
        let count = 0;
        for (const char of str){
            if (char == path.sep){
                count++;
            }
        }
        return count;
    }
    function recursive_read(_dirpath){
        return new Promise((resolve, reject)=>{
            /**@type DWFile[] */
            let files = [];
            walker(_dirpath)
            .on("file", (file, stat)=>{
                onProgress({current:0, currentMax: count+1, total: 0, totalMax:count+1});
                files.push(new DWFile({
                    'relpath': path.relative(_dirpath, file),
                    'size': stat.size,
                    'mtime': stat.mtime,
                    'sha512': null
                })); 
                count++;
            })
            .on("err", ()=>{}) // FIXME do something with errors
            .on('end', ()=>resolve(files.sort((a,b)=>{
                // fixme directories before/after files                
                let patha = a.relpath.split(path.sep);
                let pathb = b.relpath.split(path.sep);

                while (patha[0].localeCompare(pathb[0]) == 0){
                    patha.shift();
                    pathb.shift();
                }
                //console.log(patha, pathb);
                if (patha.length == 1 && pathb.length == 1){ return a.relpath.localeCompare(b.relpath);;}
                if (patha.length == 1){ return -1;}
                if (pathb.length == 1){ return 1;}
                return a.relpath.localeCompare(b.relpath);
            }
                // FIXME compare asciibetcally
            )));
        });
    }
    try {
        let files = await recursive_read(dirpath);

        // build a dictionary of sha512 -> array of files with that digest.
        // we can build a list of files with the same digest at the same time.
        let digestIndex = new Map();
        let dupsByDigest = new Set();


        return new DWDirInfo({ root: dirpath, files, digestIndex, dupsByDigest });
    } catch (error) {
        throw error;
    }
}

async function digestFile(basepath, file, onProgress, prev){
    const fullpath = path.join(basepath, file.relpath);
    if (file.size > 1024*1024) { await prev; }
    try {
        const readStream = fs.createReadStream(fullpath, {highWaterMark: 512*1024});
        try {
            file.sha512 = await hasha.fromStream(readStream, {algorithm:"sha512"});
        } catch (error) {
            nodeConsole.error(error);
            readStream.close();
        }
    } catch (error) {          
        nodeConsole.error(error);
    }

    
    await prev;
}

/**
 * 
 * @param {DWDirInfo} dirInfo 
 * @param {*} onProgress 
 */
async function digestDirectory(dirInfo, onProgress){
    let files = dirInfo.files;
    let dirpath = dirInfo.root;
    let prev = null;

    let count = 0;
    let open = 0;

    async function digestFile(basepath, file, onProgress, prev){
        open++;

        const fullpath = path.join(basepath, file.relpath);
        const readStream = fs.createReadStream(fullpath, {highWaterMark: 512*1024});
        file.sha512 = await hasha.fromStream(readStream, {algorithm:"sha512"});

        onProgress({current:count, currentMax: files.length, total: count, totalMax: files.length});
        count++;

        open--;
    }
    // step 2: read each file and compute a sha512 digest.
    for (const kv of files.entries()){
        let i = kv[0];
        let file = kv[1];
        // TODO: if displaying megabytes, display the current file name so small files don't look it's stuck.

        //prev = limiter.schedule({weight: (file.size > 256*1024)? 10: 1}, ()=>digestFile(dirpath, file, onProgress, prev));
        prev = digestFile(dirpath, file, onProgress, prev);
        await prev;
    }
    await prev;
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
/**
 * find files in {going} that don't have any counterparts in {staying}.
 * 
 * @param {DWDirInfo[]} going 
 * @param {DWDirInfo[]} staying 
 */
function ImTakingTheHDDAwayWithMe(going, staying) {
    return going.map(function(dirInfo) {
        let missingFiles = [...dirInfo.files].filter(file => {
            if (
                !file.sha512 ||
                staying
                    .map(otherDirInfo =>
                        otherDirInfo.digestIndex.has(file.sha512)
                    )
                    .reduce((pre, cur) => pre || cur, false)
            ) {
                return false;
            }
            // then there are none
            return true;
        });

        return missingFiles;
    });
}

async function testDirectoriesAreStatable(directoryPaths) {
    
    const statAsync = util.promisify(fs.stat);
    let issues = [];
    for (const directoryPath of directoryPaths) {
        try {
            let stats = await statAsync(directoryPath);
            if (!(stats.isFile() || stats.isDirectory() || stats.isSymbolicLink())) {
                issues.push(`${directoryPath} is not a file or directory.`);
            }
        }
        catch (ex) {
            issues.push(`Error when trying to stat ${directoryPath}.`);
        }
    }
    console.log(issues.join("\n"));
    if (issues.length > 0) {
        throw issues[0];
    }
    
}


async function main(){
    // first test input?
    let bufOutputStream = new memoryStreams.WritableStream();
    let timeConsole = new nodeConsole.Console(bufOutputStream);
    
    //await testDirectoriesAreStatable(directoryPaths);
    let yargv = 
    yargs.options({
        'output': {
            alias: 'o',
            normalize: true,
            nargs: 1,
            desc: "filename to output results to. if empty, will display result"
        }
    }).argv;
    // DEBUG: log argument parsing output
    timeConsole.log(JSON.stringify(yargv, null, "  "));
    //.command('*', 'showNotBackedUp')
    
    let directoryPaths = yargv._;

    let cui = new ConsoleUI();

    let totalFileCount = 0;
    let prevDirFileCount = 0;

    function onProgress(obj){
        cui.onChange(obj);
    }
    function onListProgress(obj){
        cui.onChange({
            current: obj.current, 
            currentMax: obj.currentMax, 
            total:obj.total,
            totalMax: totalFileCount + obj.totalMax
         });
    }
    
    
    timeConsole.time("Program");
    timeConsole.time("listfiles");

    let dirInfos = [];
    for (const directoryPath of directoryPaths){
        try {
            // list files in each directory
            const dirInfo = await doDirectory(directoryPath, onListProgress);
            dirInfos.push( dirInfo );
            totalFileCount += dirInfo.files.length;
        } catch (error) {
            throw error;
        }

        
    }
    timeConsole.timeEnd("listfiles");


    totalFileCount = dirInfos.reduce((acc, x) => acc + x.files.length, 0);

    timeConsole.time("hash");
    for (const dirInfo of dirInfos){
        function onDigestProgress(obj){
            cui.onChange({
                current: obj.current, 
                currentMax: obj.currentMax, 
                total:prevDirFileCount + obj.current,
                totalMax: totalFileCount
             });
        }
        // read file content and create sha512 digest
        await digestDirectory(dirInfo, onDigestProgress);
        prevDirFileCount += dirInfo.files.length;
    }
    timeConsole.timeEnd("hash");

    // Build digest index
    for (const dirInfo of dirInfos){
        buildDigestIndex(dirInfo);
    }

    // print duplicates (which is convienently built at the same time as digest index)
    // for (const dirInfo of dirInfos){
    //     printDuplicates(dirInfo);
    // }
    // print duplicates on terminal instead
    // cui.showDuplicates(dirInfos);
    

    // Find misplaced files
    //let misplacedFiles = findMisplacedFiles(dirInfos);
    //let joined = [... filter(join(...hashes), x=>x[0].relpath != x[1].relpath)];
    //console.log(`${misplacedFiles.length} files with different paths:`, misplacedFiles);    
    
    let notBackedUpFiles = ImTakingTheHDDAwayWithMe([...dirInfos.slice(0,1)],[...dirInfos.slice(1)]);
    // let _outFile = yargv.output;
    if (yargv.output){
        try {
            // turn file into array
            let arr = cui.filesNotBackedUpToFlatArray(notBackedUpFiles);
            // turn array into string
            let str = arr.join("\n");
            // write string to file
            let create_subfolders = function create_subfolders(base, ...paths){
                var length = paths.length;
                var success = false;
                while (!success && length > 0){
                    try {
                        // try to create directory "base + path[0, length)"
                        let dirname = path.join(base, ...(paths.slice(0, length)));
                        fs.mkdirSync(dirname);
                        success = true;
                    } catch (e){
                        if (e.code == "ENOENT"){
                            // rrr! no parent directory
                            if (length > 1){
                                // back off one level and try again
                                length--;
                            } else {
                                // already at "base + path [0, 1)", giving up
                                throw e;
                            }
                        } else {
                            throw e;
                        }
                    }
                }
                // recursively create subdirectories. 
                // "base + path[0, length)" should exist now, so add 1 to length
                for(length++ ; length <= paths.length; length++){
                    let dirname = path.join(base, paths.slice(0, length));
                    fs.mkdirSync(dirname);
                }
            }
            let write_pp3 = function _write_pp3(filename, text){
                var basepath = "";
                var paths = path.normalize(filename).split(path.sep);
                // move last part of path into filename.
                filename = paths.pop();

                const full_path = path.join(basepath, ...paths, filename);

                // DEBUG path handling
                timeConsole.log(JSON.stringify(paths),filename, full_path)
                // FIXME should it try to create ../../ if creating ../../a fails?

                // try to open a file handle
                var subdir_created = false;
                var backup_copied = false;
                var success = false;
                var fd;
                while (!success){
                    try {
                        fd = fs.openSync(full_path, "wx");
                        success = true;
                        
                    } catch (e){
                        if (e.code == "ENOENT" && !subdir_created){
                            // can't find ancestor folders, have to create them
                            try {
                                create_subfolders(basepath, ...paths);
                                subdir_created = true;
                            } catch (e) {
                                // there was a problem creating ancestor folders
                                throw e;
                            }
                        
                        } else if (e.code == "EEXIST" && !backup_copied){
                            // there's already an existing file, need to move it
                            let backup_path = path.join(basepath, ...paths, `${filename}~`);
                            // on Linux, renames overwrite existing files, so don't have to test for it
                            // ... unless the old backup exists, and is a directory. Then, trying to move another file to that name will fail
                            try {
                                fs.renameSync(full_path, backup_path); 
                                backup_copied = true;
                            } catch (e) {
                                // there was a problem making a backup copy
                                throw e;
                            }
                        } else {
                            // something else went wrong trying to open the file
                            throw e;
                        }
                    }
                }
                
                fs.writeFileSync(fd, text);
                fs.closeSync(fd);
                //return success;
            }

            write_pp3(yargv.output, str);
        } catch (error) {
            
        }

        cui.destroy();
    } else {
        cui.showFilesNotBackedUp(notBackedUpFiles);
    }
    timeConsole.timeEnd("Program");

    if (!yargs.output){
        await cui.finish();
    }
    console.log(bufOutputStream.toString());

}
main().catch(err => {throw err});

