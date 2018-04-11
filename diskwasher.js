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
const micromatch = require("micromatch");

const ConsoleUI = require ("./console-ui");
const DWCache = require("./cache");
const cache = new DWCache();
//glob debugging
let testGlobIgnore = false;
let directoriesTested = [];

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
        /** @type {HashType} */
        this.sha512 = obj.sha512;
    }

    basepath(){
        return this.relpath.slice(this.relpath.lastIndexOf(path.sep));
    }
}

class DWDirInfo{
    constructor(obj){
        /** @type {string} */
        this.root = obj.root;
        //FIXME unify the two
        /** @type {DWFile[]} */
        this.files = obj.files;
        /** @type {Map<PathType, DWFile>} */
        this.pathIndex = obj.pathIndex;
        /** @type {Map<PathType, DWFile[]>} */
        this.basepathIndex = obj.basepathIndex;
        /** @type {Map<HashType, PathType[]>} */
        this.digestIndex = obj.digestIndex;
        /** @type {Set<HashType>} */
        this.dupsByDigest = obj.dupsByDigest;
        /** @type {Set<PathType>} */
        this.fileWithErrors = obj.fileWithErrors;
    }
}

/**
 * // list files, digest files, build map of hash and list of duplicates
 * @param {string} dirpath (already normalized)
 * @param {string[]} globsToIgnore
 * @param {*} onProgress 
 */
