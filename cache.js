"use strict";

const _store = Symbol();
const _db = Symbol();
const path = require('path');
const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');

const version = 1;
class DWCache {
    /** @type {string} filename */
    constructor(filename) {
        this[_store] = {
            files: new Map()
        };

        if (!filename) {filename = ":memory:";}
        this.filename = filename;
        const migrationsPath = path.join(path.dirname(process.argv[1]), "migrations")
        /**@type {sqlite.Database} */
        this[_db] = sqlite.open({filename, driver:sqlite3.cached.Database})
        .then(db=>{db.exec("pragma journal_mode = wal;"); return db;})
        .then(db => { db.migrate({migrationsPath}); return db;}
        );
    }

    fromString(str) {
        let parsed = JSON.parse(str);

        if (parsed.version != version){
            throw "cache version isn't right";
        }
        for (const file of parsed.files){
            let fullpath = file[0];
            let {size, mtime, sha512} = file[1];
            this.putFile(fullpath, {size, mtime: new Date(mtime),sha512});
        }
    }
    toString() {
        return JSON.stringify({version: version, files:[...this[_store].files.entries()]}, null, "\t");
    }

    async getFile(fullpath){
        // return this[_store].files.get(fullpath);
        const sql = `
        Select * 
        From "files"
        Where "fullpath" = $fullpath
            And ( ($mtime Isnull ) OR "mtime" = $mtime )
        ;
        `
        /**@type {sqlite.Database} */
        let db = await this[_db];
        let res = await db.get(sql, {$fullpath: fullpath})
        // fixme object shape
        if (!res) {return;}
        return {
            fullpath: res.fullpath,
            size: res.size,
            mtime: new Date(res.mtime * 1000 + res.mtime_frac),
            sha512: res.sha512.toString("base64")
        };
    }

    async putFile(fullpath, file){
        let { size, mtime, sha512 } = file;
        this[_store].files.set(fullpath, {
            size,
            mtime: mtime.getTime(),
            sha512
        });

        /**@type {sqlite.Database} */
        const db = await this[_db];

        //        Insert Or Replace Into "files" 
        //("fullpath", "size", "mtime", "mtime_frac", "sha512")
        //Values ($fullpath, $size, $mtime, $mtime_frac, $sha512);
        const sql = `
                Insert Or Replace Into "files" 
        ("fullpath", "size", "mtime", "mtime_frac", "sha512")
        Values ($fullpath, $size, $mtime, $mtime_frac, $sha512);
        `;

        let $mtime = mtime.getTime();
        let $mtime_frac = mtime % 1000;
        $mtime = ($mtime - $mtime_frac) / 1000;

        let obj = {
            $fullpath: fullpath,
            $size: size,
            $mtime,
            $mtime_frac,
            $sha512: Buffer.from(sha512, "base64")
        };

        
        return db.run(sql, obj);

    }
    set(obj) {
        for (const dirInfo of obj) {
            for (const file of dirInfo.files) {
                this.putFile(path.join(dirInfo.root, file.relpath), file);
            }
        }
    }

    async close(){
        const db = await this[_db];
        await db.run("Pragma optimize");
        return db.close();
    }
}

module.exports = DWCache;
