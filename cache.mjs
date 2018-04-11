let _store = Symbol();

class DWCache {
    constructor(){
        this[_store] = {};
    }

    fromString(str){
        this[_store] = JSON.parse(str);
    }
    toString(){
        return JSON.stringify(this[_store]);
    }

    set(obj){
        this[_store] = obj;
    }
}

export default DWCache;