async function doDirectory(dirpath, globsToIgnore, onProgress){
    let dirGlobs = [...globsToIgnore, ...[...globsToIgnore]
            .filter(x => x.endsWith(path.sep))
            .map(x => x.slice(0, -1))];

    let dirMatchers = dirGlobs.map(x =>
        micromatch.matcher(x, { dot: true })
    );
    let fileMatchers = globsToIgnore.map(x =>
        micromatch.matcher(x, { dot: true })
    );

    /**
     * Given path, try all matchers if any fit
     * @param {string} fullpath 
     * @param {string} relpath 
     * @param {((str:string) => boolean)[]} matchers 
     */
    function tryMatchers(fullpath, relpath, matchers){
        return matchers.reduce((acc, matcher) => acc || matcher(fullpath) || matcher(relpath), false);
    }
    // step 1: list files under the directory.
    // TODO: I want a progress indicator while reading
    // TODO: want file size for each file, so I can display a progress for large files. 
    let fileWithErrors = new Set();
    let digestIndex = new Map();
    let pathIndex = new Map();
    let basepathIndex = new Map();
    let dupsByDigest = new Set();
    
    let count = 0;
    let currentItem = "";
    let getState = ()=>{
        return {current:0, currentMax: count+1, total:0, totalMax: count+1, currentItem}
    };
    let stateObj = {getState};

    let pathcompare = (a,b)=>{
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
    };
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
            .filterDir( (dir)=>{
                let relpath = path.relative(_dirpath, dir);

                let res = !tryMatchers(dir, relpath, dirMatchers);

                if (testGlobIgnore){ directoriesTested.push(`${res}, ${dir}`); }
                return res;
            })
            .on("file", (file, stat)=>{
                let relpath = path.relative(_dirpath, file);
                currentItem = relpath;
                onProgress(stateObj);
                // if (micromatch.any(file, globsToIgnore, { dot:true }) || micromatch.any(relpath, globsToIgnore, { dot:true })) {
                //     return;
                // }
                let newFile = new DWFile({
                    'relpath': relpath,
                    'size': stat.size,
                    'mtime': stat.mtime,
                    'sha512': null
                });
                files.push(newFile); 
                count++;
            })
            .on("error", (er, entry, stat)=>{
                fileWithErrors.add(entry);
            }) // FIXME do something with errors
            .on('end', ()=>resolve(files.sort(pathcompare)));
        });
    }
    try {
        let files = await recursive_read(dirpath);

        // build a dictionary of sha512 -> array of files with that digest.
        // we can build a list of files with the same digest at the same time.

        return new DWDirInfo({
            root: dirpath,
            files,
            digestIndex,
            pathIndex,
            basepathIndex,
            dupsByDigest,
            fileWithErrors
        });
    } catch (error) {
        throw error;
    }
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

    let total = files.length;
    let currentItem = "";

    let getState = ()=>{
        return {current:count, currentMax: files.length, total, totalMax: total, currentItem}
    };
    let stateObj = {getState};

    /**
     * 
     * @param {PathType} basepath 
     * @param {DWFile} file 
     * @param {*} onProgress 
     * @param {Promise<void>|null} prev 
     */
    async function digestFile(basepath, file, onProgress, prev){
        if (testGlobIgnore) {return;}

        const fullpath = path.join(basepath, file.relpath);
        currentItem = file.relpath;
        onProgress(stateObj);

        let cached = cache.getFile(fullpath);
        if (cached){
            //fixme: do something about mtime.
            let mtime = file.mtime.getTime();
            if (file.size == cached.size){
                file.sha512 = cached.sha512;
                count++;
                return;
            }
        }

        open++;

        let readStream;
        try {           
            readStream = fs.createReadStream(fullpath, {highWaterMark: 512*1024});
            file.sha512 = await hasha.fromStream(readStream, {algorithm:"sha512", encoding: 'base64'});
        } catch (error) {
            readStream && typeof readStream.close === 'function' && readStream.close();
            dirInfo.fileWithErrors.add(file.relpath);
        }

        count++;
        cache.putFile(fullpath, file);

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
    let basepathIndex = dirInfo.basepathIndex;

    for (const kv of files.entries()){
        let i = kv[0];
        let x = kv[1];

        let names = digestIndex.get(x.sha512) || [];
        if (names.length>0) {
            dupsByDigest.add(x.sha512);
        }
        names.push(x.relpath);
        digestIndex.set(x.sha512, names); 

        dirInfo.pathIndex.set(x.relpath,x);

        let basepath = x.basepath();
        let basepaths = basepathIndex.get(basepath) || [];
        basepaths.push(x);
        basepathIndex.set(basepath, basepaths);
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
                ( !testGlobIgnore ) && 
                ( !file.sha512 ) ||
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

        return missingFiles.map(x => {
            // Is there a file with completely same path?
            let exactPathMatches = staying.map(s=> s.pathIndex.get(x.relpath)).filter(x=>!!x);
            if (exactPathMatches[0]){
                return {file: x, exactMatch: exactPathMatches[0]};
            }
            // is there a file in a different path?
            let similarMatches = staying.map(s=>s.basepathIndex.get(x.basepath)).filter(x=>!!x);
            if (similarMatches[0]){
                return {file: x, similarMatches};
            }
            return {file: x};
        });
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

async function create_subfolders(base, ...paths){
    const mkdirAsync = util.promisify(fs.mkdir);

    var length = paths.length;
    let success = false;
    while (!success && length > 0){
        try {
            // try to create directory "base + path[0, length)"
            let dirname = path.join(base, ...(paths.slice(0, length)));
            await mkdirAsync(dirname);
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
        await mkdirAsync(dirname);
    }
}
/**
 * 
 * @param {string?} basepath 
 * @param {string} filename 
 * @param {any} text 
 * @param {boolean} overwrite 
 * @returns if a backup was made
 */
let write_pp3 = async function _write_pp3(basepath = "", filename, text, overwrite = true){
    const openAsync = util.promisify(fs.open);
    const renameAsync = util.promisify(fs.rename);
    const writeFileAsync = util.promisify(fs.writeFile);
    const closeAsync = util.promisify(fs.close);

    const paths = path.normalize(filename).split(path.sep);
    // move last part of path into filename.
    filename = paths.pop();

    const full_path = path.join(basepath, ...paths, filename);
    

    // DEBUG path handling
    // timeConsole.log(JSON.stringify(paths),filename, full_path)
    // FIXME should it try to create ../../ if creating ../../a fails?

    // try to open a file handle
    var subdir_created = false;
    var backup_copied = false;
    var open_succeeded = false;
    var fd;
    while (!open_succeeded){
        try {
            fd = await openAsync(full_path, "wx");
            open_succeeded = true;
            
        } catch (e){
            if (e.code == "ENOENT" && !subdir_created){
                // can't find ancestor folders, have to create them
                try {
                    await create_subfolders(basepath, ...paths);
                    subdir_created = true;
                } catch (e) {
                    // there was a problem creating ancestor folders
                    throw e;
                }
            
                // FIXME: Maybe ask interactively if overwrite (or always do)
            } else if (e.code == "EEXIST" && !backup_copied && !!overwrite ){
                // there's already an existing file, need to move it
                let backup_path = path.join(basepath, ...paths, `${filename}~`);
                // on Linux, renames overwrite existing files, so don't have to test for it
                // ... unless the old backup exists, and is a directory. Then, trying to move another file to that name will fail
                try {
                    await renameAsync(full_path, backup_path); 
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
    
    await writeFileAsync(fd, text);
    await closeAsync(fd);
    return backup_copied;
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
        }, 
        "ignore": {
            alias: 'i',
            desc: "path to ignore. Can use glob patterns in micromatch format. Can specify multiple patterns by repeating the option."
        },
        "debugFileListing":{
            type:'boolean',
            hidden: true
        },
        "cacheFile":{
            alias: 'cachefile',
            normalize: true,
            nargs: 1,
        }
    }).argv;
    //.command('*', 'showNotBackedUp')

    // DEBUG: log argument parsing output
    timeConsole.log("parsed arguments:", JSON.stringify(yargv, null, "  "));

    if ('debugFileListing' in yargv){
        testGlobIgnore = yargv.debugFileListing;
    }
   // fixme: functionalize this already
   /**
    * probably an array.
    */
   let ignoredPaths = 
   (!yargv.ignore)? 
       [] :
       (typeof yargv.ignore == 'string')? 
           [yargv.ignore]:
           yargv.ignore;

    timeConsole.debug("ignored Paths:", JSON.stringify(ignoredPaths, null, "  "));
    
    let dirGlobs = [...ignoredPaths, ...[...ignoredPaths]
    .filter(x => x.endsWith(path.sep))
    .map(x => x.slice(0, -1))];
    timeConsole.debug("directory glob patterns:", JSON.stringify(dirGlobs, null, "  "));

    // test if glob patterns are valid (of course they are)
    [...ignoredPaths].map(x=>{
        try {
            return micromatch.matcher(x);
        } catch (error) {
            console.warn(`unable to compile pattern "${x}".`)
        }
    });

    if (yargv.cacheFile){
        try {
            console.log(`reading cache...`);

            let text = await util.promisify(fs.readFile)(yargv.cacheFile, {encoding: "utf8"});
            cache.fromString(text);
        } catch (error) {
            console.log(`error reading cache: ${error}`);
        }
    }

    let directoryPaths = yargv._;

    let cui = new ConsoleUI();

    let totalFileCount = 0;
    let prevDirFileCount = 0;

    function onProgress(obj){
        cui.onChange(obj);
    }
    let progressObj = {};
    let getListProgressState = ()=>{
        let obj = (typeof progressObj.getState == "function")?
             progressObj.getState():
             progressObj
        ;
        return {
            current: obj.current, 
            currentMax: obj.currentMax, 
            total:obj.total,
            totalMax: totalFileCount + obj.totalMax,
            currentItem: obj.currentItem
         }
    };
    let stateo = { getState:getListProgressState };
    function onListProgress(obj){
        progressObj = obj;
        cui.onChange(stateo);
    }
    
    
    timeConsole.time("Program");
    timeConsole.time("listfiles");

    let dirInfos = [];
    for (const directoryPath of directoryPaths){
        try {
            // list files in each directory
            const dirInfo = await doDirectory(directoryPath, ignoredPaths, onListProgress);
            dirInfos.push( dirInfo );
            totalFileCount += dirInfo.files.length;
        } catch (error) {
            throw error;
        }

        
    }
    timeConsole.timeEnd("listfiles");
    if(testGlobIgnore){
        timeConsole.debug("directories tested:", JSON.stringify(directoriesTested, null, "  "));
    }
    


    totalFileCount = dirInfos.reduce((acc, x) => acc + x.files.length, 0);

    timeConsole.time("hash");
    for (const dirInfo of dirInfos){
        let progressObj = {};
        let getState = ()=>{
            let obj = (typeof progressObj.getState == "function")?
                 progressObj.getState():
                 progressObj
            ;
            return {
                current: obj.current, 
                currentMax: obj.currentMax, 
                total:prevDirFileCount + obj.current,
                totalMax: totalFileCount,
                currentItem: obj.currentItem
            }
        };
        let stateo = { getState };
        function onDigestProgress(obj){
            progressObj = obj;
            cui.onChange(stateo);
        }
        // read file content and create sha512 digest
        await digestDirectory(dirInfo, onDigestProgress);
        prevDirFileCount += dirInfo.files.length;
    }
    timeConsole.timeEnd("hash");

    let hasFilesWithErrors = dirInfos.reduce((acc, i)=>acc||(i.fileWithErrors.size > 0),false);
    if (hasFilesWithErrors){
        timeConsole.log("files with errors:")
        for (const dirInfo of dirInfos){
            for (const file of dirInfo.fileWithErrors){
                timeConsole.log(file);
            }
        }
    }

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

            let backup_copied = await write_pp3("", yargv.output, str);
            cui.destroy();
            if (backup_copied){
                timeConsole.info(`Files not backed up report overwritten to ${yargv.output}. Previous content of output file moved to backup.`);
            } else {
                timeConsole.info(`Files not backed up report written to ${yargv.output}`);
            }
        } catch (error) {
            cui.destroy();
            console.error(error);
        }

    } else {
        cui.showFilesNotBackedUp(notBackedUpFiles);
    }
    timeConsole.timeEnd("Program");

    if (!yargs.output){
        await cui.finish();
    }
    console.log(bufOutputStream.toString());

    if (yargv.cacheFile){
        try {
            console.log("writing out to cache...");
            await write_pp3("", yargv.cacheFile, cache.toString());            
            console.log("cache written");
        } catch (error) {
            console.log(`error writing cache: ${error}`);
        }
    }

}
main().catch(err => {throw err});

