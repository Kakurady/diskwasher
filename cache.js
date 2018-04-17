"use strict";

const _store = Symbol();
const _db = Symbol();
const path = require('path');
const sqlite = require('sqlite');

const version = 1;
class DWCache {
    /** @type {string} filename */
    constructor(filename) {
        this[_store] = {
            files: new Map()
        };

        if (!filename) {filename = ":memory:";}

        this[_db] = sqlite.open(filename, {cached: true});
    }

    fromString(str) {
        let parsed = JSON.parse(str);

        if (parsed.version != version){
            throw "cache version isn't right";
        }
        this[_store].files = new Map(parsed.files);
    }
    toString() {
        return JSON.stringify({version: version, files:[...this[_store].files.entries()]}, null, "\t");
    }

    getFile(fullpath){
        return this[_store].files.get(fullpath);
    }

    putFile(fullpath, file){
        let { size, mtime, sha512 } = file;
        this[_store].files.set(fullpath, {
            size,
            mtime: mtime.getTime(),
            sha512
        });
    }
    set(obj) {
        for (const dirInfo of obj) {
            for (const file of dirInfo.files) {
                this.putFile(path.join(dirInfo.root, file.relpath), file);
            }
        }
    }

    async close(){
        /**@type {Database} */
        const db = await this[_db];
        return db.close();
    }
}

module.exports = DWCache;
